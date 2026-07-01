import { z } from "zod";
import type { Database } from "@/db/database.types";

/** Hard caps shared by the app layer and mirrored against the DB CHECK constraints. */
export const MAX_INPUT_CHARS = 10000;
export const MAX_CARDS = 15;

/** Per-card length caps mirror the `flashcards` table CHECK constraints (F-01). */
export const QUESTION_MAX = 1000;
export const ANSWER_MAX = 2000;

/** Inbound body for POST /api/flashcards/generate. */
export const generateRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_INPUT_CHARS),
});

/** A single AI-proposed (or user-edited) flashcard candidate. */
export const candidateSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});

/** Inbound body for POST /api/flashcards (the accepted set). */
export const saveRequestSchema = z.object({
  cards: z.array(candidateSchema).min(1).max(MAX_CARDS),
});

/** Inbound body for POST /api/flashcards/manual (a single hand-authored card). */
export const manualCardSchema = candidateSchema;

/** Inbound body for PATCH /api/flashcards/[id]/review — an FSRS grade (1=Again … 4=Easy). */
export const reviewSchema = z.object({
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type SaveRequest = z.infer<typeof saveRequestSchema>;
export type ManualCardRequest = z.infer<typeof manualCardSchema>;
export type ReviewRequest = z.infer<typeof reviewSchema>;

/** A single FSRS grade as it travels over the wire: 1=Again, 2=Hard, 3=Good, 4=Easy. */
export type ReviewRating = ReviewRequest["rating"];

/** A saved flashcard row as stored in the `flashcards` table. */
export type Flashcard = Database["public"]["Tables"]["flashcards"]["Row"];

/** Interval hint for one grade button in the study UI (e.g. rating 3 → "10m"). */
export interface GradePreview {
  rating: ReviewRating;
  label: string;
}

/** Response of GET /api/flashcards/study/next. `card: null` means the deck is all caught up. */
export interface NextCardResponse {
  card: Flashcard | null;
  previews: GradePreview[] | null;
}

/** Typed error codes returned by the flashcard endpoints and mapped to UI copy. */
export type ApiErrorCode =
  | "empty_input"
  | "too_long"
  | "no_cards"
  | "ai_unavailable"
  | "rate_limited"
  | "invalid_input"
  | "unauthorized"
  | "save_failed"
  | "not_found"
  | "invalid_rating";
