---
date: 2026-07-07T20:05:54+02:00
researcher: Claude Code
git_commit: ed52c14
branch: master
repository: tswiackiewicz/10xcards
topic: "Rollout Phase 3 — Compliance-critical flows: account-deletion retention boundary (Risk #4) & AI-generation error-response data hygiene (Risk #6)"
tags: [research, codebase, account-deletion, gdpr, retention, ai-generation, openrouter, error-handling]
status: complete
last_updated: 2026-07-07
last_updated_by: Claude Code
---

# Research: Compliance-critical flows (Rollout Phase 3)

**Date**: 2026-07-07T20:05:54+02:00
**Researcher**: Claude Code
**Git Commit**: ed52c14
**Branch**: master
**Repository**: tswiackiewicz/10xcards

## Research Question

Ground `context/foundation/test-plan.md` rollout Phase 3 ("Compliance-critical flows") in real code before planning tests:

- **Risk #4** — the account-deletion purge fires before the 30-day window (violates no-loss) or never fires (violates the GDPR erasure promise).
- **Risk #6** — an AI-generation error response leaks the user's raw source text or provider internals (upstream error bodies, key material) to the client.

For each risk: verify or correct the test-plan's Risk Response Guidance, ground the failure path in code with file:line citations, locate existing test coverage, identify the cheapest useful test layer, and flag any speculative risk or misleading hot-spot evidence.

## Summary

Both risks are real and both are currently **untested** (confirmed zero overlap with existing Phase 1/2 tests). The **hot-spot evidence and the "cheapest layer" hypotheses in test-plan.md §2 hold up** — `src/pages/api` and `src/lib/flashcards` are exactly where the relevant code lives, and integration tests (Risk #4) plus unit/integration tests (Risk #6) are indeed the cheapest layer that gives real signal.

**One correction is required to the Risk Response Guidance before planning**: Risk #4's "What would prove protection" cell currently reads _"A soft-deleted account is denied sign-in immediately."_ This is factually wrong for the implemented system — sign-in **succeeds** for a pending-deletion account; the user is redirected to `/account` and their flashcard data becomes invisible/immutable via RLS (`is_pending_deletion()`), not via a sign-in rejection. The response guidance must be corrected to describe RLS-enforced data inaccessibility, not an auth-layer block, or a planned test would assert behavior the system was never built to have.

Risk #6's guidance is **confirmed accurate as written** — no leak exists in the current code (every error branch returns a fixed `{error: <ApiErrorCode>}` enum, never `err.message`, never a spread caught object, never the provider's raw response body) — but every non-input-validation branch (`rate_limited`, `ai_unavailable`, `no_cards`) is currently **untested**, which is exactly the coverage gap this phase should close.

## Detailed Findings

### Risk #4 — Account-deletion retention boundary

**Deletion trigger** — `src/pages/api/account/delete.ts:21-44`. `POST` authenticates the session, then performs an idempotent upsert (no delete of anything yet):

```ts
const { error } = await supabase
  .from("account_deletions")
  .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
// ...
await supabase.auth.signOut();
```

Cancellation: `src/pages/api/account/reactivate.ts:20-38` deletes the row — `supabase.from("account_deletions").delete().eq("user_id", user.id)`.

**Pending-deletion schema** — `supabase/migrations/20260702145938_create_account_deletions.sql:17-20`:

```sql
create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);
```

Presence of a row = pending deletion. `requested_at` (defaults to `now()`) is the **sole** timestamp driving the 30-day boundary — there is no separate `purge_at`/boolean flag. RLS policies (lines 36-52) restrict select/insert/delete on this table to the owning user (no `update`). A `security definer` helper `is_pending_deletion(uid)` (lines 61-69) gates all four `flashcards` RLS policies (lines 78-106), so a pending user's flashcard data becomes invisible/immutable **immediately** upon the upsert — this is the actual protection mechanism, not a sign-in block. A follow-up migration (`20260702154817_optimize_pending_deletion_rls.sql`) only wraps the helper call in a scalar subselect for planner caching (no behavior change).

**Purge job** — `src/pages/api/cron/purge.ts`. Triggered externally by a **daily GitHub Actions cron** (`.github/workflows/purge.yml:9-27`, schedule `0 3 * * *`, plus manual `workflow_dispatch`), which `curl`s the route with `Authorization: Bearer ${{ secrets.CRON_PURGE_SECRET }}`. There is **no** Cloudflare Cron Trigger / scheduled Worker — this was an explicit architectural decision (see Historical Context below), so tests should target the HTTP route directly, not a Workers `scheduled()` handler.

Eligibility query, `purge.ts:50-56` (`RETENTION_DAYS = 30`, `BATCH = 35`, lines 33-34):

```ts
const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
const { data, count, error } = await admin
  .from("account_deletions")
  .select("user_id", { count: "exact" })
  .lt("requested_at", cutoff)
  .order("requested_at", { ascending: true })
  .limit(BATCH);
```

Erasure, `purge.ts:67-73`: for each eligible row, `admin.auth.admin.deleteUser(row.user_id)`. `flashcards` and `account_deletions` rows are removed via `ON DELETE CASCADE` FKs, not explicit deletes in this file.

**Sign-in check** — `src/pages/api/auth/signin.ts:19-32`:

```ts
const { data: pending, error: pendingError } = await supabase
  .from("account_deletions")
  .select("user_id")
  .eq("user_id", data.user.id)
  .maybeSingle();
if (pendingError || pending) {
  return context.redirect("/account");
}
```

**Correction to test-plan.md §2**: sign-in is **not rejected** for a pending-deletion account. The session is created; the user is redirected to `/account` (fail-safe: a DB error is also treated as pending, favoring the safer redirect). Protection against data access comes from RLS (`is_pending_deletion()`), not from blocking authentication. `src/middleware.ts:4-22` has no awareness of `account_deletions` at all — it only checks `context.locals.user` for `PROTECTED_ROUTES`.

**Existing tests**: none. `tests/integration/risk1-rls-isolation.test.ts:1-6` explicitly notes its source (`scripts/verify-rls.mjs`) excludes the pending-deletion-block section (lines 172-208 of that script) and the purge-cascade section (lines 216-257), stating: _"those map to risks #4/#5... intentionally not ported here."_ That manual script is the only place this logic is exercised today, and it's not part of the automated Vitest suite. `tests/helpers/auth.ts` has no helper to seed a user with a custom `requested_at`/age — a new fixture will be needed for day-29/30/31 boundary seeding.

### Risk #6 — AI-generation error-response data hygiene

**Generation endpoint** — `src/pages/api/flashcards/generate.ts` (70 lines). Every response — success or failure — is built via local `json`/`fail` helpers (lines 8-17), so a failure body is always exactly `{ error: <ApiErrorCode> }`:

```ts
27  export const POST: APIRoute = async (context) => {
28    const supabase = createClient(context.request.headers, context.cookies);
29    if (!supabase) return fail(401, "unauthorized");
    // ...
35    if (!user) return fail(401, "unauthorized");
    // ...
39    if (!OPENROUTER_API_KEY) return fail(503, "ai_unavailable");
    // ...
44    try { body = await context.request.json(); }
46    catch { return fail(400, "invalid_input"); }
    // ...
50    const parsed = generateRequestSchema.safeParse(body);
51    if (!parsed.success) return fail(400, mapInputError(parsed.error));
    // ...
56    try { candidates = await generateCandidates(parsed.data.text, OPENROUTER_API_KEY); }
58    catch (err) {
59      if (err instanceof GenerationError && err.status === 429) return fail(429, "rate_limited");
62      return fail(502, "ai_unavailable");   // catch-all
    }
    // ...
66    if (candidates.length === 0) return fail(422, "no_cards");
69    return json(200, { candidates });
70  };
```

**Every distinct branch**:

| Line                | Condition                                                                                           | Response                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `generate.ts:30`    | no Supabase client                                                                                  | `401 {error:"unauthorized"}`                                                 |
| `generate.ts:36`    | no authenticated user                                                                               | `401 {error:"unauthorized"}`                                                 |
| `generate.ts:40`    | missing `OPENROUTER_API_KEY`                                                                        | `503 {error:"ai_unavailable"}`                                               |
| `generate.ts:44-48` | malformed JSON body                                                                                 | `400 {error:"invalid_input"}`                                                |
| `generate.ts:50-53` | Zod validation failure                                                                              | `400 {error: mapInputError(...)}` (`empty_input`/`too_long`/`invalid_input`) |
| `generate.ts:58-61` | `GenerationError` with `status===429`                                                               | `429 {error:"rate_limited"}`                                                 |
| `generate.ts:62`    | **catch-all** — any other thrown value (non-429 `GenerationError`, network failure, unexpected bug) | `502 {error:"ai_unavailable"}`                                               |
| `generate.ts:66`    | empty candidate array                                                                               | `422 {error:"no_cards"}`                                                     |
| `generate.ts:69`    | success                                                                                             | `200 {candidates}` (validated `candidateSchema` objects only)                |

No branch reads `err.message`, spreads a caught error object, or forwards a request/response body. `ApiErrorCode` (`schemas.ts:61-71`) is a fixed string-literal union; nothing outside that enum can appear in an error body.

**Provider wrapper** — `src/lib/flashcards/generation.ts` (there is no separate `openrouter.ts` file). `generateCandidates` (line 67) is the only caller:

- `generation.ts:69-88` — network failure → `throw new GenerationError("OpenRouter request failed")` (no status, cause discarded at line 86 `catch {`).
- `generation.ts:90-92` — non-OK HTTP response → `throw new GenerationError(\`OpenRouter responded ${response.status}\`, response.status)`. Only the numeric status is captured — `response.body`/`.text()`/`.json()` is never read here, so the provider's raw error body cannot leak through this path.
- `generation.ts:94-104,125-138` (`extractContent`) — the response body IS parsed via `.json()`, but only to pull `choices[0].message.content`; malformed/unexpected shapes silently return `null`/`[]` (lines 129-130, 133-135) and never escape the function.
- `GenerationError` (lines 17-24) only carries a templated `message` string and a numeric `status` — never the provider's response body, headers, or the outbound request payload (which would include the user's `text` and the `Authorization: Bearer <apiKey>` header at line 73).
- No explicit timeout branch: a 20s `AbortSignal.timeout` (line 84) firing just throws inside the same try/catch and is wrapped into the generic `GenerationError("OpenRouter request failed")` → falls to `generate.ts:62` → `502 ai_unavailable`.

**Input-validation mapping** — `generate.ts:20-25`:

```ts
export function mapInputError(error: ZodError): ApiErrorCode {
  const issue = error.issues.find((i) => i.path[0] === "text") ?? error.issues[0];
  if (issue.code === "too_small") return "empty_input";
  if (issue.code === "too_big") return "too_long";
  return "invalid_input";
}
```

Confirmed: returns only one of three fixed literals, never `issue.message` or any part of the raw ZodError/input. Schema: `schemas.ts:13-15` — `z.object({ text: z.string().trim().min(1).max(MAX_INPUT_CHARS) })`.

**Existing tests**: `tests/unit/risk7-generate-input-boundary.test.ts` covers only the input-validation branches (`empty_input`/`too_long`/`invalid_input`, including the non-string-input edge case) — its own header comment states validation is tested "upstream of any provider call." No test exists for `rate_limited`, the `502`/`ai_unavailable` catch-all, `no_cards`, or the missing-API-key `503` branch. `context/foundation/test-plan.md:247,269` (from Phase 2's mutation-testing pass) already documents these as known coverage gaps deferred to a future phase.

## Code References

- `src/pages/api/account/delete.ts:21-44` — deletion-request upsert into `account_deletions`, sign-out
- `src/pages/api/account/reactivate.ts:20-38` — cancels pending deletion
- `supabase/migrations/20260702145938_create_account_deletions.sql:17-20,36-69` — `account_deletions` schema, RLS, `is_pending_deletion()` helper
- `supabase/migrations/20260702145938_create_account_deletions.sql:78-106` — `flashcards` RLS policies gated by `is_pending_deletion()`
- `src/pages/api/cron/purge.ts:33-34,50-56,67-73` — retention constants, eligibility query, erasure
- `.github/workflows/purge.yml:9-27` — daily GitHub Actions cron trigger, bearer-secret auth
- `src/pages/api/auth/signin.ts:19-32` — pending-deletion redirect on sign-in (not a block)
- `src/middleware.ts:4-22` — route protection, no `account_deletions` awareness
- `scripts/verify-rls.mjs:172-208,216-257` — only existing (manual, non-automated) exercise of pending-deletion-block and purge-cascade logic
- `src/pages/api/flashcards/generate.ts:8-70` — full generation endpoint, all error branches
- `src/lib/flashcards/generation.ts:17-24,69-104,125-138` — `GenerationError`, OpenRouter fetch wrapper, content extraction
- `src/lib/flashcards/schemas.ts:13-15,61-71` — `generateRequestSchema`, `ApiErrorCode` union
- `tests/integration/risk1-rls-isolation.test.ts:1-6` — explicit note excluding Risk #4/#5 sections
- `tests/unit/risk7-generate-input-boundary.test.ts` — existing input-boundary-only coverage for the generation endpoint
- `tests/helpers/auth.ts` — `seedUser()`/`signInDirect()`/`getAuthCookieHeader()`; no age/timestamp-seeding helper yet

## Architecture Insights

- **RLS-as-enforcement, not auth-as-enforcement**: this codebase's established pattern (also used for Risk #1/#3 in Phases 1-2) is to push access control into RLS policies gated by a `security definer` helper, rather than branching in application code. Risk #4 follows the same pattern — the sign-in layer deliberately does not block, it only redirects for UX; the real guarantee is at the RLS layer.
- **Fixed-enum error responses**: the generation endpoint's `fail()`/`ApiErrorCode` pattern (a closed string-literal union, never free-text) is the same defensive shape already validated for Risk #7 in Phase 2 — Risk #6 tests should assert against this same closed schema rather than inventing a new one.
- **External-cron-hits-HTTP-route** is a deliberate, already-implemented choice (see Historical Context) — tests for Risk #4's purge logic should invoke the route directly (with the bearer secret), not attempt to simulate a Workers Cron Trigger.

## Historical Context (from prior changes)

- `context/archive/2026-07-02-account-deletion/plan.md:1-9,66-67,99-142,278-333` — original design: hybrid soft-delete (`account_deletions` table + RLS helper) + service-role hard-delete; purge mechanism was a **deliberate choice of "Option C — external scheduler hits a guarded route"** over a native Cloudflare Cron Trigger, which was explicitly rejected as blocked by an unverified `@astrojs/cloudflare` adapter question.
- `context/archive/2026-07-02-account-deletion/plan.md:390-395,459-461` — the GitHub Actions production run itself was marked "deferred: NOT production-verified" pending deploy/secret provisioning; all code-level phases were implemented and closed.
- `context/archive/2026-06-25-ai-card-generation/plan.md:140-155,203-229` — original design of the generation endpoint's error-code union and client-facing copy mapping (`ERROR_COPY` in `GenerateView.tsx`); explicitly no retries/fallback models, no streaming, and source text is never persisted/logged (GDPR NFR).
- `context/archive/2026-07-04-testing-critical-path-coverage/research.md:171` / `plan.md:33-41,187` — explicitly excluded the SRS/purge-cascade sections of `verify-rls.mjs` as "risks #4/#5... out of scope here," and deferred OpenRouter/MSW mocking to "Phase 3 of the rollout, risk #6."
- `context/archive/2026-07-05-testing-authorization-input-boundary-hardening/research.md:173,271-273` — test-plan.md §6.5 placeholder ("TBD — see §3 Phase 3") and explicit note that generation's provider-error branches are "out of Risk #7's scope... flags this for a future phase" — i.e., this phase.

## Related Research

- `context/archive/2026-07-04-testing-critical-path-coverage/research.md` — Phase 1 research (Risk #1/#2), established the integration-test harness (`tests/helpers/`) this phase should reuse.
- `context/archive/2026-07-05-testing-authorization-input-boundary-hardening/research.md` — Phase 2 research (Risk #3/#7), established the fixed-error-enum pattern this phase's Risk #6 tests should follow.

## Open Questions

- No fixture exists yet to seed an `account_deletions` row with a controlled `requested_at` age (day 29/30/31 boundary) — Phase 3's plan should add one to `tests/helpers/`, following the existing `seedUser()` pattern in `tests/helpers/auth.ts`.
- The purge route requires `SUPABASE_SERVICE_ROLE_KEY` and `CRON_PURGE_SECRET` — confirm both are available in the local/test Supabase environment before planning integration tests against `src/pages/api/cron/purge.ts`; if not locally settable, this may need a scoped exception to the "always hit the real DB" rule for the bearer-auth check specifically (not for the eligibility/erasure logic itself).
- No distinct "timeout" error code exists for AI generation (it collapses into the generic `502 ai_unavailable` catch-all) — confirm this is accepted behavior (it appears to be, by design) rather than a gap, before writing a test that expects a distinct timeout code.
