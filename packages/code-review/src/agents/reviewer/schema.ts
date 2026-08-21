import { z } from "zod";

/**
 * Scores travel as strings, deliberately.
 *
 * OpenRouter sends `strict: true` by default, and the strict JSON-Schema subset
 * excludes `minimum`/`maximum`/`minLength`/`pattern`/`format`. A numeric score with
 * bounds would compile to exactly those keywords; an eleven-value string enum is one
 * node with no value constraint, so an out-of-range score is structurally
 * unrepresentable rather than rejected after the fact. Coercion to a number happens
 * once, in verdict.ts — never via `z.transform`, which is invisible to the
 * `io: 'input'` schema the provider actually receives.
 */
export const SCORE_VALUES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "n/a"] as const;

/** The five named blocking categories. A concrete finding in any of them fails the PR. */
export const BLOCKING_CATEGORIES = [
  "data-retention",
  "authorization",
  "secret-exposure",
  "unsurfaced-destructive-failure",
  "consent-handling",
] as const;

/**
 * One scored criterion. `note` carries no `.min(1)` on purpose: `minLength` is as far
 * outside the strict subset as `minimum` is, so enforcing non-emptiness here would
 * reintroduce on `note` exactly the hazard the score encoding exists to avoid. The
 * prompt requires a line per criterion and the renderer substitutes a visible
 * placeholder — a missing justification is a display defect, not a reason to discard
 * an entire review.
 */
const criterion = (description: string) =>
  z
    .object({
      score: z.enum(SCORE_VALUES),
      note: z.string().describe("One-line justification for the score"),
    })
    .describe(description);

export const reviewSchema = z.object({
  summary: z.string().describe("One-sentence verdict on the diff"),
  criteria: z.object({
    defect: criterion("defect — does the diff contain a defect observable in the changed lines"),
    safety: criterion("safety — does the change expose data or open a trust boundary present in the diff"),
    blastRadius: criterion("blast radius — if this is wrong in production, is the failure visible and reversible"),
    verification: criterion("verification — is the changed behavior exercised by something that would fail on regression"),
    clarity: criterion("clarity — will a later reader understand why this diff looks the way it does"),
  }),
  findings: z.array(
    z.object({
      file: z.string(),
      // Refinements, not `.int().positive()`: zod compiles those to `exclusiveMinimum`
      // and `maximum` (the safe-integer bound), both outside the provider's strict-mode
      // keyword subset. A refinement is invisible to JSON Schema and still rejects a 0
      // or a 5.5 at parse time, so the wire stays `{"type":"number"}`.
      line: z
        .number()
        .refine(Number.isInteger, "line must be a whole number")
        .refine((line) => line > 0, "line must be positive"),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
      blockingCategory: z
        .enum(BLOCKING_CATEGORIES)
        .nullable()
        .describe("Null unless this finding is concrete, located and in a named blocking category"),
    }),
  ),
});

export type Review = z.infer<typeof reviewSchema>;
export type Criterion = keyof Review["criteria"];
export type BlockingCategory = (typeof BLOCKING_CATEGORIES)[number];
