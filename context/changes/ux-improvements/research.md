---
date: 2026-07-02T16:13:24+0200
researcher: tswiackiewicz
git_commit: 2981322a50958c0334fcad09cc274bf6a6f04fcc
branch: master
repository: 10xdevs
topic: "S-06 ux-improvements — bulk accept/reject, session reset, clearer loading states on the AI candidate review flow"
tags: [research, codebase, flashcards, generate-view, review-flow, loading-states, bulk-actions]
status: complete
last_updated: 2026-07-02
last_updated_by: tswiackiewicz
---

# Research: S-06 ux-improvements — candidate review UX polish

**Date**: 2026-07-02T16:13:24+0200
**Researcher**: tswiackiewicz
**Git Commit**: 2981322a50958c0334fcad09cc274bf6a6f04fcc
**Branch**: master
**Repository**: 10xdevs

## Research Question

How does the S-01 AI candidate review flow currently work, and where do S-06's three additions — **bulk accept/reject**, **reset a review session**, and **clearer loading states** — hook into the existing code without redesigning the flow?

## Summary

- The entire review flow lives in **one client island**, `src/components/flashcards/GenerateView.tsx` (168 lines), plus its child `CandidateCard.tsx`. There is **no new data model, endpoint, or DB work required** for S-06 — all three features are additive island-local state + UI. This matches the roadmap ("no new data model", "polish over an existing surface").
- **Bulk accept/reject is nearly free.** Per-card status is a 3-value enum (`"pending" | "accepted" | "rejected"`) stored on each card object in the single `cards` array. `acceptCard`/`rejectCard` already map over that array by id; `acceptAll`/`rejectAll` are the same `setCards` map without the id filter. The `acceptedCount` derivation and the "Save accepted" filter automatically reflect bulk changes — no new state.
- **Session reset is a 4–5-setter helper** combining the resets that `handleGenerate` and `handleSave` already perform (`setCards([])`, `setText("")`, `setError(null)`, `setSavedCount(null)`).
- **"Clearer loading states"** must stay a determinate-feel state — **no streaming/SSE** (explicit S-01 out-of-scope decision). The current >2s feedback is only an in-button `Loader2` spinner + label swap. The codebase's richest existing loading idiom is `StudyView`'s full-view centered spinner; the confirmation idiom is `SavedCardsView`'s shadcn `AlertDialog`. Both are reusable.
- **Hard guardrail on bulk reject/accept**: human-gating — nothing saves without explicit acceptance, no silent auto-save. FR-004 + US-01 also require each candidate to remain _individually_ accept/edit/reject-able; bulk is additive, never a replacement.
- Two **advisory carry-overs** from prior impl-reviews apply directly to any new async action: (a) guard against double-submit and disable controls while in-flight; (b) the S-01 OpenRouter `fetch` has no timeout/abort, so the "generating" loading state can hang indefinitely — worth bounding if S-06 is making loading states "clearer".

## Detailed Findings

### The review island — `src/components/flashcards/GenerateView.tsx`

**State shape** (all `useState`, no reducer), `GenerateView.tsx:36-40`:

- `text: string` (`:36`) — source textarea; also the "pasted text" preserved across errors.
- `cards: ReviewCard[]` (`:37`) — the candidate list. Each `ReviewCard` = `{ id, question, answer, status }` (`CandidateCard.tsx:4-9`). **This one array holds candidates + per-card accept/reject status + in-place edits.**
- `status: "idle" | "generating" | "saving"` (`:38`) — single mutually-exclusive loading tri-state.
- `error: ApiErrorCode | null` (`:39`); `savedCount: number | null` (`:40`) — save confirmation.

Derived, not stored (`:42-46`): `trimmedLength`, `overLimit`, `acceptedCount = cards.filter(c => c.status === "accepted").length`, `generating`, `saving`.

**Per-card status is an enum, not a boolean/Set.** New cards start `"pending"` (`:64`). Handlers immutably remap the array (`:97-105`):

```ts
function acceptCard(id) {
  setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "accepted" } : c)));
} // :100-102
function rejectCard(id) {
  setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "rejected" } : c)));
} // :103-105
```

There is no toggle back to `"pending"`. "Save accepted" re-filters by enum equality (`:75`) and sends only `{question, answer}` (`:81`) — `pending` and `rejected` are both excluded, so human-gating is enforced by construction.

**Loading UX today** (the only >2s progress mechanism):

- Generate (`handleGenerate`, `:48-72`): clears error/savedCount/cards (`:49-51`), sets `status="generating"`, disables the textarea (`:117`) and Generate button, swaps to `<Loader2 className="animate-spin" />` + "Generating cards…" (`:124-125`), `finally` resets to idle (`:69-70`).
- Save (`handleSave`, `:74-95`): `status="saving"`, Save button → spinner + "Saving…" (`:159-160`), disabled unless `acceptedCount > 0` (`:158`). On success clears `cards` and `text` (`:88-89`) → collapses back to empty start state. **Textarea is NOT disabled during save** (only `generating` disables it).
- No progress bar, percentage, elapsed timer, or full-view spinner — just the in-button spinner.

**Error handling / text preservation**: `ERROR_COPY` maps codes → inline copy (`:8-17`), rendered as one red banner (`:130-134`). `text` is cleared **only on save success** (`:89`); it survives every error path and even generate-success, so the pasted text is preserved as required.

**Render sites for new controls**: the footer bar `:156-162` (currently `{acceptedCount} accepted` + Save button), guarded by `cards.length > 0` (`:142`), is the natural home for bulk + reset buttons. A reset near the textarea also works.

### The card component — `src/components/flashcards/CandidateCard.tsx`

Props (`:11-17`): `card`, `index`, `onEdit(id, field, value)`, `onAccept(id)`, `onReject(id)`. Accept button is `variant="default"` when accepted else `"outline"` (`:32-41`); Reject is `variant="destructive"` when rejected else `"outline"` (`:42-51`). Two `<textarea>`s edit question/answer in place (`:56-73`). Visual tone: accepted = emerald, rejected = `opacity-50`, pending = neutral (`:20-25`). No disabled state on edit even during save. IDs are minted by the parent via `crypto.randomUUID()` (`GenerateView.tsx:61`).

### Reusable loading / confirmation idioms across the feature

- **Status-union + derived-boolean** is the universal loading pattern; **no `useTransition`/`isPending` anywhere**. E.g. `ManualCardForm.tsx:34,38`, `SavedCardsView.tsx:64,67`, `StudyView.tsx:43`.
- **In-button spinner idiom** (copy target): `SavedCardsView.tsx:148-151` — `{saving ? <Loader2 className="size-4 animate-spin"/> : <Save/>}` + label swap + `disabled`.
- **Full-view centered spinner** (richer loading state candidate): `StudyView.tsx:96-102` — `<Loader2 className="size-6 animate-spin"/>` replacing the whole view while `status === "loading"`.
- **Confirmation dialog** (reuse for bulk-reject / reset confirm): `SavedCardsView.tsx:208-225` — shadcn `AlertDialog` wrapping the trigger, async handler on `AlertDialogAction`'s `onClick`. `AlertDialogAction`/`Cancel` forward `variant`/`size` to `Button` (`alert-dialog.tsx:120-146`); pass `variant="destructive"` for destructive confirms. `AlertDialogContent` takes `size?: "default" | "sm"`; `AlertDialogMedia` icon slot exists but is unused.
- **Button variants** (`button.tsx:7-33`): `default | destructive | outline | secondary | ghost | link`; sizes `default | sm | lg | icon`. Disabled styling (`disabled:opacity-50 pointer-events-none`) is global — free with the `disabled` prop.
- **Feedback = inline glass-panel `<p>` banners, no toast library.** Red error `border-red-400/40 bg-red-500/10 text-red-200`; emerald success `border-emerald-400/40 bg-emerald-500/10 text-emerald-200`. `GenerateView` already uses both (`:130-140`).
- **Fetch helper** `postJson`/`requestJson` is duplicated per-file (`GenerateView.tsx:25-33`, `SavedCardsView.tsx:28-32`, `StudyView.tsx:28-32`) — not shared. Follow the local convention or consolidate.
- **No existing multi-select / bulk / checkbox UI anywhere**, and no `Checkbox` in `src/components/ui/` (only `alert-dialog`, `button`, `LibBadge`). Bulk selection UI is net-new — but S-06's "bulk accept/reject" as scoped is accept-all / reject-all over the whole candidate set, which needs **no** per-item selection layer; it just maps over `cards`.

## Code References

- `src/components/flashcards/GenerateView.tsx:36-46` — full state shape + derived values (the S-06 surface).
- `src/components/flashcards/GenerateView.tsx:100-105` — `acceptCard`/`rejectCard`; template for `acceptAll`/`rejectAll`.
- `src/components/flashcards/GenerateView.tsx:48-51,87-89` — the reset setters a `resetSession()` recombines.
- `src/components/flashcards/GenerateView.tsx:156-162` — footer render site for bulk + reset controls.
- `src/components/flashcards/CandidateCard.tsx:11-17` — per-card control props (per-item accept/edit/reject stays).
- `src/components/flashcards/StudyView.tsx:96-102` — full-view spinner idiom (richer loading state).
- `src/components/flashcards/SavedCardsView.tsx:208-225` — `AlertDialog` confirm idiom (reuse for reset/bulk-reject).
- `src/components/ui/button.tsx:7-33` — button variant/size enumeration.
- `src/lib/flashcards/schemas.ts:60-71` — `ApiErrorCode` union (10 codes).
- `src/pages/api/flashcards/index.ts` — save endpoint (already batch-inserts; unchanged for S-06).

## Architecture Insights

- **The batch already exists at the persistence layer, not the UI.** "Save accepted" is one bulk insert of the accepted set (S-01 design). S-06 adds bulk _selection_ UX (accept-all/reject-all) on top of an already-batched save — so no endpoint change is needed.
- **Single-array-of-enum is the enabling data shape.** Because status is a per-card enum on one `cards` array (not parallel booleans or a Set), every count and filter is derived, and bulk mutation is a one-line `map`. This is why S-06 is genuinely low-risk.
- **Determinate-feel loading is a deliberate ceiling.** S-01 explicitly ruled out streaming/SSE; "clearer loading states" means better use of the spinner/disabled/status idioms (and possibly a bounded timeout), not a new progress transport.
- **No toast bus by design** — all feedback is inline glass panels. S-06 feedback (e.g. "all rejected", "session reset") should match, not introduce a toast lib.

## Historical Context (from prior changes)

- `context/archive/2026-06-25-ai-card-generation/plan.md:11-13,363` — **human-gating guardrail**: nothing enters the deck without explicit acceptance; "Rejected candidates leave no DB trace." Bulk reject must not auto-accept; bulk accept stays an explicit action.
- `context/archive/2026-06-25-ai-card-generation/plan.md:73` — **"No streaming/SSE progress — a determinate-feel loading state is enough."** The binding don't-over-build constraint for the loading-state work.
- `context/archive/2026-06-25-ai-card-generation/reviews/impl-review.md:32` — the OpenRouter `fetch` has no `AbortSignal`/timeout; a hung upstream blocks the Worker and never reaches the controlled `ai_unavailable` path. If S-06 is making loading "clearer", bounding this call so the state resolves is the natural companion fix.
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md:266-270` — the shadcn `AlertDialog` delete-confirm pattern; `plan-brief.md:34` — "emerald/red glass panels — no toast system exists."
- `context/archive/2026-07-01-manage-saved-flashcards/plan.md:71` — S-03 explicitly did "no batch/multi-select" **on the saved-cards list**; S-06's bulk actions are on the _review candidate_ surface, a different scope — not a contradiction.
- `context/archive/2026-07-01-spaced-repetition-study/plan.md:65-66` — S-04's deferred "reset" means resetting **persisted SRS state**; S-06's "reset a review session" is **transient island state only** (touches no DB). Keep the terminology distinct.
- `context/archive/2026-07-01-spaced-repetition-study/reviews/impl-review.md:32-34,52` — double-submit / non-idempotent concurrency lesson; fix was `if (status === "loading") return;` + `disabled`. Applies to any new S-06 async control.

## Related Research

- No prior `research.md` exists for other changes (S-01…S-05 went straight to `plan.md`). This is the first research artifact in the repo.
- `context/foundation/lessons.md` **does not exist** — no captured lessons to draw on despite the foundation CLAUDE.md referencing it.

## PRD / roadmap traceability

- **FR-004** (`prd.md:91-94`): each AI candidate must be individually accept/edit/reject-able — bulk is additive, must not remove per-card control.
- **>2s-progress NFR** (`prd.md:120-122`): operations over ~2s show continuous visible progress; the screen never looks frozen. The mandate behind "clearer loading states."
- **US-01 AC** (`prd.md:62-73`): only explicitly accepted cards persist; empty/unusable input yields an explanatory message.
- **Human-gating guardrail** (`prd.md:57-58`): no silent auto-save/auto-accept.
- **Roadmap S-06** (`roadmap.md:156-166`): scope is exactly bulk actions + session reset + loading states; do not redesign the flow; no new data model.
- There is **no PRD FR/NFR that separately specifies bulk actions or session reset** — they are net-new UX on top of FR-004, justified by the roadmap slice, not by a dedicated requirement.

## Open Questions

1. **Latent type mismatch?** `GenerateView.tsx:8` declares `ERROR_COPY: Record<ApiErrorCode, string>` with **8** keys, but `ApiErrorCode` (`schemas.ts:60-71`) has **10** members (`not_found`, `invalid_rating` were added for the study slice). A total `Record` should require all 10 keys under strict TS. Either this currently fails `astro sync`/lint/build, or something relaxes it. Confirm with `/verify` before/while editing this file for S-06 — if it's broken, S-06's edits here are the moment to fix it (e.g. narrow the type to the codes this view can actually receive).
2. **Bulk semantics**: does "accept all" mean all `pending` cards, or override `rejected` ones too? US-01/FR-004 keep individual control, so the likely answer is "apply to all currently-visible candidates" with per-card override still available — confirm the exact rule in the plan.
3. **Loading "clearer" scope**: is the intent (a) just better disabled/spinner coverage on the existing buttons, (b) a full-view generating state like `StudyView`, and/or (c) bounding the un-abortable OpenRouter call so the state can resolve? The roadmap says "clearer loading states"; the plan should pick concretely among these without crossing into streaming/SSE.
4. **Reset confirmation**: should "reset session" require an `AlertDialog` confirm (it discards unsaved edits/accepts — a no-loss-adjacent action) or be a plain button? Prior art gates destructive/irreversible actions behind `AlertDialog`.
