import { NoObjectGeneratedError, type LanguageModel } from "ai";
import { readFile } from "node:fs/promises";
import { argv, stdin } from "node:process";
import { parseArgs } from "node:util";

import { reviewDiff } from "./agents/reviewer/agent.ts";
import { renderMarkdown } from "./agents/reviewer/render.ts";
import { deriveVerdict } from "./agents/reviewer/verdict.ts";

/**
 * Input cap, for token cost and context-window headroom — not to mirror an API limit.
 * The workflow diffs locally precisely because that has no ceiling, so this bound is a
 * deliberate cost choice. Measured post-exclusion diffs in this repo run 1 KB - 85 KB.
 */
export const MAX_DIFF_BYTES = 400_000;

export interface CliOptions {
  /** File holding the PR title. A file, never argv — no PR text passes through a shell. */
  titleFile?: string;
  /** File holding the PR description. Capped downstream by `MAX_BODY_CHARS`. */
  bodyFile?: string;
  /** The reviewed repository, for ground-truth dependency versions. */
  cwd?: string;
}

/** `parseArgs` from node:util — Node >= 22, so no argument-parsing dependency. */
export function parseCliArgs(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      "title-file": { type: "string" },
      "body-file": { type: "string" },
      cwd: { type: "string" },
    },
    strict: true,
  });

  return { titleFile: values["title-file"], bodyFile: values["body-file"], cwd: values.cwd };
}

/**
 * One readable line. `ZodError.message` is a serialized issue array, and
 * `NoObjectGeneratedError` hides its finish reason and the text the model actually
 * emitted behind a generic message — with no retry on this path, that detail is the
 * entire diagnostic budget for a failed review. Never include the API key or headers.
 */
export function toMessage(error: unknown): string {
  if (NoObjectGeneratedError.isInstance(error)) {
    const parts = [error.message, `finishReason: ${error.finishReason ?? "unknown"}`];
    if (error.text !== undefined && error.text !== "") {
      parts.push(`text: ${oneLine(error.text).slice(0, 400)}`);
    }
    return parts.join(" | ");
  }

  return oneLine(error instanceof Error ? error.message : String(error));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Reviews one diff and returns the envelope the composite action consumes. There is
 * deliberately no `--format` flag: the action needs JSON, and a human preview is one
 * `jq -r .markdown` away.
 */
export async function runReview(diff: string, options: CliOptions & { model?: LanguageModel } = {}): Promise<string> {
  const bytes = Buffer.byteLength(diff, "utf8");
  if (bytes > MAX_DIFF_BYTES) {
    throw new Error(
      `diff is ${String(bytes)} bytes, above the ${String(MAX_DIFF_BYTES)}-byte cap — narrow the PR or raise MAX_DIFF_BYTES`,
    );
  }

  const review = await reviewDiff(diff, {
    model: options.model,
    cwd: options.cwd,
    title: await readOptional(options.titleFile),
    body: await readOptional(options.bodyFile),
  });
  const verdict = deriveVerdict(review);

  return JSON.stringify({ verdict, review, markdown: renderMarkdown(review, verdict) }, null, 2);
}

/** A missing metadata file degrades the prompt; it never fails the review. */
async function readOptional(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) {
    return undefined;
  }
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    // Inside the try: a stdin read failure must reach the same one-line error
    // path as everything else, not escape as a stack trace from the top-level await.
    const options = parseCliArgs(argv.slice(2));
    const diff = await readStdin();

    if (diff.trim() === "") {
      console.error("Usage: git diff | npm start -- [--title-file F] [--body-file F] [--cwd DIR]");
      process.exitCode = 1;
      return;
    }

    console.log(await runReview(diff, options));
  } catch (error) {
    // One readable line, not a zod or SDK stack — the missing-key message exists to be read.
    console.error(toMessage(error));
    process.exitCode = 1;
  }
}

// Only when run as a program. Importing this module — which the CLI tests do — must not
// block on stdin, which is what a bare top-level `await main()` would do.
if (argv[1] !== undefined && import.meta.filename === argv[1]) {
  await main();
}
