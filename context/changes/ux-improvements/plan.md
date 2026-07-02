# Candidate Review UX — Bulk Actions, Session Reset, Clearer Loading States — Implementation Plan

## Overview

Add three UX polish features to the AI candidate review flow (roadmap slice **S-06**): **bulk accept/reject**, **reset a review session**, and **clearer loading states**. All three are additive, island-local changes to `src/components/flashcards/GenerateView.tsx` (and a small prop addition to `CandidateCard.tsx`). No new data model, no new endpoint, no migration — the save endpoint already batch-inserts.

## Current State Analysis

The entire review flow lives in one client island, `src/components/flashcards/GenerateView.tsx` (168 lines), with a child `CandidateCard.tsx`. Per research (`context/changes/ux-improvements/research.md`):

- **State** (`GenerateView.tsx:36-40`): `text`, `cards: ReviewCard[]`, `status: "idle" | "generating" | "saving"`, `error`, `savedCount`. Per-card status is a 3-value enum on each card in the single `cards` array; `acceptedCount` and the "Save accepted" filter are derived from it (`:44,75`).
- **Bulk hooks already exist in shape**: `acceptCard`/`rejectCard` (`:100-105`) map over `cards` by id — a bulk version is the same map without the id filter. `acceptedCount` and the save filter update automatically.
- **Reset hooks already exist in shape**: `handleGenerate` clears `error`/`savedCount`/`cards` (`:49-51`); `handleSave` on success also clears `cards`/`text` (`:87-89`). A `resetSession()` recombines these setters.
- **Loading today** is only an in-button `Loader2` + label swap. Gaps: during **generate** the card area is empty (cleared at `:51`) with no visible spinner there; during **save** the textarea and per-card controls stay enabled (`:117` disables textarea only on `generating`; `CandidateCard` has no disabled state).
- **Reusable idioms**: `StudyView.tsx:96-102` full-view centered `Loader2`; `SavedCardsView.tsx:208-225` shadcn `AlertDialog` confirm; inline glass-panel banners (no toast lib); `Button` variants `default | destructive | outline | secondary | ghost | link`, sizes `default | sm | lg | icon`.
- **Latent type smell** (`GenerateView.tsx:8`): `ERROR_COPY: Record<ApiErrorCode, string>` lists 8 keys but `ApiErrorCode` (`schemas.ts:60-71`) has 10 (`not_found`, `invalid_rating` from the study slice). CI (`astro sync → lint → build`) does **not** run `tsc`/`astro check`, so this does not fail the build today — but it is a type lie in a file we are editing.

## Desired End State

A signed-in user on `/generate`, after generating candidates, sees:

- **Bulk controls** in the footer: "Accept all" and "Reject all" that apply to the remaining `pending` cards, leaving cards the user already accepted/rejected untouched. Per-card Accept/Edit/Reject still work (FR-004 individual control preserved).
- **A "Reset" control** that returns the island to its empty start state (clears candidates, textarea, error, and confirmation). If there is unsaved work (candidates present), it asks for confirmation first via `AlertDialog`; with nothing to lose, it resets immediately.
- **Clearer loading**: during generation a full-view centered spinner with a "Generating cards…" label occupies the card area (the screen never looks frozen — the >2s NFR); during save the textarea, all per-card controls, and all footer buttons are disabled so nothing can be double-submitted or edited mid-write.
- Human-gating intact: only explicitly accepted cards are saved; bulk reject never auto-accepts; reset only clears transient state and never touches the deck.

Verify: `npx astro sync && npm run lint && npm run build` pass; manual end-to-end confirms each behavior.

### Key Discoveries:

- `GenerateView.tsx:100-105` — `acceptCard`/`rejectCard`; template for `acceptAll`/`rejectAll` (pending-only variant).
- `GenerateView.tsx:48-51,87-89` — the setters `resetSession()` recombines.
- `GenerateView.tsx:142-164` — card-list + footer render region; where full-view spinner, bulk buttons, and reset live.
- `CandidateCard.tsx:11-17,32-73` — props + controls to gate behind a new `disabled` prop.
- `StudyView.tsx:96-102` — full-view spinner idiom to mirror.
- `SavedCardsView.tsx:208-225` — `AlertDialog` confirm idiom to mirror; import surface at `SavedCardsView.tsx:4-14`.
- `schemas.ts:60-71` — `ApiErrorCode` union (10 codes) driving the type fix.

## What We're NOT Doing

- **No streaming/SSE progress** — determinate-feel loading only (explicit S-01 out-of-scope decision, `context/archive/2026-06-25-ai-card-generation/plan.md:73`).
- **No per-item multi-select / checkboxes** — bulk is accept-all / reject-all over the candidate set, not a selection layer.
- **No AbortController/timeout on the OpenRouter call** — the un-bounded fetch (research open Q3 / `ai-card-generation/reviews/impl-review.md:32`) is a real follow-up but widens scope to `generation.ts`/the endpoint; deferred and noted below.
- **No new endpoint, schema, or migration** — the save endpoint already batch-inserts.
- **No toast system** — feedback stays inline glass-panel banners.
- **No redesign of the review flow** — layout, generation, and save semantics are unchanged.
- **No test framework** — verification is lint/build + manual, consistent with prior slices.

## Implementation Approach

Two phases, both confined to the review island. Phase 1 adds the bulk + reset behavior (pure state + handlers + footer UI + one confirm dialog). Phase 2 tightens the loading/disabled surface and corrects the `ERROR_COPY` type. Splitting them gives a clean manual-verification checkpoint after the behavior lands and before the polish/disable pass.

## Critical Implementation Details

- **State sequencing (reset):** `resetSession()` must clear the same fields the existing start-of-generate / save-success paths clear (`cards`, `text`, `error`, `savedCount`) so the island returns to a true initial state — do not leave a stale `savedCount` banner or `error` behind.
- **Bulk = pending-only:** `acceptAll`/`rejectAll` map `cards` and change status **only** where `status === "pending"`, preserving explicit prior per-card decisions (FR-004). This is the deliberate semantic, not "set every card".
- **Disable-all during save is the guardrail against double-submit:** while `saving`, the textarea, every `CandidateCard` control, and all footer buttons (bulk, reset, save) must be disabled — mirrors the `spaced-repetition-study` double-submit lesson (`reviews/impl-review.md:32-34`).

## Phase 1: Bulk Actions & Session Reset

### Overview

Add pending-only `acceptAll`/`rejectAll`, a `resetSession()` helper, footer controls for all three, and an `AlertDialog` that gates reset only when unsaved work exists.

### Changes Required:

#### 1. Bulk + reset handlers

**File**: `src/components/flashcards/GenerateView.tsx`

**Intent**: Add three island handlers mirroring the existing per-card handlers, so bulk and reset reuse the single `cards` array and the existing setters — no new state.

**Contract**:

- `acceptAll()` / `rejectAll()` — `setCards(prev => prev.map(c => c.status === "pending" ? { ...c, status } : c))`. Pending-only; already-decided cards unchanged.
- `resetSession()` — clears `cards` (`[]`), `text` (`""`), `error` (`null`), `savedCount` (`null`). Reuses the exact fields cleared at `:49-51` / `:87-89`.
- Add derived `pendingCount = cards.filter(c => c.status === "pending").length` so bulk buttons can disable when there is nothing pending.

#### 2. Footer controls + reset confirmation

**File**: `src/components/flashcards/GenerateView.tsx`

**Intent**: Surface the new actions in the existing footer region (`:156-162`), and gate reset behind a confirm dialog only when candidates are present (unsaved work).

**Contract**:

- In the `cards.length > 0` block, add "Accept all" (`variant="outline"` or `secondary`) and "Reject all" (`variant="outline"`) next to the existing accepted-count span; both `disabled` when `pendingCount === 0` or while `generating || saving`.
- Add a "Reset" control (`variant="ghost"`). When `cards.length > 0`, wrap it in a shadcn `AlertDialog` (mirror `SavedCardsView.tsx:208-225`) titled e.g. "Reset this review session?" / "Your unsaved candidates and edits will be discarded." with Cancel + a destructive Reset action calling `resetSession`. When there is nothing to lose, a plain button calling `resetSession` directly is acceptable — but a single always-mounted `AlertDialog` whose trigger is only rendered when `cards.length > 0` is the simplest correct form.
- Import `AlertDialog` family from `@/components/ui/alert-dialog` (component already installed).

#### 3. CandidateCard visual state (no functional change)

**File**: `src/components/flashcards/CandidateCard.tsx`

**Intent**: None required for Phase 1 beyond confirming bulk status changes flow through the existing `tone` styling. (The `disabled` prop is added in Phase 2.)

**Contract**: No change in this phase; bulk updates reuse the existing `card.status` → `tone` mapping (`:20-25`).

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- After generating, "Accept all" moves every pending card to accepted and leaves any manually-rejected card rejected; "Reject all" is symmetric. `{acceptedCount} accepted` updates correctly.
- Per-card Accept/Edit/Reject still override after a bulk action (FR-004).
- "Reset" with candidates present shows the confirm dialog; confirming clears candidates, textarea, error, and any saved-count banner back to the empty start state; cancelling changes nothing.
- Bulk buttons are disabled when no cards are pending.
- No card is saved by any bulk/reset action (human-gating): only "Save accepted" persists.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Clearer Loading States & Type Fix

### Overview

Make in-flight states unmistakable and safe: a full-view spinner during generation, a full disable pass during save, and correct the `ERROR_COPY` type.

### Changes Required:

#### 1. Full-view generating state

**File**: `src/components/flashcards/GenerateView.tsx`

**Intent**: Give the >2s generation a visible working state in the (currently empty) card area so the screen never looks frozen.

**Contract**: When `generating`, render a centered `<Loader2 className="size-6 animate-spin" />` with a "Generating cards…" label in the card region (mirror `StudyView.tsx:96-102`). The existing in-button spinner on Generate stays. Card list renders only when `!generating && cards.length > 0`.

#### 2. Disable-all during save

**File**: `src/components/flashcards/GenerateView.tsx`, `src/components/flashcards/CandidateCard.tsx`

**Intent**: Prevent edits and double-submits while the save request is in flight.

**Contract**:

- `GenerateView`: disable the textarea while `saving` (add `saving` to the existing `disabled` at `:117`); disable bulk + reset buttons while `saving` (already specified in Phase 1); Save button already disables while `saving`.
- `CandidateCard`: add an optional `disabled?: boolean` prop; when true, disable the Accept/Reject `Button`s and set the two `<textarea>`s `disabled`. `GenerateView` passes `disabled={saving}` to each `CandidateCard`.

#### 3. Fix ERROR_COPY type

**File**: `src/components/flashcards/GenerateView.tsx`

**Intent**: Remove the type lie — this view can only ever receive the generate/save error codes, not the study codes.

**Contract**: Change `ERROR_COPY`'s type from `Record<ApiErrorCode, string>` to the codebase-consistent `Partial<Record<ApiErrorCode, string>>` (matching `SavedCardsView`/`StudyView`/`ManualCardForm`). Keep rendering via `error && ERROR_COPY[error]`; because `error` is only ever set to codes present in the map, the banner text is always defined. (Alternative, if a total map is preferred: type it as `Record<Exclude<ApiErrorCode, "not_found" | "invalid_rating">, string>`.)

### Success Criteria:

#### Automated Verification:

- Type sync passes: `npx astro sync`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- During generation, the card area shows a centered spinner + "Generating cards…"; the screen never looks frozen; on completion candidates render (or the appropriate error banner shows).
- During save, the textarea, all per-card Accept/Edit/Reject controls, and all footer buttons are disabled; rapid double-clicks cannot fire a second save.
- All existing error paths still show their friendly banner with pasted text preserved.

**Implementation Note**: Final phase. After automated checks pass, pause for manual confirmation of the full end-to-end flow before the closing commit.

---

## Testing Strategy

### Unit Tests:

- None — no test framework is wired (consistent with all prior slices).

### Integration Tests:

- None automated; manual end-to-end in the browser.

### Manual Testing Steps:

1. `npm run dev`; sign in; visit `/generate`; with a local `OPENROUTER_API_KEY`, paste a paragraph and Generate.
2. During the call, confirm the full-view spinner + "Generating cards…".
3. Reject one card manually, then click "Accept all" → confirm only the pending cards became accepted and the manually-rejected one stayed rejected. Click a per-card Reject to confirm individual override still works.
4. Click "Reset" → confirm dialog appears → cancel (nothing changes) → Reset again → confirm → island returns to empty start state.
5. Accept a couple of cards, click "Save accepted"; during save confirm textarea + all controls are disabled and a double-click cannot double-submit; on success confirm the "N cards saved" banner and cleared queue.
6. Exercise error paths (empty input, >10k chars, unset key) → friendly banner, pasted text preserved.
7. `npx astro sync && npm run lint && npm run build`.

## Performance Considerations

No new network calls; bulk/reset are O(n) `map`s over ≤15 cards. Loading changes are render-only.

## Migration Notes

- No DB migration, no schema change, no new endpoint or secret.
- Rollback: code-only revert of the two components; `npx wrangler rollback` if already deployed.

## References

- Related research: `context/changes/ux-improvements/research.md`
- Surface being polished: `src/components/flashcards/GenerateView.tsx`, `src/components/flashcards/CandidateCard.tsx`
- Reused idioms: `src/components/flashcards/StudyView.tsx:96-102`, `src/components/flashcards/SavedCardsView.tsx:208-225`
- Guardrails: `context/foundation/prd.md` (FR-004, >2s-progress NFR, human-gating), `context/foundation/roadmap.md:156-166` (S-06)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bulk Actions & Session Reset

#### Automated

- [x] 1.1 Type sync passes (`npx astro sync`)
- [x] 1.2 Lint passes (`npm run lint`)
- [x] 1.3 Build passes (`npm run build`)

#### Manual

- [x] 1.4 Accept-all / reject-all apply to pending cards only; already-decided cards unchanged; accepted-count updates
- [x] 1.5 Per-card Accept/Edit/Reject still override after a bulk action
- [x] 1.6 Reset with candidates present shows confirm; confirming returns to empty start state; cancel is a no-op
- [x] 1.7 Bulk buttons disabled when nothing is pending
- [x] 1.8 No bulk/reset action persists any card (human-gating)

### Phase 2: Clearer Loading States & Type Fix

#### Automated

- [ ] 2.1 Type sync passes (`npx astro sync`)
- [ ] 2.2 Lint passes (`npm run lint`)
- [ ] 2.3 Build passes (`npm run build`)

#### Manual

- [ ] 2.4 Full-view spinner + "Generating cards…" shows during generation; screen never looks frozen
- [ ] 2.5 During save, textarea + all per-card controls + all footer buttons are disabled; double-click cannot double-submit
- [ ] 2.6 All error paths still show the friendly banner with pasted text preserved
