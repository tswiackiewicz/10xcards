# Critical-Path Coverage (Risk #1 & Risk #2) Implementation Plan

## Overview

Bootstrap Vitest and a local-Supabase-backed integration test harness from zero, then write regression tests proving two guardrails already hold in production code: **Risk #1** (a user's flashcards never disappear or become visible/editable by a different account) and **Risk #2** (a rejected or un-actioned AI candidate never becomes a persisted flashcard). This is `context/foundation/test-plan.md` §3 Phase 1 ("Critical-path coverage"). No production code changes are required — both guardrails already work; they are simply unverified by automation today.

## Current State Analysis

- **No test framework exists.** `vitest`, `msw`, `@testing-library/react` are absent from `package.json`/`package-lock.json`. CI (`.github/workflows/ci.yml`) runs `npm ci` → `astro sync` → `lint` → `build` → `supabase link` + `db push --dry-run` (against the _remote_ linked project) — it never starts a local Supabase instance and has no test step.
- **Risk #1 already has a proven, hand-run oracle**: `scripts/verify-rls.mjs` (277 lines) exercises real two-user isolation, anon-read denial, SRS-column isolation, pending-deletion blocking, and purge-cascade correctness using real anon-key + JWT sessions (service-role client reserved for seed/cleanup only). It is never invoked by CI or any test runner.
- **Every flashcard-mutating route relies purely on RLS for ownership scoping** — no route adds an app-level `.eq("user_id", ...)` filter. `PATCH`/`DELETE /api/flashcards/[id]` and `PATCH /api/flashcards/[id]/review` all correctly translate a 0-row RLS-hidden result into `404 not_found` (confirmed by reading `src/pages/api/flashcards/[id].ts:48-63,82-93` and `src/pages/api/flashcards/[id]/review.ts:52-75`) — this is existing, correct behavior.
- **Risk #2's human-gating is enforced exclusively client-side.** `GenerateView.tsx:86-94` filters to `status === "accepted"` before constructing the POST body; the save endpoint (`src/pages/api/flashcards/index.ts:16-55`) has no concept of accept/reject/pending at all — it validates only that `cards` is a well-formed 1–15-item array (`saveRequestSchema`, `src/lib/flashcards/schemas.ts:24-26`) and inserts exactly what it's given via a single atomic `insert(rows)` call, then returns `{ saved: rows.length }` (line 54 — this count is always trustworthy because a multi-row Postgres insert is all-or-nothing).
- **`src/lib/supabase.ts:6-25`** — `createClient(requestHeaders, cookies)` reads the session from `requestHeaders.get("Cookie")` (via `parseCookieHeader`) and persists session refreshes via `cookies.set(name, value, options)`. This is a plain, fakeable contract — it needs only a real `Headers` object and an object exposing `.set()`, not a running HTTP server.

### Key Discoveries:

- `src/pages/api/flashcards/index.ts:54` — `json(200, { saved: rows.length })`, driven by a single atomic `insert(rows)`; there is no partial-insert failure mode to guard against for a single request.
- `src/pages/api/flashcards/[id].ts:48-50,82-84` and `src/pages/api/flashcards/[id]/review.ts:67-75` — the "0 rows affected → 404, not 200" pattern is already implemented everywhere ownership matters.
- `scripts/verify-rls.mjs:9` — the script's own header documents the correct way to source local credentials: `npx supabase status -o env`. The test harness should use the same mechanism rather than hardcoding or duplicating credential logic.
- `astro.config.mjs:20-27` and `src/lib/supabase.ts:3` — the app reads `SUPABASE_URL`/`SUPABASE_KEY` via `astro:env/server`, a name pairing distinct from `supabase status`'s own `SUPABASE_ANON_KEY` output name. These are two different consumers (the app process vs. the test harness) and can be sourced from the same underlying local instance under their own expected names — no ambiguity, no code change needed.
- `tsconfig.json:8-12` — `@/*` → `./src/*`, extending `astro/tsconfigs/strict`. Vitest must resolve the same alias; Astro's documented pattern for this is `getViteConfig` from `astro/config` in `vitest.config.ts`, which inherits the project's Vite config (including the `@/*` alias resolution Astro sets up internally) without duplicating it.
- `.gitignore` explicitly lists `.env` and `.env.production` (not a wildcard) — a new `.env.test.local` needs its own line.

## Desired End State

After this plan lands:

- `npm test` runs a Vitest suite against a local Supabase instance and passes.
- CI starts a local Supabase instance and runs `npm test` as a required step before deploy; a broken RLS policy or a broken save-endpoint contract fails the build.
- Two new integration test files exist, each independently provable as a regression guard: one for Risk #1 (ownership/isolation, at both the RLS-policy layer and the route-wiring layer), one for Risk #2 (the save endpoint's exact persisted-set contract).
- `context/foundation/test-plan.md` §6.1/§6.2 cookbook sections describe how to add the next unit/integration test in this project, and Phase 1's row in §3 reflects its shipped status.

**Verification**: `npm test` exits 0 locally (with `supabase start` already running) and in CI; `scripts/verify-rls.mjs` continues to work standalone (untouched) as a documented manual fallback for the risks Phase 1 doesn't cover (SRS columns, purge cascade — those are Risk #4/#5, out of scope here).

## What We're NOT Doing

- Not touching `scripts/verify-rls.mjs`'s SRS-column (lines 131-170) or purge-cascade (lines 216-258) sections — those map to risks #4/#5, assigned to later rollout phases. The script stays in place, untouched, as their manual fallback.
- Not adding server-side enforcement of the accept/reject decision to the save endpoint. Per this phase's chosen scope, we prove and document _current_ (client-only-enforced) behavior; closing that gap is a feature change, not a test-bootstrap task, and is out of scope here.
- Not installing MSW, `@testing-library/react`, or any DOM/component-testing environment. Neither risk in this phase needs HTTP mocking or rendered-component assertions — both are provable at the server/API-contract layer. MSW is deferred to whichever later phase (Phase 3 of the rollout, risk #6) actually needs to mock the OpenRouter HTTP edge.
- Not adding a test asserting 401-on-unauthenticated-request for routes not covered by `src/middleware.ts`'s `PROTECTED_ROUTES`. That gap (API routes aren't in the prefix list) is real but is an authentication-routing concern, not this phase's ownership/no-loss/human-gating scope.
- Not testing `/api/flashcards/generate` or any OpenRouter-calling code path.
- Not changing `src/middleware.ts`, any RLS policy/migration, or any flashcard route's production logic.

## Implementation Approach

Follow the test-plan's cost×signal rule literally: both risks are graded "integration" as the cheapest layer with real signal in `test-plan.md`'s Risk Response Guidance table, because a mocked Supabase client would lie about RLS by construction, and a mocked save-endpoint would lie about the actual persisted-set contract. Every new test in this phase runs against a real local Supabase instance (`supabase start`) using real Supabase clients — nothing about the DB or auth layer is mocked.

Two distinct proof layers are needed for Risk #1, both grounded in the Risk Response Guidance's explicit warning that "RLS policy exists" ≠ "RLS is hit on every query path":

1. **RLS-policy layer** (ported from `verify-rls.mjs`): proves the database's RLS predicates themselves are correct, using `@supabase/supabase-js` directly against the `flashcards` table — no Astro code involved.
2. **Route-wiring layer** (new): proves the _application's_ route handlers actually use the session-bound client and actually surface RLS's 0-row result as a 404 — by invoking the real exported route handler functions with a real authenticated session, real request bodies, and a real local Supabase instance. The only fake is the outermost Astro HTTP-transport plumbing (a minimal `APIContext`-shaped object), since that plumbing is not what either risk is about.

Risk #2 is proved at the same route-wiring layer: submit a request body shaped exactly like what `GenerateView.tsx`'s accept-filter would produce for a mixed accept/edit/reject/pending batch, directly to the save endpoint's handler, and assert the persisted set is exactly the accepted (possibly edited) subset — an independently-specified oracle, not a re-derivation of the endpoint's own insert logic.

## Critical Implementation Details

**Auth-cookie test helper (load-bearing, non-obvious).** `createClient()` in `src/lib/supabase.ts` never manufactures its own session — it only reads whatever `Cookie` header it's given. To get a _valid_ cookie without hand-encoding `@supabase/ssr`'s internal session format (version-specific, not meant to be reverse-engineered), sign in once with a plain `@supabase/supabase-js` client to obtain `{ access_token, refresh_token }`, then feed those into a throwaway `createServerClient` instance whose `setAll` callback records into an in-memory array instead of writing real cookies:

```ts
async function getAuthCookieHeader(email: string, password: string, env: TestEnv): Promise<string> {
  const plain = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await plain.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);

  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (toSet) => toSet.forEach(({ name, value }) => jar.push({ name, value })) },
  });
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return jar.map(({ name, value }) => `${name}=${value}`).join("; ");
}
```

This produces the exact cookie encoding the real app expects (it's generated by the same `@supabase/ssr` version the app uses), so it stays correct across library upgrades without any hand-maintained format assumption. Every route-level test in Phase 2 and Phase 3 reuses this helper.

**Route handlers are invoked directly, not over HTTP.** Since `createClient` only needs `request.headers.get("Cookie")` and `cookies.set(...)`, route tests construct a real `Request` object (real `Headers`, real JSON body) and a minimal fake `cookies: { set: () => {} }`, then call the route module's exported `POST`/`PATCH`/`DELETE` function directly (e.g. `import { POST } from "@/pages/api/flashcards"`). This exercises the real handler code, the real `@supabase/ssr` client, and the real local Supabase instance — it only skips the Node HTTP server and Astro's routing layer, neither of which either risk is about. No `astro dev`/`wrangler dev` process needs to be booted or torn down for any test in this phase.

**Env sourcing at test-run time, not a static file.** `tests/setup/env.ts` runs `supabase status -o env` (child process) once per test run and parses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from its output — mirroring `scripts/verify-rls.mjs`'s own documented invocation. This fails loudly with a clear error if `supabase start` hasn't been run first, rather than silently testing against an unset/wrong instance.

## Phase 1: Test harness & CI bootstrap

### Overview

Install Vitest, wire it to the project's existing TypeScript/alias conventions, add the reusable test helpers every later phase depends on, and make local-Supabase-backed tests a required CI gate.

### Changes Required:

#### 1. Test runner dependency and scripts

**File**: `package.json`

**Intent**: Add Vitest as the only new test-runner dependency (per the MSW/testing-library exclusion above) and expose `test`/`test:watch` scripts.

**Contract**: `devDependencies` gains `vitest` (latest stable compatible with Vite 7, per the existing `overrides.vite` pin). `scripts` gains `"test": "vitest run"` and `"test:watch": "vitest"`.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Inherit the project's real Vite config (so the `@/*` alias and Astro's own Vite plugins resolve identically to the app) rather than re-declaring alias resolution by hand, per Astro's documented Vitest integration pattern.

**Contract**:

```ts
/// <reference types="vitest" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["tests/setup/env.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
```

`globals: false` is deliberate: tests import `describe`/`it`/`expect` explicitly from `"vitest"`, avoiding any need for an ESLint globals override.

#### 3. Env-sourcing setup file

**File**: `tests/setup/env.ts` (new)

**Intent**: Populate `process.env.SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` from the running local Supabase instance before any test file executes, failing fast with a clear message if `supabase start` wasn't run first.

**Contract**: Runs `execSync("npx supabase status -o env")`, parses the `KEY=value` lines it prints, assigns to `process.env`. Throws (failing the whole run) if the command errors, with a message pointing at `supabase start`.

#### 4. Shared test helpers

**File**: `tests/helpers/auth.ts` (new)

**Intent**: Give every integration test in Phase 2/3 a single, reused way to seed a throwaway user, get an authenticated cookie header for it (per the Critical Implementation Details helper above), and clean it up afterward — mirroring `scripts/verify-rls.mjs:52-60,263-267`'s existing seed/cleanup pattern so the two don't drift.

**Contract**: Exports `seedUser()`, `cleanupUser(id)` (service-role client, `auth.admin.createUser`/`deleteUser`), and `getAuthCookieHeader(email, password)` (the helper described above).

**File**: `tests/helpers/api-context.ts` (new)

**Intent**: Provide a minimal, reusable factory for the fake `APIContext`-shaped object every route-handler test needs (`request`, `cookies`, `params`, `locals`), so each test file doesn't hand-roll its own.

**Contract**: A `buildContext({ method, url, cookieHeader, body, params })` function returning `{ request: new Request(url, { method, headers, body }), cookies: { set: () => {} }, params: params ?? {}, locals: {} }`, typed loosely enough to satisfy the specific route modules under test (they only destructure `request`, `cookies`, `params`).

#### 5. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Start a local Supabase instance and run the test suite as a required step before `npm run build`, reusing the `supabase/setup-cli@v1` action already present in the job (currently used only for the later `db push --dry-run` step).

**Contract**: Move the `supabase/setup-cli@v1` step earlier in the `ci` job (before the new test step), add a `supabase start` step, then a `npm test` step — both inserted between the existing `npm run lint` and `npm run build` steps. The existing `supabase link` + `db push --dry-run` step (against the _remote_ project) stays where it is, unaffected — it's a separate concern from the local instance used for tests.

#### 6. Ignore the generated test-env file

**File**: `.gitignore`

**Intent**: Prevent an accidentally-committed local-instance env file, matching the existing explicit (non-wildcard) style of the `.env`/`.env.production` entries.

**Contract**: Add a `.env.test.local` line under the existing "environment variables" section.

### Success Criteria:

#### Automated Verification:

- `npm test` runs and exits 0 against a running local Supabase instance (even with zero test files yet, i.e., the harness itself is functional)
- `npm run lint` passes with the new files present
- `npx astro sync && npm run build` still passes unaffected

#### Manual Verification:

- Running `supabase start` then `npm test` locally produces the expected "no test files found" (or a trivial smoke test) output, confirming env-sourcing and Vitest config work end-to-end before Phase 2 adds real assertions
- A deliberately-stopped local Supabase instance (`supabase stop`) makes `npm test` fail with the clear, intentional error message from `tests/setup/env.ts` — not a cryptic connection error

---

## Phase 2: Risk #1 — flashcard ownership & isolation tests

### Overview

Prove that a user's flashcards are never visible or mutable by a different account, at both the RLS-policy layer and the application route-wiring layer.

### Changes Required:

#### 1. RLS-policy-layer test (ported from `verify-rls.mjs`)

**File**: `tests/integration/risk1-rls-isolation.test.ts` (new)

**Intent**: Port the F-01 core assertions from `scripts/verify-rls.mjs` (lines 69-129: two-user insert/select/update/delete isolation, cross-user insert rejection, signed-out anon read denial, post-attack data integrity) into Vitest `describe`/`it` blocks, using the same real anon-key+JWT-session pattern. Do not port the SRS-column (lines 131-170) or purge-cascade (lines 216-258) sections — those are out of scope for this phase.

**Contract**: One `describe` block seeding users A and B via `tests/helpers/auth.ts`'s `seedUser`, signing in with plain `@supabase/supabase-js` clients (not the app's SSR client — this layer tests the DB directly), with `it` blocks mirroring each assertion group from the ported script section. Cleanup in an `afterAll`.

#### 2. Route-wiring-layer test (new)

**File**: `tests/integration/risk1-api-route-ownership.test.ts` (new)

**Intent**: Prove the application's own route handlers — not just the raw RLS policy — enforce ownership, per the Risk Response Guidance's explicit challenge that a route using the wrong client could silently bypass RLS even if the policy itself is correct. Covers the three routes that mutate an existing flashcard by ID: `PATCH /api/flashcards/[id]`, `DELETE /api/flashcards/[id]`, `PATCH /api/flashcards/[id]/review`.

**Contract**: Using `tests/helpers/api-context.ts` and `tests/helpers/auth.ts`'s `getAuthCookieHeader`, seed user A with one card (via the real `POST /api/flashcards` handler, which doubles as the create-path assertion), then for each of the three by-ID routes: assert user A's own request succeeds (200, with the correct response shape per each route — `{updated: 1}`, `{deleted: 1}`, `{due: <value>}`), and assert user B's request against A's card id returns `404 not_found` (not 200, not a 500) — proving the 0-row-hidden-row pattern holds through the real handler, not just at the DB layer.

### Success Criteria:

#### Automated Verification:

- `npm test` passes both new test files against a fresh local Supabase instance
- Temporarily reverting one RLS policy (e.g., dropping `flashcards_update_own`'s `WITH CHECK`) locally causes at least one test in `risk1-rls-isolation.test.ts` to fail — confirming the port didn't lose signal from the original script
- `npm run lint` and `npx astro sync && npm run build` remain green

#### Manual Verification:

- Run `scripts/verify-rls.mjs` standalone once more and confirm it still passes unmodified, so the un-ported SRS/purge sections remain a working manual fallback for later phases

---

## Phase 3: Risk #2 — AI review human-gating contract test

### Overview

Prove that, given a batch representing a mixed accept/edit/reject/pending review decision, the save endpoint persists exactly the accepted (possibly edited) subset — nothing more, nothing less — and document the client-only-enforcement caveat this test necessarily carries.

### Changes Required:

#### 1. Save-endpoint contract test

**File**: `tests/integration/risk2-review-save-contract.test.ts` (new)

**Intent**: Submit a request body shaped exactly like what `GenerateView.tsx:86-94`'s accept-filter would construct for a scenario with one verbatim-accepted candidate, one edited-then-accepted candidate, and (implicitly, by their absence from the payload) one rejected and one pending candidate — then assert the resulting `flashcards` rows for that user are exactly the two accepted ones, with the edited candidate's _edited_ text persisted, not its original text. The expected set is authored independently in the test (the oracle), not derived from re-running the endpoint's own insert logic.

**Contract**: One authenticated `POST /api/flashcards` call via the Phase 1 route-invocation helpers, with a `{ cards: [...] }` body containing only the two accepted entries. Assertions: response is `{ saved: 2 }`; a subsequent authenticated read (via the seeded user's session, `select("*")`) returns exactly those two rows with `source: "ai"` and the edited text for the second; the user's total row count for this test run equals exactly 2 (no extra rows from anything not in the request).

**Also add** a short code comment (not a test) at the top of the file stating: this test proves the current behavior where human-gating is enforced entirely client-side before this request is ever constructed — it is not a server-side invariant, per this phase's explicitly chosen scope.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including the new Risk #2 test
- `npm run lint` and `npx astro sync && npm run build` remain green

#### Manual Verification:

- Manually POST a payload containing an extra, unexpected card to the save endpoint (e.g., via `curl` with a valid session cookie) and confirm it saves — confirming by direct observation (not just the automated test) that the documented client-only-enforcement caveat is accurate, i.e., the server truly has no independent check to fail here

---

## Phase 4: Cookbook & test-plan sync

### Overview

Close the loop on `context/foundation/test-plan.md`: fill in the cookbook sections this phase makes true, and flip Phase 1's status now that its change folder has real content.

### Changes Required:

#### 1. Cookbook — unit test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 "TBD" placeholder with the actual convention established in Phase 1 (though this phase added no pure unit tests, the section should state that decision and point to where one would go: `tests/**/*.test.ts`, explicit `vitest` imports, `getViteConfig`-based config).

**Contract**: §6.1 body updated from "TBD — see §3 Phase 1" to a short description of the file-naming/import convention.

#### 2. Cookbook — integration test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.2 "TBD" placeholder with the actual two-layer pattern this phase established (RLS-policy-layer via plain `supabase-js` + real sessions; route-wiring-layer via direct handler invocation + the auth-cookie helper), so the next rollout phase (#3/#7, authorization & input-boundary hardening) can reuse it instead of rediscovering it.

**Contract**: §6.2 body updated with a short description referencing `tests/helpers/auth.ts` and `tests/helpers/api-context.ts` by name.

#### 3. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 1 has moved past "change opened."

**Contract**: §3 table row 1's Status cell updates along the fixed vocabulary (`researched` → `planned` → ... as this plan and its implementation progress); §5 Quality Gates row "unit + integration" changes from "required after §3 Phase 1" framing to reflect it is now wired, once implementation lands.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (no code changes in this phase, but confirms nothing else broke)

#### Manual Verification:

- `context/foundation/test-plan.md` §6.1, §6.2, §3, §5 read correctly and match what Phases 1-3 actually built (no stale "TBD" left for content this phase shipped)

---

## Testing Strategy

### Unit Tests:

- None in this phase, by explicit decision (see "What We're NOT Doing") — both risks are graded "integration" as the cheapest real-signal layer per the test-plan's own Risk Response Guidance, and a unit test mocking Supabase would lie about RLS by construction.

### Integration Tests:

- `tests/integration/risk1-rls-isolation.test.ts` — RLS-policy layer (ported from `verify-rls.mjs`)
- `tests/integration/risk1-api-route-ownership.test.ts` — route-wiring layer (new)
- `tests/integration/risk2-review-save-contract.test.ts` — save-endpoint contract (new)

### Manual Testing Steps:

1. `supabase start`, then `npm test` — confirm all three integration test files pass
2. Temporarily drop one RLS policy locally, re-run `npm test` — confirm `risk1-rls-isolation.test.ts` fails loudly, then restore the policy
3. `curl` an extra unexpected card into `POST /api/flashcards` with a valid session cookie — confirm it saves, validating the documented Risk #2 client-only-enforcement caveat
4. Run `scripts/verify-rls.mjs` standalone — confirm it still passes, unmodified

## Performance Considerations

`supabase start` adds real wall-clock time (roughly 30-60 seconds) to every CI run once wired in Phase 1. This is accepted as the cost of a real-signal RLS test, per the test-plan's cost×signal principle — a mocked alternative would be faster but would lie about the exact risk being protected against.

## Migration Notes

None — no schema or migration changes in this plan.

## References

- Related research: `context/changes/testing-critical-path-coverage/research.md`
- Existing RLS oracle (source for Phase 2's ported test): `scripts/verify-rls.mjs`
- Save endpoint under test: `src/pages/api/flashcards/index.ts:16-55`
- By-ID mutation routes under test: `src/pages/api/flashcards/[id].ts:19-93`, `src/pages/api/flashcards/[id]/review.ts:24-77`
- Client construction contract the test helpers must satisfy: `src/lib/supabase.ts:6-25`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test harness & CI bootstrap

#### Automated

- [x] 1.1 `npm test` runs and exits 0 against a running local Supabase instance — ee74f0d
- [x] 1.2 `npm run lint` passes with the new files present — ee74f0d
- [x] 1.3 `npx astro sync && npm run build` still passes unaffected — ee74f0d

#### Manual

- [x] 1.4 `supabase start` then `npm test` produces expected harness-functional output — ee74f0d
- [x] 1.5 A stopped local Supabase instance makes `npm test` fail with the clear intentional error message — ee74f0d

### Phase 2: Risk #1 — flashcard ownership & isolation tests

#### Automated

- [x] 2.1 `npm test` passes both new test files against a fresh local Supabase instance
- [x] 2.2 Temporarily reverting one RLS policy causes a test failure in `risk1-rls-isolation.test.ts`
- [x] 2.3 `npm run lint` and `npx astro sync && npm run build` remain green

#### Manual

- [x] 2.4 `scripts/verify-rls.mjs` still passes standalone, unmodified

### Phase 3: Risk #2 — AI review human-gating contract test

#### Automated

- [ ] 3.1 `npm test` passes, including the new Risk #2 test
- [ ] 3.2 `npm run lint` and `npx astro sync && npm run build` remain green

#### Manual

- [ ] 3.3 Manually POST an extra unexpected card to the save endpoint and confirm it saves (validates the documented caveat)

### Phase 4: Cookbook & test-plan sync

#### Automated

- [ ] 4.1 `npm run lint` passes

#### Manual

- [ ] 4.2 `test-plan.md` §6.1, §6.2, §3, §5 read correctly and match what Phases 1-3 built
