// Risk #7 — proves generateRequestSchema + mapInputError correctly reject empty,
// whitespace-only, and over-cap input to AI generation with the right typed error code, and
// accept input at exactly the cap. Pure unit test: no HTTP server, no Supabase, no
// OpenRouter — validation is upstream of any provider call (generate.ts), so this is the
// cheapest layer with real signal per the two-layer test strategy.
import { describe, expect, it } from "vitest";
import { generateRequestSchema, MAX_INPUT_CHARS } from "@/lib/flashcards/schemas";
import { mapInputError } from "@/pages/api/flashcards/generate";

describe("Risk #7 — generateRequestSchema input-boundary handling", () => {
  it("rejects an empty string as empty_input", () => {
    const result = generateRequestSchema.safeParse({ text: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(mapInputError(result.error)).toBe("empty_input");
    }
  });

  it("rejects whitespace-only input as empty_input (trims before checking length)", () => {
    const result = generateRequestSchema.safeParse({ text: " \t\n  " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(mapInputError(result.error)).toBe("empty_input");
    }
  });

  it("rejects input one character over the cap as too_long", () => {
    const result = generateRequestSchema.safeParse({ text: "a".repeat(MAX_INPUT_CHARS + 1) });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(mapInputError(result.error)).toBe("too_long");
    }
  });

  it("accepts input at exactly the cap", () => {
    const result = generateRequestSchema.safeParse({ text: "a".repeat(MAX_INPUT_CHARS) });

    expect(result.success).toBe(true);
  });

  it("rejects a non-string text value as invalid_input, not empty_input or too_long", () => {
    const result = generateRequestSchema.safeParse({ text: 123 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(mapInputError(result.error)).toBe("invalid_input");
    }
  });
});
