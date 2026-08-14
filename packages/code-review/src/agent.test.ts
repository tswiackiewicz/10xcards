import { MockLanguageModelV4 } from "ai/test";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { reviewDiff } from "./agent.ts";
import { reviewInstructions } from "./prompts.ts";

const review = {
  summary: "One real defect in the changed lines.",
  findings: [{ file: "src/cart.ts", line: 5, severity: "error", message: "Off-by-one in the loop bound." }],
};

const diff = "diff --git a/src/cart.ts b/src/cart.ts\n+  for (let i = 0; i <= items.length; i++) {";

/** Shape copied from node_modules/ai/docs/03-ai-sdk-core/55-testing.mdx (version-matched to ai@7). */
function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      }),
  });
}

describe("reviewDiff", () => {
  it("parses the model's JSON response into a typed review", async () => {
    const result = await reviewDiff(diff, { model: mockModel(JSON.stringify(review)), cwd: tmpdir() });

    expect(result).toEqual(review);
  });

  it("sends the diff as user content, never inside the instructions", async () => {
    const model = mockModel(JSON.stringify(review));

    await reviewDiff(diff, { model, cwd: tmpdir() });

    const call = model.doGenerateCalls[0];
    expect(call).toBeDefined();

    const userText = JSON.stringify(call?.prompt.filter((message) => message.role === "user"));
    expect(userText).toContain("items.length");

    const systemText = JSON.stringify(call?.prompt.filter((message) => message.role === "system"));
    expect(systemText).toContain(reviewInstructions);
    expect(systemText).not.toContain("items.length");
  });

  it("puts the installed versions into the prompt as ground truth", async () => {
    const model = mockModel(JSON.stringify(review));

    // This package's own directory: a real package.json with resolvable dependencies.
    await reviewDiff(diff, { model, cwd: process.cwd() });

    const userText = JSON.stringify(model.doGenerateCalls[0]?.prompt.filter((message) => message.role === "user"));
    expect(userText).toContain("Installed versions (ground truth):");
    expect(userText).toMatch(/zod@\d+\./);
  });

  it("needs no API key when a model is injected", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      await expect(reviewDiff(diff, { model: mockModel(JSON.stringify(review)), cwd: tmpdir() })).resolves.toEqual(
        review,
      );
    } finally {
      if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
    }
  });
});
