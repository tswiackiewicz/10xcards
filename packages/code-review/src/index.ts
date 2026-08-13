import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string("OPENROUTER_API_KEY is missing — copy .env.example to .env").min(1),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-haiku-4.5"),
});

export function getModel() {
  const env = envSchema.parse(process.env);
  return createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })(env.OPENROUTER_MODEL);
}

export const reviewSchema = z.object({
  summary: z.string().describe("One-sentence verdict on the diff"),
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive(),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
    }),
  ),
});

export type Review = z.infer<typeof reviewSchema>;

/** Installed versions of direct dependencies, so the model never has to guess them. */
async function installedVersions(cwd: string): Promise<string[]> {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as typeof manifest;
  } catch {
    return [];
  }

  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const rows = await Promise.all(
    names.map(async (name) => {
      try {
        const pkg = JSON.parse(await readFile(join(cwd, "node_modules", name, "package.json"), "utf8")) as {
          version: string;
        };
        return `${name}@${pkg.version}`;
      } catch {
        return null;
      }
    }),
  );

  return rows.filter((row) => row !== null);
}

export async function reviewDiff(diff: string, cwd = process.cwd()): Promise<Review> {
  const versions = await installedVersions(cwd);

  const { output } = await generateText({
    model: getModel(),
    system: [
      "You are a code reviewer. Review the unified diff you are given.",
      "Report only concrete defects in the changed lines; anchor each finding to a file and line from the diff.",
      "Return no findings when the diff is fine.",
      "Never judge whether a dependency version, package or model id exists, is current, or looks plausible —",
      "your training data is older than the ecosystem, so such claims are guesses, not findings.",
      "Treat the installed versions listed in the prompt as ground truth and say nothing about versions absent from it.",
    ].join(" "),
    prompt: versions.length > 0 ? `Installed versions (ground truth):\n${versions.join("\n")}\n\nDiff:\n${diff}` : diff,
    output: Output.object({ schema: reviewSchema }),
  });

  return output;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const diff = await readStdin();

  if (diff.trim() === "") {
    console.error("Usage: git diff | npm start");
    process.exitCode = 1;
    return;
  }

  const review = await reviewDiff(diff);
  console.log(JSON.stringify(review, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
