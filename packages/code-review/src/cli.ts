import { z } from "zod";

import { reviewDiff } from "./agents/reviewer/agent.ts";

/** One readable line. ZodError.message is a serialized issue array — unwrap it instead. */
function toMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    // Inside the try: a stdin read failure must reach the same one-line error
    // path as everything else, not escape as a stack trace from the top-level await.
    const diff = await readStdin();

    if (diff.trim() === "") {
      console.error("Usage: git diff | npm start");
      process.exitCode = 1;
      return;
    }

    const review = await reviewDiff(diff);
    console.log(JSON.stringify(review, null, 2));
  } catch (error) {
    // One readable line, not a zod or SDK stack — the missing-key message exists to be read.
    console.error(toMessage(error));
    process.exitCode = 1;
  }
}

await main();
