# Review Follow-ups

Queued from `/10x-impl-review` triage. Not fixed inline — tracked here for later pickup.

## Scope `fileParallelism: false` to the Supabase-dependent tests only

- **Source**: impl-review.md F2 (test-plan-refresh-2026-07-09)
- **Problem**: `vitest.config.ts:80` sets `fileParallelism: false` suite-wide to fix
  `risk9-purge-claim-hermetic.test.ts` and `risk9-reactivation-purge-race.test.ts`
  racing over shared `account_deletions`/purge rows against the same local Supabase
  instance. This serializes all ~16 test files (`tests/unit` + `tests/integration`),
  not just the two racing ones, slowing the whole suite as it grows.
- **Proposed fix**: scope serialization to just the Supabase-dependent integration
  tests via a Vitest `workspace`/`projects` split (e.g. a separate project for
  `tests/integration/**` with `fileParallelism: false`, leaving `tests/unit/**`
  parallel), or per-file `describe.sequential` if a workspace split is too heavy.
- **Not done now because**: needs a small Vitest config restructuring, out of scope
  for a review-triage fix; deferred to whoever next touches `vitest.config.ts` or
  test performance.
