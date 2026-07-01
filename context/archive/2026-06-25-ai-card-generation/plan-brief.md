# AI Flashcard Generation & Review — Plan Brief

> Full plan: `context/changes/ai-card-generation/plan.md`

## What & Why

Build the product's north-star wedge (S-01): a signed-in user pastes source text, gets
AI-generated flashcard candidates, reviews each (accept / edit / reject), and saves the accepted
ones to their deck. This validates the central bet — that AI cards are good enough that users
accept ~75% of them. The two guardrails it must honor: **human-gating** (no silent auto-save) and
**no-loss / per-user isolation** (F-01's RLS, exercised here by the first real user write).

## Starting Point

F-01 is done: `public.flashcards` exists with owner-scoped RLS and a typed client
(`createServerClient<Database>` in `src/lib/supabase.ts`). Auth + protected routes work. There is
no JSON API pattern yet (auth endpoints are formData+redirect), no Zod, no test framework, and
OpenRouter is entirely unwired (`OPENROUTER_API_KEY` is not in the env schema; prod secret is
human-gated).

## Desired End State

`/generate` (protected) hosts a React island: paste ≤10k chars → single OpenRouter call (loading
state for the >2s NFR) → ≤15 inline-editable candidates → accept/edit/reject → "Save accepted"
batch-inserts the chosen cards as `source:'ai'` → inline "N cards saved" confirmation. Empty input,
over-length input, unusable AI output, and AI failures each show a specific friendly message with
the text preserved. No key → graceful "AI not configured" path. Build/lint pass throughout.

## Key Decisions Made

| Decision           | Choice                                           | Why (1 sentence)                                                                          | Source |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| Input / card caps  | ~10k chars in, ≤15 cards                         | Covers a chapter section while staying inside free-tier CPU/subrequest risk.              | Plan   |
| Model tier         | Budget/fastest, swappable; `:free` dev only      | Lowest cost+latency; prod uses a cheap _paid_ model w/ training off (GDPR + reliability). | Plan   |
| Structured output  | OpenRouter `response_format` json_schema         | Single-pass parse, minimal CPU, deterministic `{question,answer}[]` shape.                | Plan   |
| Validation         | Add Zod (request + AI output, DB-mirroring caps) | Tech-stack anticipated Zod; reused by S-02/S-03; caps can't drift from DB.                | Plan   |
| Persistence timing | Batch insert on "Save accepted"                  | One Supabase round-trip respects the subrequest budget; clean save.                       | Plan   |
| Progress UX        | Determinate-feel loading state (no SSE)          | One short call; a clear "working" state satisfies the NFR without streaming.              | Plan   |
| Route              | New protected page `/generate`                   | Clean separation; dashboard stays a nav surface as S-03/S-04 land.                        | Plan   |
| Save proof         | Inline confirmation only (no list)               | Keeps S-01 focused; the browsable list/edit/delete is S-03.                               | Plan   |
| Error handling     | Typed error codes → friendly inline messages     | Meets the US-01 "explanatory message, not a failure" AC across all modes.                 | Plan   |
| Edit UX            | Inline-editable fields per candidate             | Edit/accept in one motion; reuses the batch-save path.                                    | Plan   |
| Verification       | Local `.dev.vars` key + graceful no-key path     | Real end-to-end local test; prod secret stays human-gated; no mock infra.                 | Plan   |

## Scope

**In scope:** OpenRouter env wiring + config-status; Zod schemas/types; generation service (one
structured `fetch`); generate endpoint; save endpoint + batch persistence; `/generate` page + review
island; dashboard link; typed error handling; no-key path.

**Out of scope:** saved-cards list/edit/delete (S-03), SRS/study (S-04), manual authoring (S-02),
streaming, retries/fallback models, analytics, prod secret-setting/deploy, test framework.

## Architecture / Approach

Bottom-up, four layers: **(1)** config + a pure `generateCandidates(text, key)` service with Zod
schemas; **(2)** `POST /api/flashcards/generate` (auth + input cap + typed errors, no DB); **(3)**
`POST /api/flashcards` (Zod-validate, one batch insert via the RLS client, `source:'ai'`); **(4)**
`/generate.astro` + `GenerateView` island that drives the review state machine and calls both
endpoints. One OpenRouter call + one Supabase insert per user action; `user_id` is set by RLS, never
read from the body.

## Phases at a Glance

| Phase                          | What it delivers                                     | Key risk                                             |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| 1. Config & generation service | Env var, config-status, Zod schemas, OpenRouter call | Budget model honoring json_schema; CPU on parse      |
| 2. Generate API endpoint       | Authed JSON generate route + typed errors            | Mapping all failure modes; no-key path               |
| 3. Save API + persistence      | Batch insert of accepted cards under RLS             | RLS/`user_id` correctness; subrequest budget         |
| 4. /generate page & island     | Full paste→review→save UI                            | Review state machine; progress UX; first JSON island |

**Prerequisites:** F-01 (done); local Supabase running; a local `OPENROUTER_API_KEY` to test real
generation.
**Estimated effort:** ~2–3 after-hours sessions across 4 phases.

## Open Risks & Assumptions

- The chosen **budget model honors OpenRouter structured outputs**; the output Zod parse is the
  backstop (drops malformed items → empty maps to `no_cards`).
- **Cloudflare free-tier limits are production-only** — `astro dev` won't surface a CPU/subrequest
  trip; verify the deployed Worker.
- Live prod generation is **blocked until a human sets `OPENROUTER_API_KEY`** as a Workers secret.
- **Prod must use a paid model, not `:free`** — free models require the allow-training toggle
  (violates the GDPR NFR on real user text) and are best-effort capacity (unfit for the core wedge);
  `:free` is dev-only. Cost of the paid budget model is negligible (<$0.001/generation).
- The **75% acceptance bet** is a product hypothesis this slice enables measuring, not yet measured.

## Success Criteria (Summary)

- A signed-in user can paste text and get reviewable AI candidates with visible progress.
- Only explicitly accepted (optionally edited) cards persist; rejected ones leave no trace.
- Empty/unusable input yields an explanatory message, never a blank failure or frozen screen.
- Saved cards are owner-isolated (`source:'ai'`) and survive the session.
