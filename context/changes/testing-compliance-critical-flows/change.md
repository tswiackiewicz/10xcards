---
change_id: testing-compliance-critical-flows
title: Test the account-deletion retention boundary and AI-error data hygiene
status: impl_reviewed
created: 2026-07-07
updated: 2026-07-07
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Compliance-critical flows".
Risks covered: #4, #6. Test types planned: integration.
Risk response intent:

- Risk #4: prove a soft-deleted account is denied sign-in immediately; its data is unreachable but not yet erased before day 30; it is fully erased at/after day 30 — no state where data is both accessible and "deleted". Must challenge: "the purge route runs" != "it runs on the correct schedule in production" — the boundary condition matters more than a single successful call.
- Risk #6: prove an error response from the AI-generation endpoint (validation failure, provider error, timeout) never includes the raw source text or provider request/response internals. Must challenge: "the happy path returns a generic message" doesn't cover every error branch — each branch must be checked individually.
  After creating the folder, follow the downstream continuation rule (proceed to /10x-research without waiting for a return to /10x-test-plan).
