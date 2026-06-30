import { useState } from "react";
import { Sparkles, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_INPUT_CHARS, type Candidate, type ApiErrorCode } from "@/lib/flashcards/schemas";
import { CandidateCard, type ReviewCard } from "@/components/flashcards/CandidateCard";

/** Typed error code → friendly inline copy. */
const ERROR_COPY: Record<ApiErrorCode, string> = {
  empty_input: "Please paste some text first.",
  too_long: `Text is too long — keep it under ${MAX_INPUT_CHARS.toLocaleString()} characters.`,
  no_cards: "The AI couldn't make usable cards from this text. Try a longer or clearer passage.",
  ai_unavailable: "AI generation is unavailable right now. Make sure OpenRouter is configured, then try again.",
  rate_limited: "Too many requests right now. Wait a moment and try again.",
  invalid_input: "Some cards are invalid — check the question and answer lengths, then try again.",
  unauthorized: "Your session expired. Please sign in again.",
  save_failed: "Couldn't save your cards. Please try again.",
};

interface JsonResponse {
  error?: ApiErrorCode;
  candidates?: Candidate[];
  saved?: number;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: JsonResponse }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as JsonResponse;
  return { ok: res.ok, data };
}

export default function GenerateView() {
  const [text, setText] = useState("");
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [status, setStatus] = useState<"idle" | "generating" | "saving">("idle");
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const overLimit = text.length > MAX_INPUT_CHARS;
  const acceptedCount = cards.filter((c) => c.status === "accepted").length;
  const generating = status === "generating";
  const saving = status === "saving";

  async function handleGenerate() {
    setError(null);
    setSavedCount(null);
    setCards([]);
    setStatus("generating");
    try {
      const { ok, data } = await postJson("/api/flashcards/generate", { text });
      if (!ok) {
        setError(data.error ?? "ai_unavailable");
        return;
      }
      setCards(
        (data.candidates ?? []).map((c) => ({
          id: crypto.randomUUID(),
          question: c.question,
          answer: c.answer,
          status: "pending",
        })),
      );
    } catch {
      setError("ai_unavailable");
    } finally {
      setStatus("idle");
    }
  }

  async function handleSave() {
    const accepted = cards.filter((c) => c.status === "accepted");
    if (accepted.length === 0) return;
    setError(null);
    setStatus("saving");
    try {
      const { ok, data } = await postJson("/api/flashcards", {
        cards: accepted.map(({ question, answer }) => ({ question, answer })),
      });
      if (!ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      setSavedCount(data.saved ?? accepted.length);
      setCards([]);
      setText("");
    } catch {
      setError("save_failed");
    } finally {
      setStatus("idle");
    }
  }

  function editCard(id: string, field: "question" | "answer", value: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }
  function acceptCard(id: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "accepted" } : c)));
  }
  function rejectCard(id: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "rejected" } : c)));
  }

  return (
    <div className="space-y-4">
      <div>
        <textarea
          className="h-40 w-full resize-y rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-purple-300 disabled:opacity-50"
          placeholder="Paste your source text here…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          disabled={generating}
        />
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={overLimit ? "text-red-300" : "text-blue-100/50"}>
            {text.length.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()}
          </span>
          <Button type="button" onClick={handleGenerate} disabled={generating || text.trim().length === 0 || overLimit}>
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Generating cards…" : "Generate"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {ERROR_COPY[error]}
        </p>
      )}

      {savedCount !== null && (
        <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {savedCount} {savedCount === 1 ? "card" : "cards"} saved to your deck.
        </p>
      )}

      {cards.length > 0 && (
        <>
          <ul className="space-y-3">
            {cards.map((card, i) => (
              <CandidateCard
                key={card.id}
                card={card}
                index={i}
                onEdit={editCard}
                onAccept={acceptCard}
                onReject={rejectCard}
              />
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-100/60">{acceptedCount} accepted</span>
            <Button type="button" onClick={handleSave} disabled={saving || acceptedCount === 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Saving…" : "Save accepted"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
