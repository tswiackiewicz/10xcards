import { z } from "zod";

/** Hard caps shared by the app layer and mirrored against the DB CHECK constraints. */
export const MAX_INPUT_CHARS = 10000;
export const MAX_CARDS = 15;

/** Per-card length caps mirror the `flashcards` table CHECK constraints (F-01). */
const QUESTION_MAX = 1000;
const ANSWER_MAX = 2000;

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

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type SaveRequest = z.infer<typeof saveRequestSchema>;

/** Typed error codes returned by the flashcard endpoints and mapped to UI copy. */
export type ApiErrorCode =
  | "empty_input"
  | "too_long"
  | "no_cards"
  | "ai_unavailable"
  | "rate_limited"
  | "invalid_input"
  | "unauthorized"
  | "save_failed";
