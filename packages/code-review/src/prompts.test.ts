import { describe, expect, it } from "vitest";

import { buildReviewPrompt } from "./prompts.ts";

const diff = "diff --git a/src/cart.ts b/src/cart.ts\n+  sum += items[i].price;";

describe("buildReviewPrompt", () => {
  it("prefixes a ground-truth block when versions are known", () => {
    const prompt = buildReviewPrompt({ diff, versions: ["ai@7.0.64", "zod@4.4.3"] });

    expect(prompt).toContain("Installed versions (ground truth):");
    expect(prompt).toContain("ai@7.0.64\nzod@4.4.3");
    expect(prompt).toContain("Diff:");
    expect(prompt).toContain(diff);
  });

  it("sends the bare diff when no versions could be resolved", () => {
    const prompt = buildReviewPrompt({ diff, versions: [] });

    expect(prompt).toBe(diff);
    expect(prompt).not.toContain("Installed versions");
    expect(prompt).not.toContain("Diff:");
  });
});
