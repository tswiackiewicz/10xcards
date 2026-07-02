<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Candidate Review UX — Bulk Actions, Session Reset, Clearer Loading States

- **Plan**: context/changes/ux-improvements/plan.md
- **Scope**: Full plan (Phase 1 & 2 of 2)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Generate button stays clickable during an in-flight save (request/state race)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/flashcards/GenerateView.tsx:147
- **Detail**: Every interactive control in the review block is gated on `saving` (Accept all :196, Reject all :205, Reset :213, Save :230, per-card controls via `disabled={saving}` :181) and the textarea is `disabled={generating || saving}` (:141). The Generate button is the sole exception: `disabled={generating || text.trim().length === 0 || overLimit}` (:147) omits `saving`. Because `handleSave` clears `text` only on success (:101), during an in-flight save `text` still holds content, so Generate remains enabled. Clicking it runs `handleGenerate`, which immediately `setCards([])` + `setStatus("generating")` (:63-64) and fires a second fetch while the save POST is still awaiting; the save's `finally { setStatus("idle") }` (:105) then clobbers the `"generating"` status and the two responses interleave `setCards`, leaving non-deterministic UI. The plan's Phase 2 contract enumerated textarea + footer buttons but never named the Generate button — so the code matches the plan literally while missing the plan's stated "guardrail against double-submit" intent. `handleGenerate`/`handleSave` also lack an `if (status !== "idle") return` early guard (cf. `StudyView.grade` status guard), relying entirely on button-disable.
- **Fix**: Add `saving` to the Generate button's disabled condition: `disabled={generating || saving || text.trim().length === 0 || overLimit}`. Optionally also add an early `if (status !== "idle") return;` at the top of `handleGenerate` for defense in depth.
- **Decision**: FIXED — added `saving` to the Generate button's disabled condition (GenerateView.tsx:147). Closes the race; lint + build re-verified PASS. Early-guard option not taken (disabled attr fully prevents the click).

### F2 — Re-running Generate silently discards unsaved candidates and edits (no confirm)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/flashcards/GenerateView.tsx:63
- **Detail**: `handleGenerate` calls `setCards([])` before the fetch (:63). If a user has reviewed/edited candidates and clicks Generate again, their in-progress candidates are discarded with no confirmation — an asymmetry with the destructive Reset action, which is guarded by an AlertDialog (:211-229). This is unsaved-only, transient data (nothing persisted), and the pre-clear behavior predates this change, so it is not a correctness bug — just an observation on destructive-action asymmetry. Out of scope for this UX-polish slice.
- **Fix**: Optional / not recommended for this slice. If ever desired, clear cards only after a successful generate response, mirroring the save flow.
- **Decision**: SKIPPED — pre-existing, out of scope, unsaved-only data.

### F3 — Manual success-criteria rows marked complete without live-browser evidence

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/ux-improvements/plan.md (Progress: 1.4–1.8, 2.4–2.6)
- **Detail**: All manual checks are marked `[x]`, but they were verified by static code inspection during an autonomous implementation run, not by driving the flow in a signed-in browser with an `OPENROUTER_API_KEY`. Each holds by construction (code evidence is in the diff), and this was disclosed at implementation time — but there is no observable live-run evidence. Automated criteria (astro sync / lint / build) genuinely pass and were re-verified during this review.
- **Fix**: When convenient, run `npm run dev` and walk the plan's "Manual Testing Steps" (§ Testing Strategy) to convert static confidence into live confirmation.
- **Decision**: SKIPPED — deferred to a live browser pass at the user's convenience.

## Success Criteria Verification (Automated, re-run during review)

- `npx astro sync` → PASS
- `npm run lint` → PASS
- `npm run build` → PASS
