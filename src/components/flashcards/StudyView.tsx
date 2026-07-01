import { useState } from "react";
import { Loader2, Eye, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiErrorCode, Flashcard, GradePreview, NextCardResponse, ReviewRating } from "@/lib/flashcards/schemas";

const ERROR_COPY: Partial<Record<ApiErrorCode, string>> = {
  unauthorized: "Your session expired. Please sign in again.",
  save_failed: "Something went wrong. Please try again.",
  invalid_rating: "Something went wrong grading that card. Please try again.",
};

/** Grade buttons in order, with label + color. Rating values match the FSRS grades (1..4). */
const GRADE_META: { rating: ReviewRating; text: string; className: string }[] = [
  { rating: 1, text: "Again", className: "border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20" },
  {
    rating: 2,
    text: "Hard",
    className: "border-orange-400/40 bg-orange-500/10 text-orange-100 hover:bg-orange-500/20",
  },
  { rating: 3, text: "Good", className: "border-blue-400/40 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20" },
  { rating: 4, text: "Easy", className: "border-green-400/40 bg-green-500/10 text-green-100 hover:bg-green-500/20" },
];

function labelFor(previews: GradePreview[] | null, rating: ReviewRating): string | null {
  return previews?.find((p) => p.rating === rating)?.label ?? null;
}

interface StudyViewProps {
  initialCard: Flashcard | null;
  initialPreviews: GradePreview[] | null;
}

export default function StudyView({ initialCard, initialPreviews }: StudyViewProps) {
  const [card, setCard] = useState<Flashcard | null>(initialCard);
  const [previews, setPreviews] = useState<GradePreview[] | null>(initialPreviews);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("ready");
  const [error, setError] = useState<ApiErrorCode | null>(null);

  // Fetch the next card after a grade (or a retry). The first card is server-loaded via
  // props, so there is no mount-time fetch. Callers set "loading" before awaiting this.
  async function loadNext() {
    try {
      const res = await fetch("/api/flashcards/study/next");
      const data = (await res.json().catch(() => ({}))) as NextCardResponse & { error?: ApiErrorCode };
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        setStatus("error");
        return;
      }
      setRevealed(false);
      setError(null);
      setCard(data.card);
      setPreviews(data.previews);
      setStatus("ready");
    } catch {
      setError("save_failed");
      setStatus("error");
    }
  }

  function retry() {
    setStatus("loading");
    void loadNext();
  }

  async function grade(rating: ReviewRating) {
    if (!card) return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/flashcards/${card.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      // A 404 means the card was deleted elsewhere — just advance to the next one.
      if (!res.ok && res.status !== 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
        setError(data.error ?? "save_failed");
        setStatus("error");
        return;
      }
      await loadNext();
    } catch {
      setError("save_failed");
      setStatus("error");
    }
  }

  if (status === "loading") {
    return (
      <div className="flex justify-center py-16 text-blue-100/70">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-200">{error ? ERROR_COPY[error] : "Something went wrong."}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <PartyPopper className="mx-auto mb-3 size-8 text-purple-200" />
        <p className="text-sm text-blue-100/80">All caught up — no cards are due right now.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <a
            href="/cards"
            className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            My flashcards
          </a>
          <a
            href="/dashboard"
            className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-1 text-xs tracking-wide text-blue-100/50 uppercase">Question</div>
      <p className="text-lg whitespace-pre-wrap text-white">{card.question}</p>

      {revealed ? (
        <>
          <div className="mt-5 mb-1 text-xs tracking-wide text-blue-100/50 uppercase">Answer</div>
          <p className="text-base whitespace-pre-wrap text-blue-100/90">{card.answer}</p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {GRADE_META.map(({ rating, text, className }) => {
              const label = labelFor(previews, rating);
              return (
                <button
                  key={rating}
                  type="button"
                  onClick={() => {
                    void grade(rating);
                  }}
                  className={`flex flex-col items-center rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${className}`}
                >
                  <span className="font-medium">{text}</span>
                  {label && <span className="text-xs opacity-70">{label}</span>}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            onClick={() => {
              setRevealed(true);
            }}
          >
            <Eye className="size-4" />
            Show answer
          </Button>
        </div>
      )}
    </div>
  );
}
