/**
 * Diagnostic, not a test. Pipes the fixture through `reviewDiff` once with the incumbent
 * model and prints the parsed review plus the derived verdict.
 *
 * Run it when a sweep failure might be a fixture or prompt problem rather than a harness
 * problem — it exercises the whole review path with no promptfoo in the picture:
 *
 *   node --env-file-if-exists=.env --import tsx evals/check-fixture.ts
 *
 * Needs OPENROUTER_API_KEY — the `--env-file-if-exists` flag is what picks it up from
 * `.env`, exactly as the package's own `start` script does. `npx tsx evals/check-fixture.ts`
 * works too, but only if the key is already exported in your shell.
 *
 * No assertions and no exit-code contract; read the output.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { deriveVerdict, explainVerdict, reviewDiff } from "../src/index.ts";
import { EXPECTED_VERDICT, PLANTED_FLAWS } from "./fixtures/react19-migration.flaws.ts";

/**
 * The repo root, not the package directory — `collectInstalledVersions` reads the manifest
 * here, and the root manifest is the only one carrying react. Without it the ground-truth
 * block has no React version and the defaultProps flaw is unjudgeable: the system prompt
 * forbids the model from reasoning about versions absent from that block.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const FIXTURE = path.join(import.meta.dirname, "fixtures", "react19-migration.diff");

const diff = await readFile(FIXTURE, "utf8");

// Title and body deliberately never say "React 19": the sweep's provider sends the bare
// diff, so naming the version here would hand the model the one fact flaw 3 exists to test
// whether it takes from the ground-truth versions block instead.
const review = await reviewDiff(diff, {
  cwd: REPO_ROOT,
  title: "refactor(decks): migrate DeckSettingsPanel to a function component",
  body: "Converts the last class component to hooks and moves the root render to createRoot. No behaviour change intended.",
});

console.log(JSON.stringify(review, null, 2));
console.log(`\nverdict: ${deriveVerdict(review)} (expected: ${EXPECTED_VERDICT})`);
for (const reason of explainVerdict(review)) {
  console.log(`  - ${reason}`);
}

console.log("\nplanted flaws (judge decides these; this list is a reading aid):");
for (const flaw of PLANTED_FLAWS) {
  console.log(`  ${flaw.metric}: ${flaw.label}`);
}
