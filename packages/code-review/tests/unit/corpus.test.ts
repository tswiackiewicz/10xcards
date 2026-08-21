/**
 * Guards for the calibration corpus in `evals/corpus/`.
 *
 * The corpus is a hand-run A/B harness, not part of `npm run eval` — but it is the only
 * hand-scored baseline a future rubric change can regression-check against, and a fixture that
 * drifts silently is worse than no fixture: the replay still runs and still produces a table.
 *
 * Two invariants, both cheap and both things that actually went wrong once:
 *  1. The diffs are reconstructed from merge commits, and their byte sizes are the only proof
 *     they were not hand-edited. `evals/corpus/README.md` records them; so does this test.
 *  2. `pr-<n>.title` / `pr-<n>.body` exist purely so the CLI can be fed without a `jq` step.
 *     The JSON is the record — so if someone corrects a title there, these copies must follow.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CORPUS = path.join(import.meta.dirname, "../../evals/corpus");

/** From context/archive/2026-08-14-ci-cd-code-review/change.md:19-25, verified 2026-08-21. */
const RECORDED_BYTES: Record<number, number> = {
  1: 2581,
  3: 10129,
  5: 34831,
  6: 1164,
  7: 82567,
};

const ENTRIES = Object.keys(RECORDED_BYTES).map(Number);

interface CorpusEntry {
  number: number;
  title: string;
  body: string;
  handScored: "passed" | "failed";
  citation: string;
}

const read = (name: string) => readFileSync(path.join(CORPUS, name), "utf8");
const entry = (n: number) => JSON.parse(read(`pr-${String(n)}.json`)) as CorpusEntry;

describe("calibration corpus", () => {
  it.each(ENTRIES)("pr-%i.diff matches its recorded byte size", (n) => {
    expect(statSync(path.join(CORPUS, `pr-${String(n)}.diff`)).size).toBe(RECORDED_BYTES[n]);
  });

  it.each(ENTRIES)("pr-%i.title and .body match the JSON record", (n) => {
    const record = entry(n);
    expect(read(`pr-${String(n)}.title`)).toBe(record.title);
    expect(read(`pr-${String(n)}.body`)).toBe(record.body);
  });

  it.each(ENTRIES)("pr-%i.json carries a verdict and its provenance", (n) => {
    const record = entry(n);
    expect(record.number).toBe(n);
    expect(["passed", "failed"]).toContain(record.handScored);
    // Every baseline verdict must cite where it came from — #3's is a correction of the raw
    // table, and an uncited entry is how that correction gets silently reverted.
    expect(record.citation).toContain("change.md");
  });

  it("pins the corrected baseline: only PR #7 is failed", () => {
    const failed = ENTRIES.filter((n) => entry(n).handScored === "failed");
    expect(failed).toEqual([7]);
  });
});
