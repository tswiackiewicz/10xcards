---
title: "10xArchitect — Module 4 Summary Report"
created: 2026-07-21
type: architect-summary
---

# 10xArchitect — Module 4 Summary Report

Synthesizes four Module 4 artifacts, spanning **two different repositories**. No fact below is inferred beyond what its source artifact states; gaps are marked `BRAK artefaktu`.

## 1. Projects described

| Repo                                    | Stack                                                                                                                       | Scale (orientational)                                                                                                                                                                                                               | Artifact                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **`composer`** (PHP dependency manager) | PHP; tooling: deptrac (import-cycle analysis), phpstan, PHPUnit (`composer test`)                                           | No total LOC/file count stated anywhere in the artifacts (`BRAK artefaktu`). Orientation via cited signals: `Installer.php` fan-out 49, `IO\IOInterface` fan-in 512/73 files, 12-month git activity window (2025-07-14→2026-07-14). | L2 (repo-map), L3 (research), L4 (plan) |
| **10xCards** (this repo)                | Astro 6 (`output: server`), React 19 islands, TypeScript, Supabase (Postgres+Auth, RLS), Cloudflare Workers, Zod, `ts-fsrs` | Greenfield MVP, explicitly scoped to "three weeks" (`prd.md:175-177`, cited in L5/03); 2 DB tables (`flashcards`, `account_deletions`)                                                                                              | L5 (domain notes, 4 files)              |

## 2. Repo map (L2 — `composer`)

- **Responsibility is invisible in folder structure**: "Core" (`Composer.php`, `Config.php`, `Installer.php`) is loose files, not a folder, yet they're the #1/#3 most-changed files repo-wide and the import hub (repo-map lines 45-48).
- **New security cluster already reproduced legacy's worst pattern**: `Advisory/Policy/FilterList`, built over the last two quarters mostly by one contributor, already has its own import cycle and zero interfaces — the same problem as the old `Util↔Downloader↔Repository` pipeline, not something newly avoided (lines 14-21).
- **Entry points**: CLI/Console is the only "clean" consumer of the whole graph; onboarding read order starts `Composer.php → Config.php → Console/Application.php → Installer.php → Advisory/Auditor.php → Policy/PolicyConfig.php → DependencyResolver/Pool.php` (section 6).
- **Biggest unknowns**: the import graph (deptrac) covers only `src/Composer/**/*.php` — zero visibility into CI YAML, docs, JSON schema, phpstan baseline (lines 121-124); `Package/Json/IO/Config(dir)/Console` are known to deptrac but never analyzed for cycles/testability (lines 129-131).
- **Top risk zone**: `FilterList↔Policy` cycle — freshly written code reproducing the legacy anti-pattern instead of avoiding it, ranked #1 ahead of the much older `Util` cycle (line 83, risk table row 1).

## 3. Feature analysis (L3 — `composer`)

**Flow investigated**: `Policy↔FilterList`, directly because it _is_ repo-map's risk zone #1 (research.md line 36 cites this explicitly).

**Feature overview**: `Policy` (`src/Composer/Policy/`) is the config model — parses `composer.json`'s `policy` key (with legacy `audit.*` fallback) into typed sub-configs (advisories, malware, abandoned, custom lists). `FilterList` (`src/Composer/FilterList/`) fetches remote filter-list data, parses it, and matches it against resolver candidates. State changes inside `FilterListPoolFilter`, invoked from `PoolBuilder::buildPool()`: matched package versions are **silently dropped from the resolver's `Pool`** before the SAT solver runs — no error at match time. The only externally visible outcome is a `SolverProblemsException`/CLI error, and only if the solver actually needed the dropped package; `composer audit` reuses the identical fetch/match machinery but only reports, never mutates a `Pool`.

**Technical debt (top 3):**

1. The `Policy↔FilterList` cycle is real and self-inflicted, not inherited — **zero interfaces exist in either directory**, confirmed by ast-grep: `interface $NAME { $$$BODY }` over both dirs → 0 hits, cross-checked with plain `grep` (research.md ast-grep table row 1, verdict **Confirmed**).
2. The resolver's hot path (`FilterListPoolFilter::filter()`, inside `PoolBuilder::buildPool()`) performs live, uncached HTTP with no seam to intercept it; the custom-list fetch path can run twice per `composer update` (`Installer.php:534` and `:808`, ast-grep row 23, **Confirmed**).
3. Test coverage gaps sit exactly on the cycle boundary: `SourceValidator` has no dedicated test file (3 of 4 `RuntimeException` branches untested) and `FilterListProviderSet::create()` — the factory that closes the cycle — is never called in its own test file (ast-grep rows 13/15).

## 4. Refactor plan (L4 — `composer`)

**Scope**: 3 of 6 debt candidates from L3, in priority order — **C1** (`Policy↔FilterList` cycle, split into C1a constants extraction + C1b interface introduction), **C4** (resolver hot-path seam), **C3** (`Repository↔FilterList` cycle). Target shape: the cycle becomes one-directional (`Policy→FilterList` only, via a `FilterList`-owned `PolicyConfigInterface`); reserved-name constants move to a neutral `Composer\ReservedListNames`; `Installer::run()` builds at most one shared `FilterListProviderSet`; `ComposerRepository` delegates its api-url/summary-url fetch tiers to a new `FilterList`-owned collaborator, mirroring the pattern `FilterRepository` already uses.

**Explicitly NOT doing**: C2 (`Config↔PolicyConfig` cycle — cheapest but lowest urgency); C5 (duplicated BC-migration logic — found mostly already appropriately centralized); C6 (schema/`PolicyConfig` hand-sync — needs a repo-wide tooling initiative); the reverse `Policy→FilterList` validator-reuse edge (kept as-is); `ComposerRepository`'s tier-3 per-package fetch (shares machinery with ordinary package loading, not cleanly extractable); no `deptrac.yaml` CI enforcement added.

**Phases:**

1. Prerequisite tests (`SourceValidator`, `FilterListProviderSet::create()`) — verified **auto** (`composer test`, `composer phpstan`).
2. C1a — extract reserved-name constants to `ReservedListNames` — verified **auto** (suite+phpstan) + **manual** grep confirming no stale references remain.
3. C1b — introduce `FilterList`-owned `PolicyConfigInterface` — verified **auto** (suite+phpstan) + **manual** grep confirming concrete `PolicyConfig` import is gone from `FilterList/`.
4. C4 — single shared, memoized `FilterListProviderSet` per `Installer::run()` — verified **auto** (updated `FilterListPoolFilterTest`, new single-construction test, full suite+phpstan) + **manual** fixture-equivalent `composer update` with custom list + audit enabled.
5. C3 — extract `ComposerRepositoryFilterFetcher` collaborator + dead-import cleanup — verified **auto** (existing repository/filter tests unchanged, full suite+phpstan) + **manual** `composer update`/`show` across all three fetch tiers.

## 5. Domain per DDD (L5 — 10xCards)

**Ubiquitous language (key terms + drifts):**

- **Flashcard** — question/answer pair owned by one user, AI- or manually-sourced.
- **Candidate** — an AI-proposed pair not yet persisted; exists only in the `generate` response and client state.
- **Deck** — **drift**: PRD language treats it as a first-class concept ("their deck"), but no `decks` table exists — it's purely `flashcards` filtered by `user_id` via RLS (01, Step 4 row 1).
- **Review** — **drift**: PRD's "review" means accept/edit/reject of a candidate (FR-004); the only code artifact literally named `review.ts` implements something else — recording an FSRS recall grade (01, Step 4 row 2).
- **Source** — provenance tag (`ai`/`manual`); `SRS state`/`Due card` — FSRS scheduling fields.

**Invariant #1**: _"No AI-generated flashcard enters a user's deck without explicit human acceptance of that specific candidate; rejected/pending candidates leave no trace"_ (02, Step 1, I3) — chosen over 6 other invariants for being simultaneously the most core (the PRD's stated product wedge) and the most weakly enforced (client-side only). It belongs to the newly designed **`GenerationBatch` aggregate** (with `Candidate` as its internal value object), replacing today's no-aggregate gap where `POST /api/flashcards` accepts any `{question, answer}` array and unconditionally tags it `"ai"` (02, Step 4).

**Anti-Corruption Layer**: the leaking dependency is `ts-fsrs`'s internal `Card` shape (`due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state`, `last_review`). The package itself is imported in exactly one file, but its **field shape** was copied verbatim into the DB schema and then propagated, unfiltered, through **all 4 layers**: persistence (migration) → domain type (`Flashcard`) → wire contract (`NextCardResponse.card`) → client-hydrated UI props (`StudyView.tsx`, `SavedCardsView.tsx`) — 10 files total (03, Step 1 / Step 2 table).

## 6. Decisions that belong to me

These four artifacts don't preserve a separate log distinguishing "AI proposed" from "human decided" — each document's Step-2-style selection (I3 over I5 in L5/02; Candidate A over B in L5/03; C1/C3/C4 over C2/C5/C6 in L4) is presented as the artifact's own scored ranking, not as a record of a human override (`BRAK artefaktu` for that distinction). What the artifacts _do_ flag as needing a human call rather than deciding it themselves: the `BATCH_TTL_MINUTES` default of 60 minutes is explicitly marked "a product decision to confirm, not silently hardcode" (L5/02, Step 4); and L3's Open Questions punt at least two calls to a human owner — whether the `Config↔PolicyConfig` cycle was an intentional design choice, and whether the uncached-vs-cached fetch asymmetry between custom and repo-advertised filter lists was a deliberate trade-off or an oversight. Those are the concrete points where, per the source documents, a person — not the analysis — needs to make the call.
