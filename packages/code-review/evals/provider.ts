/**
 * promptfoo custom provider: adapts `reviewDiff` to promptfoo's provider interface.
 *
 * One file serves all three candidates — the model comes from the per-provider
 * `config.model`, so `resolveModel()`'s env lookup is bypassed and three models can run
 * inside a single sweep.
 *
 * The two promptfoo shapes below are **declared, not imported**. promptfoo is not a
 * dependency of this package (see evals/README.md); declaring them locally is what lets
 * `npm run typecheck` and `npm run lint` cover this directory with promptfoo absent.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import path from "node:path";

import { reviewDiff, type Review } from "../src/index.ts";

/** What promptfoo passes to the constructor. */
interface ProviderOptions {
  id?: string;
  config?: Record<string, unknown>;
}

/** What promptfoo passes as the second `callApi` argument. */
interface CallApiContext {
  vars: Record<string, unknown>;
}

/** promptfoo unions these: an `error` short-circuits the asserts rather than failing them. */
type ProviderResponse = { output: Review } | { error: string };

/**
 * The repo root, resolved from this file rather than from `process.cwd()`, so the sweep is
 * invariant to where it is launched from.
 *
 * It must be the repo root and not the package directory: `collectInstalledVersions` feeds
 * an "Installed versions (ground truth)" block into the prompt, and only the root manifest
 * carries react. Without it flaw 3 is unjudgeable — the system prompt forbids the model from
 * asserting anything about versions absent from that block, so it cannot reason about React
 * 19 semantics it has no ground truth for.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export default class ReviewProvider {
  readonly #id: string;
  readonly #model: string;

  constructor(options: ProviderOptions = {}) {
    // promptfoo always supplies the file path as `options.id`; the fallback is here so the
    // constructor is total, not because it is reachable in practice.
    this.#id = options.id ?? "file://./provider.ts";

    const model = options.config?.model;
    if (typeof model !== "string" || model.trim() === "") {
      throw new Error(`${this.#id}: config.model is required and must be a non-empty model id`);
    }
    this.#model = model;
  }

  id(): string {
    return this.#id;
  }

  async callApi(_prompt: string, context?: CallApiContext): Promise<ProviderResponse> {
    // promptfoo resolves a `file://` var to the file's *contents*, so this is the diff text.
    const diff = context?.vars.diff;
    if (typeof diff !== "string" || diff.trim() === "") {
      return { error: "vars.diff is missing or empty — check the file:// fixture path in the config" };
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      return { error: "OPENROUTER_API_KEY is missing — the sweep pays for both the candidates and the judge" };
    }

    try {
      const model = createOpenRouter({ apiKey })(this.#model);
      // No title or body: the sweep sends the bare diff. Naming the React version in PR
      // metadata would hand the model the one fact flaw 3 tests it for.
      const review = await reviewDiff(diff, { model, cwd: REPO_ROOT });
      // Returned as an object, not a string — promptfoo hands objects to `javascript`
      // asserts unparsed, which is what lets the asserts import the real `Review` type.
      return { output: review };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}
