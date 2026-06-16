---
project: "10xCards"
version: 1
status: draft
created: 2026-06-13
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Manually authoring high-quality study flashcards is slow and tedious. A self-directed
learner who wants to use spaced repetition has to break source material into good
question/answer pairs by hand before they can study at all — this workflow friction
eats the time that should go into learning, and often discourages people from adopting
spaced repetition in the first place.

The insight: AI can drive the cost of creating a flashcard close to zero by generating
candidate cards from text the learner already has (copy-paste). Existing tools either
have a strong scheduling algorithm but no generation, or generic AI with no study loop —
rarely both in one simple package. Removing the authoring friction is what makes adopting
spaced repetition realistic for a busy self-learner.

## User & Persona

**Primary persona — the self-directed learner.** A single named user (the builder
themselves is the archetype): someone learning a subject for their own goals, managing
their own study, with no team or instructor in the loop. They reach for this product at
the moment they have source material (notes, an article, a chapter) and want to turn it
into a studyable deck without spending an evening writing cards by hand.

## Success Criteria

### Primary
- The end-to-end flow works: a user pastes text, AI proposes flashcards, the user
  reviews (accept / edit / reject), accepted cards land in their deck, and they can
  study the deck through a spaced-repetition schedule.
- At least 75% of AI-generated flashcards are accepted by the user.
- At least 75% of all flashcards created in the product are created with AI assistance
  (vs. fully manual authoring).

### Secondary
- Users return on later days to keep studying — a signal that the spaced-repetition loop
  is delivering value, not just one-off card generation.

### Guardrails
- No flashcard a user has saved is ever lost, and no flashcard is ever visible to another
  user. Failure here is a regression even if generation works perfectly.
- No AI-generated flashcard enters a user's deck without explicit acceptance — the user
  always controls what content is saved; there is no silent auto-save.

## User Stories

### US-01: User turns pasted text into a studyable deck

- **Given** a signed-in user who has source text (notes, an article, a chapter)
- **When** they paste the text and request flashcard generation, then review the proposals
- **Then** they accept, edit, or reject each candidate, and accepted cards are saved to
  their deck and become available to study

#### Acceptance Criteria
- Each AI candidate can be individually accepted, edited before accepting, or rejected.
- Only explicitly accepted cards are persisted; rejected candidates leave no trace in the deck.
- After acceptance, the saved cards are immediately visible in the user's flashcard list.
- Empty or unusable input produces an explanatory message, not an empty/failed result.

## Functional Requirements

### Account
- FR-001: User can create an account with email + password. Priority: must-have
  > Socratic: Counter-argument considered: "auth before first value discourages trial;
  > passwords add security burden." Resolution: kept; accounts are required to store decks
  > per user, and email+password is the simplest model that does that.
- FR-002: User can sign in and sign out. Priority: must-have
  > Socratic: Counter-argument considered: "trivial; fold into FR-001." Resolution: kept;
  > explicit session in/out is what enforces per-user data isolation.

### AI generation
- FR-003: User can paste source text and request AI-generated flashcard candidates. Priority: must-have
  > Socratic: Counter-argument considered: "long inputs are slow/costly — input size may
  > need a cap." Resolution: kept, but an input-size/cost limit for the MVP is unresolved —
  > routed to Open Questions (Q1).
- FR-004: User can review each AI candidate and accept, edit, or reject it. Priority: must-have
  > Socratic: Counter-argument considered: "auto-accept everything would be faster."
  > Resolution: kept; review is what realizes the user-control guardrail and the 75%
  > acceptance metric.

### Manual authoring & management
- FR-005: User can create a flashcard manually. Priority: must-have
  > Socratic: Counter-argument considered: "dilutes the AI focus / works against the
  > 75%-via-AI metric." Resolution: kept; it is the fallback when AI output doesn't fit,
  > and the source notes list it in the minimum scope.
- FR-006: User can view their saved flashcards. Priority: must-have
  > Socratic: Counter-argument considered: "trivial CRUD." Resolution: kept; without a list
  > there is no way to edit, delete, or confirm what AI saved.
- FR-007: User can edit a saved flashcard. Priority: must-have
  > Socratic: Counter-argument considered: "edit-on-review (FR-004) makes post-save edit
  > redundant." Resolution: kept; cards are long-lived and need correction after saving.
- FR-008: User can delete a saved flashcard. Priority: must-have
  > Socratic: Counter-argument considered: "deletion risks the no-loss guardrail."
  > Resolution: kept; the user must be able to remove stale cards — guardrail addresses
  > accidental/cross-user loss, not intentional deletion.

### Study
- FR-009: User can study a deck through a spaced-repetition schedule. Priority: must-have
  > Socratic: Counter-argument considered: "MVP could prove value without SRS; add it in v2."
  > Resolution: kept; without the spaced-repetition loop the product is only a card
  > generator — SRS is the point of the product and drives the retention metric.

## Non-Functional Requirements

- Any operation that takes longer than ~2 seconds (notably AI generation) shows continuous
  visible progress; the user always sees acknowledgement that work is happening, never an
  apparently frozen screen.
- Source text submitted for flashcard generation is handled in line with GDPR: it is never
  exposed to other users and is not used beyond serving the user's own request.
- A flashcard the user has confirmed survives sessions and restarts; no confirmed user data
  is silently lost.
- The product remains usable on the latest two major versions of the mainstream desktop
  browsers.

## Business Logic

Given a block of source text supplied by the user, the product produces a set of
self-contained question/answer pairs suitable for spaced-repetition study — decomposing
the material into flashcards so that each card tests a single fact.

The rule consumes one user-facing input: free-form source text the learner already has
(notes, an article, a chapter). Its output is a set of candidate flashcards, each a
discrete question paired with its answer. The user encounters the output as a review
queue: candidates are presented for accept / edit / reject, and only accepted cards
become part of the studyable deck. A separate spaced-repetition rule then orders accepted
cards over time, deciding which card a user sees next based on their prior recall — so the
product decides both *what* to study (the generated cards) and *when* to study each one.

## Access Control

Multi-user with email + password sign-in. Flat user model — exactly one role. Every
authenticated user can see and manage only their own flashcards; there is no admin role
and no cross-user visibility. Unauthenticated access to flashcard data is not permitted;
gated routes redirect to sign-in. This is the smallest access model that still lets the
product store decks per user and serve them across sessions/devices.

## Non-Goals

- **No custom spaced-repetition algorithm.** The MVP integrates a ready-made SRS algorithm
  rather than building its own (no SuperMemo/Anki-style engine) — a deliberate buy-not-build
  decision to keep scope to three weeks.
- **No multi-format import.** Only pasted text is accepted; no PDF/DOCX/file parsing in the MVP.
- **No deck sharing between users.** Single-tenant by design — no shared or team decks.
- **No mobile apps.** Web only for the first version; no native mobile clients.
- **No integrations with other educational platforms.** The MVP is standalone; no LMS or
  third-party learning-platform integrations.

## Open Questions

1. **What is the input-size / cost limit for AI generation in the MVP?** — Owner: user.
   Surfaced during the Socratic round on FR-003: long pasted texts may be slow or costly,
   so the MVP likely needs a cap on input length (and/or generated-card count). Resolution
   deferred; not blocking the PRD, to be decided before/at implementation.
