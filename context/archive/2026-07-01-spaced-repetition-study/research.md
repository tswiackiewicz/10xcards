---
date: 2026-07-01T21:13:12+0200
researcher: tswiackiewicz
git_commit: 0f267caef9fd16738d12781c9a4aa5174fc16e1e
branch: master
repository: 10xdevs
topic: "Does the ts-fsrs library fit S-04 (spaced-repetition-study)?"
tags: [research, codebase, s-04, spaced-repetition, ts-fsrs, cloudflare-workers, supabase, rls]
status: complete
last_updated: 2026-07-01
last_updated_by: tswiackiewicz
---

# Research: Does the ts-fsrs library fit S-04 (spaced-repetition-study)?

**Date**: 2026-07-01T21:13:12+0200
**Researcher**: tswiackiewicz
**Git Commit**: 0f267caef9fd16738d12781c9a4aa5174fc16e1e
**Branch**: master
**Repository**: 10xdevs

## Research Question

Does the `ts-fsrs` library fit S-04 (spaced-repetition-study) from
`context/foundation/roadmap.md`? S-04's outcome is "user can study a deck through a
spaced-repetition schedule — the product decides which card to show next based on
prior recall" (FR-009), with the hard constraint that we **integrate a ready-made
scheduler, not build one** (PRD Non-Goal).

Scope (confirmed with user): full fit verdict **plus** an integration blueprint,
verifying four risks — edge-runtime compatibility, schema/state persistence,
Non-Goal drift, and the four agent-friendly quality gates.

## Summary

**Verdict: YES — ts-fsrs is a strong fit for S-04. Recommended, with one cheap
gate to close before locking the plan.**

- **FR-009 fit — clean.** ts-fsrs owns the scheduling math (`repeat()` previews all
  four grades; `next()` commits the chosen grade and returns the new `due` date).
  "Which card to show next" is then a plain Supabase query — `where due <= now order
by due` — over a persisted `due` column. The split matches FR-009 exactly.
- **Non-Goal — satisfied.** Using `fsrs()`/`repeat()`/`next()` is integrating a
  ready-made scheduler; the memory-model weights are internal. FSRS is the modern
  successor to SM-2 and is maintained by the **open-spaced-repetition** org (the same
  org behind the FSRS algorithm and the Anki FSRS work) → canonical TS implementation.
- **Edge-runtime — VERIFIED on `workerd` (2026-07-01).** A throwaway Worker importing
  `ts-fsrs@5.4.1` (`createEmptyCard` → `repeat` → `next`) ran clean under `wrangler dev`
  **without the `nodejs_compat` flag** — no Node-compat warnings, no bundling externals,
  all 9 persistable fields returned. See "Edge-runtime compatibility" below for the
  transcript. The prior static scan (zero-dependency, pure ESM, no Node built-ins, no
  `Math.random`) is confirmed by live execution.
- **Schema — additive, already anticipated.** F-01's plan _deliberately deferred_ SRS
  columns ("S-04's algorithm is unpicked; those fields would be guesses. Out of
  scope."). The existing RLS policies are table-level (`auth.uid() = user_id`), so new
  scheduling columns added to `flashcards` **inherit owner isolation with no new
  policies**. Nine `Card` fields need persisting; all map cleanly to Postgres types.
- **Quality gates — 3.5/4.** Typed ✅, convention-based ✅, popular/canonical ✅
  (~79k downloads/week, MIT). Well-documented is a partial: strong README + TypeDoc +
  shipped `.d.ts`, but **no `llms.txt`/agent-readable docs endpoint** (the specific
  signal the lesson prizes). The shipped types compensate for agent grounding.
- **License — MIT.** Fine for commercial SaaS.

The only real unknown the roadmap flagged ("which SRS library to integrate") is
answered by this research: **ts-fsrs**. No blockers found.

## Detailed Findings

### FR-009 fit — the generate/select split

ts-fsrs (`ts-fsrs@5.4.1`) exposes exactly the surface FR-009 needs:

- `fsrs(params?)` → scheduler instance; `generatorParameters(partial?)` fills defaults.
- `createEmptyCard(now?)` → fresh `Card` in `State.New`.
- `scheduler.repeat(card, now)` → **preview** all four outcomes keyed by `Rating`
  (Again/Hard/Good/Easy), each `{ card, log }`. Drives a "next interval per button" UI.
- `scheduler.next(card, now, grade)` → **commit** the chosen grade; returns one
  `RecordLogItem` whose `card.due` is the next due date to persist.

Minimal shape (matches shipped types):

```ts
import { fsrs, createEmptyCard, Rating } from "ts-fsrs";

const scheduler = fsrs(); // default FSRS-6 params
const card = createEmptyCard(new Date()); // State.New
const { card: updated } = scheduler.next(card, new Date(), Rating.Good);
// persist updated.due, updated.stability, updated.difficulty, ...
```

**"Product decides which card to show next"** = a query over the stored `due`
column (`due <= now`, order by `due`), which follows the existing read pattern in
`src/pages/cards.astro:12` (`.select("*").order("created_at", ...)`, RLS-scoped).
The scheduling math lives in the library; card _selection_ is our query. This is the
clean split FR-009 describes.

> Note: ts-fsrs has no `scheduling_cards` object — that name is from the older
> `fsrs.js`. The equivalent here is the `RecordLog`/preview returned by `repeat()`.

### State fields to persist (feeds the migration)

Exact `Card` interface (verified from the shipped `dist/index.d.ts`):

| `Card` field     | JS type               | Persist | Postgres column                                     |
| ---------------- | --------------------- | ------- | --------------------------------------------------- |
| `due`            | `Date`                | yes     | `timestamptz NOT NULL`                              |
| `stability`      | `number`              | yes     | `double precision`                                  |
| `difficulty`     | `number`              | yes     | `double precision`                                  |
| `scheduled_days` | `number` (int)        | yes     | `integer`                                           |
| `learning_steps` | `number` (int)        | yes     | `integer`                                           |
| `reps`           | `number` (int)        | yes     | `integer`                                           |
| `lapses`         | `number` (int)        | yes     | `integer`                                           |
| `state`          | `State` enum (`0..3`) | yes     | `smallint` (New=0/Learning=1/Review=2/Relearning=3) |
| `last_review`    | `Date \| undefined`   | yes     | `timestamptz NULL`                                  |
| `elapsed_days`   | `number`              | **no**  | — (`@deprecated`, derived, recomputed)              |

Two gotchas for whoever writes the migration:

- **`learning_steps` is a real field in v5.4.1** and must be stored, or short-term
  (re)learning steps misbehave on reload. It is easy to miss (not in most tutorials).
- **`elapsed_days` is `@deprecated`** ("removed in 6.0.0"); it is derived — do not
  build the schema around it.

Round-tripping through Supabase JSON works if ISO strings are converted back to
`Date` (ts-fsrs accepts `DateInput = Date | number | string` and ships `fixDate` /
`fixState` helpers).

### Edge-runtime compatibility (the load-bearing deploy risk)

**VERIFIED — runs on `workerd` (2026-07-01 smoke test).** An isolated Worker
(`wrangler.jsonc` with only `compatibility_date: "2026-05-08"`, **no `nodejs_compat`**)
importing `ts-fsrs@5.4.1` and running `createEmptyCard(now)` → `repeat()` → `next(…,
Rating.Good)` served a clean `200`:

```
State New → Learning after "Good"; due→+10min, stability 2.3065, difficulty 2.118,
reps 1, lapses 0, learning_steps 1, last_review set. All 4 grade previews returned
(Again +1m, Hard +6m, Good +10m, Easy +8d).
```

`wrangler dev` log showed **no `nodejs_compat` warning, no `node:` externals, no
bundling errors** — the flag was not needed. `npm i ts-fsrs` reported `added 1
package` (zero transitive deps confirmed). This upgrades the earlier static-scan
verdict to a live-execution one. Static-scan evidence (still valid) from the packed
`dist/index.mjs`:

- **Zero dependencies** (npm registry `dependencies: none`).
- Grep for `require`, `node:*`, `fs|crypto|buffer|process|path|os|util|stream|http|net`,
  `Buffer`, `__dirname`, `process.env`, `globalThis.crypto` → **no matches**.
- Only runtime APIs touched: `new Date`, `Date.now`, `Symbol` — all on Workers.
- **No `Math.random`**: the `enable_fuzz` feature uses a seeded PRNG
  (`DefaultInitSeedStrategy`) → deterministic, no `crypto` needed.
- Pure ESM (`"type": "module"`, `exports.import → dist/index.mjs`); Astro/Vite pick
  the ESM build. ESM entry ~59 KB pre-bundler source, tree-shakeable → not a
  Workers bundle-size concern.
- `engines.node: ">=20"` is an install-time hint only; nothing in the code path
  needs Node 20 runtime APIs.

Our stack already tolerates this: `wrangler.jsonc` sets `compatibility_flags:
["nodejs_compat"]` (compat date `2026-05-08`) — but the scan says ts-fsrs won't even
need it.

There is still no _first-party_ "runs on Workers" statement in the ts-fsrs docs, but
the local `workerd` execution above closes the gap — this is the same runtime
`wrangler deploy` ships to. Residual risk is negligible.

### Agent-friendly quality gates (the project's 4-gate filter)

- **(a) Typed — PASS.** Written in TS; ships 23 KB `dist/index.d.ts` with first-class
  `Card`, `Rating`, `State`, `FSRSParameters`, `RecordLogItem`.
- **(b) Convention-based — PASS.** Small opinionated surface (`fsrs()` → `repeat()` /
  `next()`), enums for `Rating`/`State`, obvious entry points. Advanced strategy layer
  is ignorable.
- **(c) Popular / canonical — PASS.** ~79,398 downloads/week (~297k/month), ~699
  GitHub stars, published by **open-spaced-repetition** (the FSRS algorithm's own
  org) → the standard TS FSRS lib.
- **(d) Well-documented — PARTIAL.** Good README with runnable examples, TypeDoc API
  ref, state-transition diagram, shipped `.d.ts`. **Misses `llms.txt`/`/md`
  agent-readable docs** — the one signal the lesson prizes. Types compensate.

### Non-Goal check

Using ts-fsrs = integrating a ready-made scheduler; you never implement memory-model
math. FSRS is the modern successor to SM-2 (the algorithm Anki adopted). **ts-fsrs is
FSRS-only — no SM-2** (verified from bundle + README); for a new feature FSRS is the
better default anyway. This satisfies the PRD Non-Goal ("no custom spaced-repetition
algorithm", `context/foundation/prd.md:154-156`) and the roadmap Parked item.

### Alternatives (why ts-fsrs wins)

- **`fsrs.js`** — older JS port by the same org; superseded by ts-fsrs (TS-native,
  actively maintained, higher FSRS version). Prefer ts-fsrs.
- **`supermemo`** — tiny SM-2-only lib; weaker scheduling, small community. Only if
  you specifically wanted SM-2.
- **`fsrs-rs-nodejs`** — Rust-backed native bindings for _training_ per-user weights;
  **native module → will not run on Workers**. Not needed for scheduling; if per-user
  optimization is wanted later, run it off-edge as a batch job.

## Integration Blueprint (feeds `/10x-plan`)

Concrete shape, grounded in the existing F-01/S-01/S-03 patterns:

1. **Dependency:** `npm i ts-fsrs` (zero transitive deps). Gate: `wrangler dev` smoke
   import before locking the plan.
2. **Migration** — new timestamped file `supabase/migrations/<ts>_add_srs_state.sql`
   (convention: `supabase/migrations/20260624185919_create_flashcards.sql`). Add the 9
   `Card` columns above to `public.flashcards` as **nullable** (existing rows predate
   scheduling; a `NULL due` = "never studied / needs init"). **No new RLS policies** —
   the four table-level policies (`supabase/migrations/20260624185919_create_flashcards.sql:52-75`)
   already scope every column to `auth.uid() = user_id`. Re-run the RLS verification
   script pattern from F-01 (`scripts/verify-rls.mjs`) to confirm — RLS correctness is
   a launch gate, "verified, not assumed."
3. **Regenerate types:** `npx supabase gen types` → `src/db/database.types.ts`, so
   `Flashcard` row type gains the new fields (single source of truth).
4. **Scheduler helper:** `src/lib/flashcards/srs.ts` — thin wrapper around `fsrs()`,
   maps DB row ↔ ts-fsrs `Card` (ISO string ↔ `Date` via `fixDate`), exports
   `previewGrades(card)` and `applyGrade(card, rating, now)`.
5. **API endpoints** (mirror `src/pages/api/flashcards/[id].ts` auth + RLS + 0-row-404
   pattern):
   - `GET /api/flashcards/study/next` → next due card (`due <= now order by due`,
     RLS-scoped; `null due` first-time init).
   - `PATCH /api/flashcards/[id]/review` → body `{ rating }`, validate with Zod, call
     `applyGrade`, `.update({...srsFields}).eq("id", id).select("id")`, **treat 0 rows
     as `404 not_found`** (the S-03 lesson, `context/archive/2026-07-01-manage-saved-flashcards/plan.md:88-93`).
     `user_id` never trusted from the body (S-01 lesson).
   - Extend the `ApiErrorCode` enum (`src/lib/flashcards/schemas.ts:40-49`) with e.g.
     `invalid_rating`.
6. **UI:** new protected route `/study` (add to `PROTECTED_ROUTES` in
   `src/middleware.ts:4` alongside `/cards`), server-loads the next due card like
   `cards.astro`, renders a React island (show question → reveal answer → four grade
   buttons using `repeat()` previews for interval hints).
7. **Verify:** `npx astro sync && lint && build` (the `/verify` skill) + the RLS
   script.

Watch the Cloudflare free-tier caps (S-01 infra lesson): keep each request to one
model-free scheduler call + minimal Supabase round-trips; the scheduler math is
in-memory and cheap.

## Code References

- `supabase/migrations/20260624185919_create_flashcards.sql:11-19` — flashcards table columns (no SRS state yet).
- `supabase/migrations/20260624185919_create_flashcards.sql:52-75` — four owner-scoped RLS policies (table-level; new columns inherit).
- `src/lib/flashcards/schemas.ts:40-49` — `ApiErrorCode` enum to extend.
- `src/pages/api/flashcards/[id].ts:19-63` — PATCH pattern (auth → validate → update → 0-row-404) to mirror for `/review`.
- `src/pages/api/flashcards/[id].ts:65-93` — DELETE pattern (0-row detection).
- `src/pages/api/flashcards/index.ts:16-55` — insert pattern; `user_id` from session, never request.
- `src/pages/cards.astro:7-26` — server-side RLS-scoped read + React island hand-off (template for `/study`).
- `src/components/flashcards/SavedCardsView.tsx:257-307` — client card-view pattern to mirror for a study view.
- `src/lib/supabase.ts:6-25` — per-request cookie-based SSR client (`createServerClient`).
- `src/middleware.ts:4` — `PROTECTED_ROUTES` to add `/study` to.
- `astro.config.mjs` — `output: "server"`, `cloudflare()` adapter.
- `wrangler.jsonc` — `compatibility_flags: ["nodejs_compat"]`, compat date `2026-05-08`.
- `package.json` — Astro `^6.3.1`, `@astrojs/cloudflare ^13.5.0`, React `^19.2.6`, `zod ^4.4.3`.

## Architecture Insights

- **Schema was intentionally left open for S-04.** F-01 deferred scheduling columns on
  purpose rather than guessing them — so adding SRS state now is the _planned_ path,
  not a retrofit. RLS being table-level means the isolation guardrail extends to the
  new columns for free.
- **The "generate vs. select" split is the right seam.** ts-fsrs computes state; the
  app selects the next card by querying `due`. This keeps the library at the edge
  doing cheap in-memory math and leverages Postgres/RLS for selection + isolation.
- **Established endpoint idioms carry straight over:** session-derived `user_id`,
  Zod-validated input mirroring DB CHECKs, `.select()` after mutations to turn
  RLS-hidden rows into `404 not_found`, typed `ApiErrorCode` union.
- **Edge constraints favor ts-fsrs specifically:** zero-dep pure-ESM with no Node
  built-ins is close to ideal for Workers; the Rust-backed optimizer variant is the
  one to avoid on-edge.

## Historical Context (from prior changes)

- `context/archive/2026-06-24-flashcard-store-rls/plan.md:58-59` — **explicit SRS
  deferral:** "No SRS/scheduling columns (due date, interval, ease) — S-04's algorithm
  is unpicked; those fields would be guesses. Out of scope."
- `context/archive/2026-06-24-flashcard-store-rls/plan.md:11` — "The load-bearing risk
  is RLS correctness: getting it wrong is a silent cross-user-visibility regression, so
  isolation is verified with a repeatable script, not assumed."
- `context/archive/2026-06-24-flashcard-store-rls/reviews/plan-review.md:36-54` —
  GRANT vs RLS gotcha: RLS governs which rows, GRANT governs table access at all
  (relevant if S-04 ever adds a separate table).
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md:88-93` — **0-row
  mutation = `404 not_found`**, not silent success (RLS hides non-owned rows).
- `context/archive/2026-06-25-ai-card-generation/plan.md:107` — user resolved from the
  RLS client, never trusted from the request body.
- `context/foundation/prd.md:154-156` — Non-Goal: "No custom spaced-repetition
  algorithm … a deliberate buy-not-build decision."
- `context/foundation/roadmap.md:134-136` — S-04 Unknown: "Which ready-made SRS
  algorithm/library to integrate … Block: no (selectable at plan time)." → **answered
  here: ts-fsrs.**

## Related Research

- `context/archive/2026-06-24-flashcard-store-rls/research.md` — the store this feature extends.
- `context/archive/2026-06-25-ai-card-generation/` — S-01, the primary card producer.
- No `context/foundation/lessons.md` exists yet; recurring rules (RLS verification,
  0-row-404, session-derived user_id) live in the archived plans/reviews above and are
  candidates for a `/10x-lesson` capture.

## Open Questions

1. ~~**Edge smoke test:** confirm `ts-fsrs` imports and runs under `wrangler
dev`/`workerd`.~~ **CLOSED (2026-07-01)** — ran clean on `workerd` with no
   `nodejs_compat`; see "Edge-runtime compatibility" above.
2. **Re-study / reset semantics:** when a user finishes a deck, is scheduling state
   reset or does it persist indefinitely? Not specified by FR-009 — a plan-time
   product decision.
3. **FSRS params:** ship default FSRS-6 params, or expose `request_retention`
   (target recall) as a setting? Default is fine for MVP; note as future work.
4. **Per-user weight optimization:** out of scope for S-04 (requires the native
   Rust optimizer, which must run off-edge). Park it.
5. **Docs gate (d):** ts-fsrs lacks `llms.txt`/agent-readable docs. Accept (types +
   TypeDoc compensate) — worth a one-line note in the plan's stack rationale.
