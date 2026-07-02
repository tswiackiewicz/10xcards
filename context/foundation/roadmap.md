---
project: "10xCards"
version: 1
status: draft
created: 2026-06-23
updated: 2026-07-02
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline (2026-06-23).
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Manually authoring study flashcards is slow enough that it discourages people from
adopting spaced repetition at all. 10xCards removes that friction: a learner pastes
source text they already have, AI proposes candidate cards, the learner reviews them
(accept / edit / reject), and accepted cards land in a per-user deck they can study on
a spaced-repetition schedule.

The product wedge — the one trait that, if removed, makes the product indistinguishable
from a generic AI chat tool — is that cards are **AI-generated from the learner's own
pasted text AND human-gated** before they enter the deck: never silently auto-saved,
never built on a hand-authored card the learner had to write first. That pairing
(generation + review loop, in one package) is what existing tools rarely combine.

## North star

**S-01: User can paste text, get AI candidates, and accept/edit/reject them into their deck** — this is the validation milestone because the product's central bet is "AI cards are good enough that learners accept ~75% of them"; if that fails, the SRS loop and management features are moot.

> "North star" here means the smallest end-to-end slice whose successful delivery would
> prove the core product hypothesis — placed as early as its Prerequisites allow, because
> everything else only matters if this works.

## At a glance

| ID   | Change ID               | Outcome (user can …)                                            | Prerequisites | PRD refs                                        | Status  |
| ---- | ----------------------- | --------------------------------------------------------------- | ------------- | ----------------------------------------------- | ------- |
| F-01 | flashcard-store-rls     | (foundation) per-user flashcard store with RLS isolation lands  | —             | Access Control, NFR(no-loss), Guardrails        | done    |
| S-01 | ai-card-generation      | paste text, get AI candidates, accept/edit/reject into the deck | F-01          | FR-003, FR-004, US-01, NFR(progress), NFR(GDPR) | done    |
| S-02 | manual-card-authoring   | create a flashcard manually                                     | F-01          | FR-005                                          | done    |
| S-03 | manage-saved-flashcards | view, edit, and delete saved flashcards                         | F-01, S-01    | FR-006, FR-007, FR-008                          | done    |
| S-04 | spaced-repetition-study | study a deck through a spaced-repetition schedule               | F-01, S-01    | FR-009                                          | done    |
| S-05 | account-deletion        | request account deletion, kept 30 days, then permanently erased | F-01          | GDPR NFR (+ new FR, see Open Q3)                | planned |
| S-06 | ux-improvements         | bulk-action candidates, reset a review session, clearer loading | F-01, S-01    | FR-004, NFR(progress)                           | planned |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain           | Note                                                                                                 |
| ------ | ------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| A      | AI card pipeline    | `F-01` → `S-01` | The wedge + the store it writes to. Speed bias places this first.                                    |
| B      | Manual authoring    | `S-02`          | Needs only `F-01`; runs parallel with `S-01` (fallback path when AI output doesn't fit).             |
| C      | Manage & study loop | `S-03` → `S-04` | Post-creation lifecycle; joins Stream A at `S-01` (both need cards to exist first).                  |
| D      | Account lifecycle   | `S-05`          | Compliance-driven account erasure across all user data; needs only `F-01` (the store it must purge). |
| E      | UX polish           | `S-01` → `S-06` | Post-hoc refinements to the S-01 review flow; runs parallel with `S-05`.                             |

## Baseline

What's already in place in the codebase as of 2026-06-23 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 (`output: server`) + React 19 islands, Tailwind 4, shadcn/ui; pages incl. `index`, `dashboard`, `auth/{signin,signup,confirm-email}`.
- **Backend / API:** present (auth only) — `src/pages/api/auth/{signin,signup,signout}.ts`; no business/data endpoints yet.
- **Data:** absent — only Supabase `auth.users`. No flashcard/deck schema, no migrations (`supabase/config.toml` `schema_paths=[]`), no ORM/query builder.
- **Auth:** present & deployed — Supabase SSR (cookie-based, `@supabase/ssr`), `src/middleware.ts` guards `/dashboard`; signup→signin→signout verified live on Workers. **Satisfies FR-001 and FR-002.**
- **Deploy / infra:** present & deployed — Cloudflare Workers, CI auto-deploy on `master` (live: `10x-cards.tommy-swiacek-1fb.workers.dev`). OpenRouter secret deferred to the AI milestone (S-01) per `deploy-plan.md`.
- **Observability:** absent — no logging library or error tracking; live `wrangler tail` only (no historical retention).

## Foundations

### F-01: Per-user flashcard store with RLS isolation

- **Outcome:** (foundation) a single user-scoped `flashcards` store exists, with row-level security enforcing that a card is visible and mutable only by its owner, and that confirmed cards survive sessions.
- **Change ID:** flashcard-store-rls
- **PRD refs:** Access Control, NFR (confirmed data survives sessions/restarts), Guardrails (no-loss, no cross-user visibility)
- **Unlocks:** S-01 (somewhere to save accepted cards), S-02, S-03, S-04; reduces the no-loss / cross-user-isolation guardrail risk for every downstream slice.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because the isolation + no-loss guardrails are a launch gate and every slice writes to this store. Kept deliberately minimal (one owner-scoped entity, not a full data layer); S-01 immediately exercises it through a real user save, so it does not drift into horizontal layer-completion. Main risk: getting RLS wrong is a silent cross-user-visibility regression — must be verified, not assumed.
- **Status:** done

## Slices

### S-01: AI generation & review (north star)

- **Outcome:** user can paste source text, request AI-generated candidates, and accept / edit / reject each one — accepted cards are saved to their deck and become visible; empty/unusable input gets an explanatory message, not a failure.
- **Change ID:** ai-card-generation
- **PRD refs:** FR-003, FR-004, US-01, NFR (visible progress for >~2s operations), NFR (GDPR — source text not exposed to other users, not reused beyond the request)
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** `OPENROUTER_API_KEY` must be set as a production Workers Secret (human-only action, deferred per `deploy-plan.md`) before live generation works.
- **Unknowns:**
  - ~~Input-size / generated-card-count cap for the MVP (PRD Open Question Q1)~~ — Resolved in implementation: input capped at 10k chars (`400 too_long` above the cap).
- **Risk:** This is the wedge and the only unfamiliar integration, so it carries the most uncertainty. Generation is a single request/response OpenRouter `fetch`; Cloudflare free tier doesn't meter the wait but does cap per-request CPU and subrequests — keep one model call + minimal Supabase round-trips, and surface continuous progress per the NFR. Human-gating (no silent auto-save) is the load-bearing guardrail to verify.
- **Status:** done

### S-02: Manual card authoring

- **Outcome:** user can create a flashcard manually (question + answer) and have it saved to their deck.
- **Change ID:** manual-card-authoring
- **PRD refs:** FR-005
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Smallest slice; depends only on the store. Sequenced as a sibling of S-01 (not after it) because it shares no code path with generation and is the fallback when AI output doesn't fit. Low risk.
- **Status:** done

### S-03: Manage saved flashcards

- **Outcome:** user can view their saved flashcards in a list, edit any saved card, and delete a card.
- **Change ID:** manage-saved-flashcards
- **PRD refs:** FR-006, FR-007, FR-008
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Kept as one coherent "manage your cards" surface (list + edit + delete on a single entity) rather than three thin slices. Needs cards to exist, so it follows S-01 (the primary producer). Deletion must respect the no-loss guardrail's intent (intentional delete is allowed; accidental/cross-user loss is not).
- **Status:** done

### S-04: Spaced-repetition study

- **Outcome:** user can study a deck through a spaced-repetition schedule — the product decides which card to show next based on prior recall.
- **Change ID:** spaced-repetition-study
- **PRD refs:** FR-009
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Which ready-made SRS algorithm/library to integrate (PRD Non-Goals forbid building a custom engine) — Owner: user/TBD. Block: no (selectable at plan time).
- **Risk:** The retention half of the value proposition; weighty because it integrates an external SRS algorithm and introduces scheduling state. Needs cards to exist (follows S-01). Scope risk: must integrate a ready-made scheduler, not drift into building one (Non-Goal).
- **Status:** done

### S-05: Account deletion with 30-day retention

- **Outcome:** user can request account deletion; the account is immediately marked deleted and sign-in blocked, all their data stays recoverable for a 30-day window, then is permanently erased across every user-scoped store.
- **Change ID:** account-deletion
- **PRD refs:** GDPR NFR (data handling). No dedicated erasure FR yet — see Open Roadmap Question 3.
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How the 30-day purge is triggered on Cloudflare Workers (Cron Trigger vs. purge-on-access) and where "deleted" state lives (app uses only Supabase `auth.users`, no schema). Owner: user/TBD. Block: no (decidable at plan time).
- **Risk:** Compliance-driven, destructive, and time-delayed with no background-job baseline or observability (Open Q2). The purge is load-bearing: a silent failure retains data past the promised window (GDPR liability), a premature one violates the no-loss guardrail. Soft-delete must revoke access without deleting rows; verify the retention boundary explicitly.
- **Status:** planned

### S-06: UX improvements

- **Outcome:** on the AI candidate review flow, user can accept/reject candidates in bulk and reset a review session; long operations show clearer loading states so the screen never looks frozen.
- **Change ID:** ux-improvements
- **PRD refs:** FR-004, NFR (visible progress for >~2s operations)
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Polish over an existing surface (the S-01 review flow), so low risk and no new data model. Scope risk: keep to bulk actions, session reset, and loading states — do not redesign the review flow. Bulk reject must stay inside the human-gating guardrail (no silent auto-accept).
- **Status:** planned

## Backlog Handoff

| Roadmap ID | Change ID               | Suggested issue title                               | Ready for `/10x-plan` | Notes                                                                                                                                                          |
| ---------- | ----------------------- | --------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01       | flashcard-store-rls     | Per-user flashcard store with RLS isolation         | done                  | Done — rolled out to prod, archived 2026-06-24 → `context/archive/2026-06-24-flashcard-store-rls/`.                                                            |
| S-01       | ai-card-generation      | AI flashcard generation & accept/edit/reject review | done                  | Done — impl-reviewed (PR #2), archived 2026-06-25 → `context/archive/2026-06-25-ai-card-generation/`. Confirm `OPENROUTER_API_KEY` is set for live generation. |
| S-02       | manual-card-authoring   | Manual flashcard creation                           | done                  | Done — merged (PR #3), archived 2026-07-01 → `context/archive/2026-07-01-manual-card-authoring/`.                                                              |
| S-03       | manage-saved-flashcards | View / edit / delete saved flashcards               | done                  | Done — archived 2026-07-01 → `context/archive/2026-07-01-manage-saved-flashcards/`.                                                                            |
| S-04       | spaced-repetition-study | Spaced-repetition study session                     | done                  | Done — impl-reviewed, archived 2026-07-01 → `context/archive/2026-07-01-spaced-repetition-study/`.                                                             |
| S-05       | account-deletion        | Account deletion with 30-day retention              | not yet               | New. Blocked on Open Q3 (add erasure FR to PRD) + purge-trigger + soft-delete-state decisions. Do `/10x-research` on auth/data stores before `/10x-plan`.      |
| S-06       | ux-improvements         | Candidate review UX: bulk actions, reset, loading   | yes                   | New. Polish over the existing S-01 review flow; no new data model or open questions.                                                                           |

## Open Roadmap Questions

1. **What is the input-size / generated-card-count cap for AI generation in the MVP?** — Owner: user. Block: gates S-01 implementation (not planning). Also bounds the Cloudflare free-tier CPU/subrequest risk (`infrastructure.md`).
2. **Log retention beyond live `wrangler tail`?** — Owner: user. Block: roadmap-wide (observability is absent). The infra pre-mortem warns that intermittent production-only generation failures are hard to diagnose without retained logs (Workers Logs paid, or an external sink), and an in-flight generation failure could bruise the no-loss guardrail's spirit. Left open under the `speed` goal; revisit if S-01 generation proves flaky in production.
3. **Should account deletion (right-to-erasure) be a first-class PRD requirement?** — Owner: user. Block: gates S-05. The PRD's Account section (FR-001/FR-002) has no deletion FR, and the only GDPR clause (an NFR) covers source-text handling, not account erasure. S-05 currently anchors to that NFR by intent; re-run `/10x-prd` to add an explicit erasure FR (and confirm the 30-day window is product policy, not an arbitrary default) so the slice traces to a real requirement.

## Parked

- **Custom spaced-repetition algorithm** — Why parked: PRD Non-Goals — deliberate buy-not-build; S-04 integrates a ready-made scheduler.
- **Multi-format import (PDF/DOCX/file parsing)** — Why parked: PRD Non-Goals — only pasted text in the MVP.
- **Deck sharing between users** — Why parked: PRD Non-Goals — single-tenant by design.
- **Mobile apps / native clients** — Why parked: PRD Non-Goals — web only for v1.
- **Integrations with other educational platforms (LMS, etc.)** — Why parked: PRD Non-Goals — MVP is standalone.

## Done

- **F-01: (foundation) a single user-scoped `flashcards` store exists, with row-level security enforcing that a card is visible and mutable only by its owner, and that confirmed cards survive sessions.** — Archived 2026-07-01 → `context/archive/2026-06-24-flashcard-store-rls/`. Lesson: —.
- **S-01: user can paste source text, request AI-generated candidates, and accept / edit / reject each one — accepted cards are saved to their deck and become visible; empty/unusable input gets an explanatory message, not a failure.** — Archived 2026-07-01 → `context/archive/2026-06-25-ai-card-generation/`. Lesson: —.
- **S-02: user can create a flashcard manually (question + answer) and have it saved to their deck.** — Archived 2026-07-01 → `context/archive/2026-07-01-manual-card-authoring/`. Lesson: —.
- **S-03: user can view their saved flashcards in a list, edit any saved card, and delete a card.** — Archived 2026-07-01 → `context/archive/2026-07-01-manage-saved-flashcards/`. Lesson: —.
- **S-04: user can study a deck through a spaced-repetition schedule — the product decides which card to show next based on prior recall.** — Archived 2026-07-01 → `context/archive/2026-07-01-spaced-repetition-study/`. Lesson: —.
