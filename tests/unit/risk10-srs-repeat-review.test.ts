// Risk #10 — a card studied more than once must schedule its next review from the prior
// review's outcome, not first-time defaults. Proves applyGrade genuinely carries forward
// state across calls: reps is ts-fsrs's per-review counter, so a fresh card graded once
// always yields reps: 1 — reps: 2 on the second call is only reachable if the prior
// state was correctly reloaded and fed back in, the strongest direct discriminator
// between "repeat review" and "treated as first-time."
import { describe, expect, it } from "vitest";
import { applyGrade, type SrsColumns } from "@/lib/flashcards/srs";

const NEVER_STUDIED: SrsColumns = {
  due: null,
  stability: null,
  difficulty: null,
  scheduled_days: null,
  learning_steps: null,
  reps: null,
  lapses: null,
  state: null,
  last_review: null,
};

describe("Risk #10 — applyGrade carries forward prior state on a repeat grade", () => {
  it("a second grade's reps reflects the first review's outcome, not a first-time default", () => {
    const firstNow = new Date("2026-01-01T00:00:00.000Z");
    const afterFirstReview = applyGrade(NEVER_STUDIED, 3, firstNow);
    expect(afterFirstReview.reps).toBe(1);

    const secondNow = new Date("2026-01-05T00:00:00.000Z");
    const afterSecondReview = applyGrade(afterFirstReview, 3, secondNow);
    expect(afterSecondReview.reps).toBe(2);
  });
});
