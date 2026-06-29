# AI Flashcard Generation & Accept/Edit/Reject Review — Implementation Plan

## Overview

Build the product's north-star wedge (S-01 from `context/foundation/roadmap.md`): a signed-in
user pastes source text on a new `/generate` page, requests AI-generated flashcard candidates,
reviews each one (accept / edit / reject), and batch-saves the accepted set to their per-user
`flashcards` deck. Generation is a single OpenRouter `fetch` returning structured JSON; the
review loop is a React island; persistence goes through the existing RLS-protected typed client.

This slice validates the central product hypothesis — that AI cards are good enough that users
accept ~75% of them. Two guardrails are load-bearing: **human-gating** (nothing enters the deck
without explicit acceptance — no silent auto-save) and **no-loss / per-user isolation** (already
enforced by F-01's RLS, exercised here through the first real user save).

## Current State Analysis

- **The store is ready (F-01 done).** `public.flashcards` exists with owner-scoped RLS;
  `src/db/database.types.ts` types its row: `question` (CHECK 1–1000 chars), `answer` (1–2000),
  `source` (`'ai' | 'manual'`, default `'manual'`), `user_id`, timestamps. Inserts through the
  anon-key client + the user's JWT are RLS-pinned to `auth.uid()`.
- **Typed SSR client wired** — `src/lib/supabase.ts:10` calls `createServerClient<Database>(...)`
  and returns `null` when Supabase env is absent. Created per-request via `createClient(headers, cookies)`.
- **No JSON API pattern yet.** All endpoints (`src/pages/api/auth/*`) are formData + redirect.
  This slice introduces the project's first JSON request/response endpoints and the first React
  island that `fetch`es one. Auth islands (`SignInForm.tsx`) are progressive-enhancement forms.
- **OpenRouter is unwired.** `astro.config.mjs:17` env schema declares only `SUPABASE_URL/KEY`;
  `OPENROUTER_API_KEY` is absent from the schema, `.env.example`, and `config-status.ts`. The
  prod secret is deferred and human-gated (`infrastructure.md` / deploy-plan).
- **No Zod, no test framework.** F-01 deferred app-layer validation to "the first consumer slice"
  (this one). Verification is scripts + manual, as in F-01.
- **Middleware protection** is an array — `src/middleware.ts:4` `PROTECTED_ROUTES = ["/dashboard"]`;
  `locals.user` is set from `auth.getUser()`. No `locals.supabase` — endpoints build their own client.
- **Env schema uses `astro:env`** — `envField.string({ context: "server", access: "secret", optional: true })`.
- **UI conventions** — Astro pages + React islands with `client:*`; shadcn/ui (new-york) in
  `src/components/ui/`; lucide icons; Tailwind 4; `@/*` → `src/*`.

## Desired End State

A signed-in user visits `/generate`, pastes up to ~10,000 chars, and clicks Generate. While the
single OpenRouter call is in flight the form is disabled and a visible "Generating cards…" state
shows (satisfies the >2s progress NFR). Up to 15 candidate cards return and render as inline-editable
question/answer pairs, each with Accept / Reject. The user edits and accepts the ones they want,
then clicks "Save accepted" — a single batch insert persists them with `source:'ai'`, and an inline
"N cards saved to your deck" confirmation appears (the browsable list is S-03). Empty input,
over-length input, an empty/unusable AI result, and AI/transport failures each produce a specific,
friendly inline message with the pasted text preserved — never a frozen screen or a blank failure.
When `OPENROUTER_API_KEY` is absent, generation degrades gracefully with an "AI not configured" message.

Verification: `npx astro sync && npm run lint && npm run build` pass; with a local key, a real
end-to-end generate→review→save cycle works in the browser and saved rows appear in the DB under
the correct `user_id`; without a key, the no-key path returns the configured message.

### Key Discoveries:

- `src/db/database.types.ts` — `flashcards` Insert type already exists; persistence is typed.
- `src/lib/supabase.ts:10` — typed RLS client; reuse `createClient(...)` in new endpoints; the
  `null` return is the no-config guard pattern to mirror for OpenRouter.
- `astro.config.mjs:17-22` — env schema; add `OPENROUTER_API_KEY` here (server/secret/optional).
- `src/lib/config-status.ts:11` — `configStatuses` array is where the OpenRouter "not configured"
  status is registered (Polish copy, matches existing entry).
- `src/middleware.ts:4` — add `/generate` to `PROTECTED_ROUTES`.
- `infrastructure.md` risk register — **one OpenRouter call + minimal Supabase round-trips**; cap
  input + card count to stay under the free-tier 10ms CPU / 50-subrequest budgets; limit failures
  are production-only (`astro dev` does not enforce them).

## What We're NOT Doing

- **No saved-cards list / edit / delete UI** — that's S-03. This slice shows only an inline
  post-save confirmation.
- **No SRS / study loop** — S-04.
- **No manual card authoring** — S-02 (a sibling slice; shares the store, not this code path).
- **No streaming/SSE progress** — a determinate-feel loading state is enough for one short call.
- **No retries or fallback models** — a single call keeps the subrequest budget lean (a retry is a
  later, deliberate decision per the risk register).
- **No test framework** — verification is `curl`/manual + the existing lint/build gates, consistent
  with F-01.
- **No production secret-setting or deploy** — `OPENROUTER_API_KEY` in prod is a human-gated manual
  step (documented, not executed here).
- **No acceptance-rate analytics/instrumentation** — measuring the 75% metric is out of MVP scope.

## Implementation Approach

Bottom-up so each layer is verifiable before the UI depends on it: (1) config + a pure server-side
generation service with Zod schemas, (2) the generate endpoint over it, (3) the save endpoint +
batch persistence, (4) the page + review island that ties them together. The generation service is
a single `fetch` to OpenRouter's chat-completions API with `response_format` of type `json_schema`,
asking a budget model (id held in a swappable constant) for an array of `{question, answer}`
candidates. Zod validates both the inbound request (length cap) and the model output (shape +
DB-mirroring length caps), discarding malformed candidates rather than failing the whole batch.
Saving is a single bulk `insert` through the RLS client. Errors are typed codes mapped to friendly
inline copy. Verification uses a real OpenRouter key in local `.dev.vars`; absent a key, every
generation path returns a clear "AI not configured" response.

## Critical Implementation Details

- **Cloudflare free-tier budget is load-bearing, not advisory.** Exactly one OpenRouter `fetch`
  per generation and one Supabase `insert` per save; no fan-out, no per-card round-trips. Parsing +
  Zod-validating the completion is the CPU-cap risk — the ≤15-card cap keeps it bounded. These
  limits are **not** enforced by `astro dev` (workerd locally), only in production.
- **Budget model must support structured outputs.** The chosen default budget model id must be one
  that honors OpenRouter `response_format: { type: "json_schema", ... }` (e.g. a Gemini Flash /
  GPT-4o-mini-class model). If a swapped-in model ignores the schema, the output Zod parse is the
  backstop — malformed candidates are dropped and an empty result maps to the `no_cards` error.
- **Generation never bypasses auth.** Both endpoints resolve the user from the RLS client
  (`auth.getUser()`); a missing user is `401`. RLS already guarantees a saved row's `user_id` is the
  caller — never trust a `user_id` from the request body (the Insert omits it; RLS/`auth.uid()` sets it).
- **Source text is request-scoped (GDPR NFR).** The pasted text is used only to serve this request
  and is never persisted or logged; only accepted question/answer pairs are stored.

## Phase 1: Config & Generation Service

### Overview

Wire `OPENROUTER_API_KEY` into the env schema and config surfacing, then build the pure server-side
generation service and the shared Zod schemas / types it and the endpoints use.

### Changes Required:

#### 1. OpenRouter env var

**File**: `astro.config.mjs`

**Intent**: Make `OPENROUTER_API_KEY` a typed, server-only, optional secret so the app builds and
runs without it (graceful no-key path) and reads it via `astro:env/server`.

**Contract**: Add `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })`
to the `env.schema` object, alongside the existing Supabase fields.

#### 2. Env example + config status

**File**: `.env.example`, `src/lib/config-status.ts`

**Intent**: Document the new key and surface "AI not configured" through the existing status pattern.

**Contract**: Append `OPENROUTER_API_KEY=###` to `.env.example`. In `config-status.ts`, add a second
entry to `configStatuses` (`name: "OpenRouter"`, `configured: Boolean(OPENROUTER_API_KEY)`, Polish
message consistent with the Supabase entry), importing `OPENROUTER_API_KEY` from `astro:env/server`.

#### 3. Shared schemas & types

**File**: `src/lib/flashcards/schemas.ts` (new)

**Intent**: Single source of truth for request/response shapes and validation, mirroring the DB
constraints so app-layer and DB-layer caps cannot drift.

**Contract**: Export Zod schemas + inferred types:

- `generateRequestSchema` — `{ text: string }` with `text` trimmed, `min(1)`, `max(10000)`.
- `candidateSchema` — `{ question: string (1..1000), answer: string (1..2000) }` (mirrors the
  `flashcards` CHECKs).
- `saveRequestSchema` — `{ cards: candidateSchema array, min(1), max(15) }`.
- Exported TS types `GenerateRequest`, `Candidate`, `SaveRequest`, and an `ApiError` union of the
  typed error codes (`empty_input | too_long | no_cards | ai_unavailable | rate_limited | invalid_input | unauthorized`).
- Constants `MAX_INPUT_CHARS = 10000`, `MAX_CARDS = 15`.

#### 4. Generation service

**File**: `src/lib/flashcards/generation.ts` (new)

**Intent**: Pure, framework-agnostic function that turns source text into validated candidates via
one OpenRouter call — the only place the model and prompt live.

**Contract**: `export async function generateCandidates(text: string, apiKey: string): Promise<Candidate[]>`.

- Model id is a **swappable constant** `OPENROUTER_MODEL`, set to a budget model that supports
  structured outputs (`response_format: json_schema`). **Dev:** a `:free` Gemini Flash variant
  (e.g. `google/gemini-2.0-flash-exp:free`) — zero-cost, real structured-output testing. **Prod:**
  the cheap **paid** equivalent with provider training **disabled** (e.g. `google/gemini-2.0-flash-001`
  / a Gemini 2.5 Flash, or a GPT-4o-mini-class model). See Migration Notes for why free is not
  acceptable in prod (GDPR NFR + free-tier reliability). Pick the live id from
  `https://openrouter.ai/models?max_price=0&supported_parameters=structured_outputs` (the `:free`
  lineup rotates). Constant `OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"`.
- Single `fetch` (POST, `Authorization: Bearer <apiKey>`) with a system/user message instructing
  decomposition into self-contained Q/A pairs (≤ `MAX_CARDS`), and `response_format` of type
  `json_schema` describing `{ cards: [{ question, answer }] }`.
- Parse the completion JSON, validate each item with `candidateSchema`, **drop** invalid items,
  cap to `MAX_CARDS`, return the array (possibly empty).
- Throw a typed error (mapped by the caller to `ai_unavailable` / `rate_limited`) on non-OK HTTP or
  network failure; never throw on a well-formed-but-empty result (returns `[]`).
- Does not read env directly (apiKey is injected) and never logs the source text.

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- `zod` resolves as a dependency: `npm ls zod` succeeds

#### Manual Verification:

- With a local `OPENROUTER_API_KEY`, a scratch call to `generateCandidates(sampleText, key)` returns
  a non-empty `Candidate[]` whose items satisfy the length caps.
- `config-status.ts` reports OpenRouter as not-configured when the key is unset.

**Implementation Note**: After Phase 1 automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: Generate API Endpoint

### Overview

Expose generation as an authenticated JSON endpoint with input validation, the no-key path, and typed
error codes — no persistence.

### Changes Required:

#### 1. Generate endpoint

**File**: `src/pages/api/flashcards/generate.ts` (new)

**Intent**: Accept pasted text from the island, enforce auth + the input cap, run the generation
service, and return candidates or a typed error — without touching the database.

**Contract**: `export const POST: APIRoute`.

- Build the RLS client via `createClient(context.request.headers, context.cookies)`; if `null` or
  `auth.getUser()` yields no user → `401 { error: "unauthorized" }`.
- Read `OPENROUTER_API_KEY` from `astro:env/server`; if absent → `503 { error: "ai_unavailable" }`
  (the graceful no-key path).
- Parse JSON body with `generateRequestSchema`; on failure map to `400 { error: "empty_input" | "too_long" | "invalid_input" }`
  (distinguish empty vs over-cap from the Zod issue).
- Call `generateCandidates(text, key)`; on thrown transport/HTTP error → `502 { error: "ai_unavailable" }`
  (or `429 { error: "rate_limited" }` when the upstream status is 429).
- Empty candidate array → `422 { error: "no_cards" }`.
- Success → `200 { candidates: Candidate[] }`. JSON responses throughout (`Content-Type: application/json`).

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `curl` (with auth cookie) + valid text and a local key → `200` with a `candidates` array.
- `curl` with empty text → `400 empty_input`; with >10k chars → `400 too_long`.
- `curl` without a session cookie → `401 unauthorized`.
- With the key unset → `503 ai_unavailable`.

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation before Phase 3.

---

## Phase 3: Save API Endpoint & Persistence

### Overview

Persist the accepted candidates in one batch insert through the RLS client — the first real user
write to the F-01 store.

### Changes Required:

#### 1. Save endpoint

**File**: `src/pages/api/flashcards/index.ts` (new)

**Intent**: Accept the reviewed/edited card set, validate it against the DB-mirroring caps, and
bulk-insert it as the caller's `source:'ai'` cards.

**Contract**: `export const POST: APIRoute`.

- Auth via the RLS client as in Phase 2; no user → `401 unauthorized`.
- Parse body with `saveRequestSchema` (1..15 cards, each within length caps); invalid → `400 invalid_input`.
- One `supabase.from("flashcards").insert(rows)` where each row is `{ question, answer, source: "ai" }`
  — **omit `user_id`** (RLS + `auth.uid()` set it; never read it from the body). Use `.select()` to
  get the inserted count.
- DB error → `500 { error: "save_failed" }`; success → `200 { saved: <count> }`.

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `curl` (authed) with 2–3 valid cards → `200 { saved: N }`; rows appear in local `flashcards` with
  the caller's `user_id` and `source = 'ai'`.
- A card exceeding the length cap → `400 invalid_input`; nothing inserted.
- Unauthenticated → `401`; isolation: rows are only visible to the owner (re-confirm via the F-01 path).

**Implementation Note**: After Phase 3 automated checks pass, pause for manual confirmation before Phase 4.

---

## Phase 4: /generate Page & Review Island

### Overview

The user-facing surface: a protected `/generate` page hosting a React island that runs the full
paste → generate → review → save loop, with loading state, inline edit, and typed error messages.

### Changes Required:

#### 1. Protect the route

**File**: `src/middleware.ts`

**Intent**: Gate `/generate` behind auth like `/dashboard`.

**Contract**: Add `"/generate"` to `PROTECTED_ROUTES`.

#### 2. Generate page

**File**: `src/pages/generate.astro` (new)

**Intent**: Server-rendered shell that mounts the review island for signed-in users.

**Contract**: Use `Layout.astro`; read `Astro.locals.user` (middleware guarantees presence); render
`<GenerateView client:load />`. Match the existing page styling idiom (cf. `dashboard.astro`).

#### 3. Review island

**File**: `src/components/flashcards/GenerateView.tsx` (new) — plus small subcomponents as needed
(e.g. `CandidateCard.tsx`).

**Intent**: Own the client-side review state machine and all calls to the two endpoints.

**Contract**: A `client:load` React component:

- A textarea for source text (with a visible char counter against `MAX_INPUT_CHARS`) and a Generate button.
- On Generate: `POST /api/flashcards/generate`; while pending, disable the form and show a
  "Generating cards…" spinner/status (satisfies the >2s NFR).
- Render returned candidates as a list of inline-editable question/answer fields, each with
  Accept / Reject controls; edits and accept/reject status live in island state.
- A "Save accepted" button: `POST /api/flashcards` with the accepted (possibly edited) cards;
  on success show "N cards saved to your deck" and clear the queue. Disabled when nothing is accepted.
- Map each typed error code to a specific friendly inline message; preserve the pasted text on error.
- Reuse shadcn `button`; lucide icons; types imported from `src/lib/flashcards/schemas.ts`.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Give users a path to the new feature.

**Contract**: Add a link/button to `/generate` in the dashboard card (match existing markup/styling).

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Signed-out visit to `/generate` → redirected to `/auth/signin`.
- Signed-in, with a local key: paste text → loading state shows → candidates render; edit one,
  accept some, reject others; "Save accepted" persists only the accepted set; confirmation shows.
- Empty input, over-length input, and an unusable/empty AI result each show a specific friendly
  message (not a blank failure); pasted text is preserved.
- With the key unset, the UI shows the "AI not configured" path gracefully.
- Rejected candidates leave no DB trace; only accepted cards are saved (human-gating guardrail).

**Implementation Note**: This is the final phase. After automated checks pass, pause for manual
confirmation of the full end-to-end flow before the closing commit.

---

## Testing Strategy

### Unit Tests:

- None — no framework is wired (consistent with F-01). The Zod schemas are the validation contract.

### Integration Tests:

- Manual `curl` exercises per endpoint (Phases 2–3) covering success and each typed-error branch.
- Reuse the F-01 RLS path to confirm saved rows remain owner-isolated.

### Manual Testing Steps:

1. `npx supabase start` (store from F-01 present); set `OPENROUTER_API_KEY` in `.env` / `.dev.vars`.
2. `npm run dev`; sign in; visit `/generate`.
3. Paste a paragraph → confirm loading state → candidates render.
4. Edit a candidate, accept 2–3, reject the rest → "Save accepted" → confirmation; verify rows in
   local `flashcards` (correct `user_id`, `source='ai'`, only accepted cards).
5. Exercise edge cases: empty input, >10k chars, and (temporarily) an invalid key to see `ai_unavailable`.
6. Unset the key → confirm the graceful no-config path.
7. `npx astro sync && npm run lint && npm run build`.

## Performance Considerations

One OpenRouter `fetch` + one Supabase `insert` per user action keeps both within the Cloudflare
free-tier subrequest budget. The ≤15-card cap bounds the parse+Zod-validate CPU (the 10ms free-tier
risk). Workers do not meter or time out the OpenRouter wait, so latency surfaces only as UI progress.
These limits are production-only — verify the deployed Worker, not just `astro dev`.

## Migration Notes

- No DB migration — F-01's `flashcards` table is the target, unchanged.
- **New prod secret (human-gated):** `npx wrangler secret put OPENROUTER_API_KEY` (and add to GitHub
  repo secrets for CI). Not executed in this session; live generation in prod is blocked until set.
- **Prod must NOT use a `:free` model.** Set `OPENROUTER_MODEL` to a cheap **paid** budget model
  (Gemini Flash / GPT-4o-mini class) and **disable provider training** in the OpenRouter account
  privacy settings before going live. Two reasons:
  - **GDPR NFR.** Most `:free` models require enabling OpenRouter's allow-training toggle, so
    providers may train on prompts. In prod the prompts are real users' pasted source text, which
    the PRD says must not be "used beyond serving the user's own request." Free + real user data
    violates that guardrail.
  - **Reliability.** `:free` endpoints are best-effort (hard shared caps ~20 req/min, 50–1,000/day;
    throttled/deprecated/pulled without notice). The generation step is the product's core wedge —
    it should not ride on promotional capacity.
  - Cost is not a reason to stay free: a paid budget model is roughly **<$0.001 per generation** at
    this app's input/card caps and low QPS (well under $1 per 1,000 generations).
  - `:free` is fine for **local dev only** (see Phase 1 — `OPENROUTER_MODEL` is a swappable constant,
    so dev→prod is a one-line change, no refactor).
- Rollback: code-only; `npx wrangler rollback`. No schema change to revert.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` — FR-003, FR-004, US-01, NFRs (progress, GDPR, no-loss)
- Store contract: `context/changes/flashcard-store-rls/plan.md` + `src/db/database.types.ts`
- Infra constraints: `context/foundation/infrastructure.md` (subrequest/CPU caps, secrets)
- Patterns to follow: `src/lib/supabase.ts:10`, `src/lib/config-status.ts:11`,
  `src/middleware.ts:4`, `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Config & Generation Service

#### Automated

- [x] 1.1 Type sync passes (`npx astro sync`)
- [x] 1.2 Lint passes (`npm run lint`)
- [x] 1.3 Build passes (`npm run build`)
- [x] 1.4 `zod` resolves as a dependency (`npm ls zod`)

#### Manual

- [x] 1.5 With a local key, `generateCandidates` returns valid `Candidate[]` within length caps
- [x] 1.6 `config-status.ts` reports OpenRouter not-configured when the key is unset

### Phase 2: Generate API Endpoint

#### Automated

- [ ] 2.1 Type sync passes (`npx astro sync`)
- [ ] 2.2 Lint passes (`npm run lint`)
- [ ] 2.3 Build passes (`npm run build`)

#### Manual

- [ ] 2.4 Authed + valid text + local key → `200` with `candidates` array
- [ ] 2.5 Empty text → `400 empty_input`; >10k chars → `400 too_long`
- [ ] 2.6 No session cookie → `401 unauthorized`
- [ ] 2.7 Key unset → `503 ai_unavailable`

### Phase 3: Save API Endpoint & Persistence

#### Automated

- [ ] 3.1 Type sync passes (`npx astro sync`)
- [ ] 3.2 Lint passes (`npm run lint`)
- [ ] 3.3 Build passes (`npm run build`)

#### Manual

- [ ] 3.4 Authed save of valid cards → `200 { saved: N }`; rows in DB with correct `user_id`, `source='ai'`
- [ ] 3.5 Over-length card → `400 invalid_input`; nothing inserted
- [ ] 3.6 Unauthenticated → `401`; saved rows remain owner-isolated (F-01 path)

### Phase 4: /generate Page & Review Island

#### Automated

- [ ] 4.1 Type sync passes (`npx astro sync`)
- [ ] 4.2 Lint passes (`npm run lint`)
- [ ] 4.3 Build passes (`npm run build`)

#### Manual

- [ ] 4.4 Signed-out `/generate` → redirect to `/auth/signin`
- [ ] 4.5 Signed-in end-to-end: paste → loading → candidates → edit/accept/reject → save accepted → confirmation
- [ ] 4.6 Empty / over-length / unusable-result each show a specific friendly message; pasted text preserved
- [ ] 4.7 Key unset → graceful "AI not configured" path
- [ ] 4.8 Rejected candidates leave no DB trace; only accepted cards saved (human-gating)
