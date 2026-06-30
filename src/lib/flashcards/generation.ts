import { candidateSchema, MAX_CARDS, type Candidate } from "@/lib/flashcards/schemas";

/**
 * Model id is a swappable constant.
 * - Dev: a `:free` model whose provider actually ENFORCES json_schema. Not all do — several free
 *   providers ignore `response_format` and return prose (our parser then yields []). This Nvidia
 *   id was verified to honor the schema; card quality is mediocre (free-tier), which is expected.
 * - Prod: a cheap PAID quality model with provider training disabled (GDPR NFR + free-tier
 *   reliability + better cards). See `context/changes/ai-card-generation/plan.md` → Migration Notes.
 * Pick a live id from
 * https://openrouter.ai/models?max_price=0&supported_parameters=structured_outputs
 */
const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Thrown on transport/HTTP failure; `status` carries the upstream HTTP status when available. */
export class GenerationError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GenerationError";
    this.status = status;
  }
}

const SYSTEM_PROMPT = [
  "You turn source material into study flashcards.",
  "Decompose the user's text into self-contained question/answer pairs, each testing a single fact.",
  "Questions are answerable without seeing the source; answers are concise and correct.",
  `Produce at most ${MAX_CARDS} cards. Use the same language as the source text.`,
].join(" ");

/** JSON schema for the structured `response_format` — an object wrapping the card array. */
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "flashcards",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["cards"],
      properties: {
        cards: {
          type: "array",
          maxItems: MAX_CARDS,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "answer"],
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Turn source text into validated flashcard candidates via a single OpenRouter call.
 * Returns `[]` on a well-formed-but-empty/unusable result; throws `GenerationError` only on
 * transport/HTTP failure. Never logs the source text.
 */
export async function generateCandidates(text: string, apiKey: string): Promise<Candidate[]> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: RESPONSE_FORMAT,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new GenerationError("OpenRouter request failed");
  }

  if (!response.ok) {
    throw new GenerationError(`OpenRouter responded ${response.status}`, response.status);
  }

  const content = await extractContent(response);
  if (!content) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const rawCards = (parsed as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(rawCards)) {
    return [];
  }

  const cards: Candidate[] = [];
  for (const raw of rawCards) {
    const result = candidateSchema.safeParse(raw);
    if (result.success) {
      cards.push(result.data);
    }
    if (cards.length >= MAX_CARDS) {
      break;
    }
  }
  return cards;
}

/** Pull the assistant message content out of the chat-completions response, defensively. */
async function extractContent(response: Response): Promise<string | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const choices = (body as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
  return typeof content === "string" ? content : null;
}
