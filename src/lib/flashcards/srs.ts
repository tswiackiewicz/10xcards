import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";
import type { Flashcard } from "@/lib/flashcards/schemas";

/**
 * S-04 spaced-repetition scheduling, isolated behind a thin ts-fsrs wrapper.
 *
 * ts-fsrs works in `Date`; Postgres hands us ISO strings. All conversion happens here
 * so the endpoints and UI never juggle `Date` vs string. Uses library-default FSRS-6
 * parameters (request_retention 0.9, fuzz on) — no per-user tuning in the MVP.
 */
const scheduler = fsrs();

/** The persisted FSRS state subset of a flashcard row (all nullable — NULL `due` = never studied). */
export type SrsColumns = Pick<
  Flashcard,
  "due" | "stability" | "difficulty" | "scheduled_days" | "learning_steps" | "reps" | "lapses" | "state" | "last_review"
>;

/** A rating as it arrives from the client: 1=Again, 2=Hard, 3=Good, 4=Easy (FSRS grades, Manual excluded). */
export type ReviewRating = 1 | 2 | 3 | 4;

/** The four gradable ratings, in button order. */
const RATINGS: readonly ReviewRating[] = [1, 2, 3, 4];

/** Maps the wire rating to the ts-fsrs `Rating` grade (the four values form exactly `Grade`). */
const GRADE_BY_RATING = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
} as const;

/** Interval hint per grade, for the study UI's four buttons. */
export interface GradePreview {
  rating: ReviewRating;
  label: string;
}

/** Build a ts-fsrs `Card` from a stored row, or a fresh card when the row was never studied (NULL `due`). */
function rowToCard(row: SrsColumns): Card {
  if (row.due === null) {
    return createEmptyCard();
  }
  return {
    due: new Date(row.due),
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: 0, // deprecated + recomputed by the scheduler; not persisted
    scheduled_days: row.scheduled_days ?? 0,
    learning_steps: row.learning_steps ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    state: row.state ?? State.New,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Human interval label (e.g. "10m", "2h", "8d") from now to a future due date. */
function formatInterval(from: Date, to: Date): string {
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/** The four grade options with their next-interval hints, for the reveal step of a study session. */
export function previewGrades(row: SrsColumns, now: Date): GradePreview[] {
  const card = rowToCard(row);
  const preview = scheduler.repeat(card, now);
  return RATINGS.map((rating) => ({
    rating,
    label: formatInterval(now, preview[GRADE_BY_RATING[rating]].card.due),
  }));
}

/**
 * Apply a grade and return column-ready FSRS state to persist. Handles lazy init: a
 * never-studied row is graded from a fresh card, so first-study and review share this path.
 */
export function applyGrade(row: SrsColumns, rating: ReviewRating, now: Date): SrsColumns {
  const card = rowToCard(row);
  return scheduler.next(card, now, GRADE_BY_RATING[rating], ({ card: next }) => ({
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    scheduled_days: next.scheduled_days,
    learning_steps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    last_review: next.last_review ? next.last_review.toISOString() : null,
  }));
}
