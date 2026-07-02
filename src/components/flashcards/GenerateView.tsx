import { useState } from "react";
import { Sparkles, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MAX_INPUT_CHARS, type Candidate, type ApiErrorCode } from "@/lib/flashcards/schemas";
import { CandidateCard, type ReviewCard } from "@/components/flashcards/CandidateCard";

/** Typed error code → friendly inline copy. */
const ERROR_COPY: Partial<Record<ApiErrorCode, string>> = {
  empty_input: "Please paste some text first.",
  too_long: `Text is too long — keep it under ${MAX_INPUT_CHARS.toLocaleString()} characters.`,
  no_cards: "The AI couldn't make usable cards from this text. Try a longer or clearer passage.",
  ai_unavailable: "AI generation is unavailable right now. Make sure OpenRouter is configured, then try again.",
  rate_limited: "Too many requests right now. Wait a moment and try again.",
  invalid_input: "Some cards are invalid — check the question and answer lengths, then try again.",
  unauthorized: "Your session expired. Please sign in again.",
  save_failed: "Couldn't save your cards. Please try again.",
};

interface JsonResponse {
  error?: ApiErrorCode;
  candidates?: Candidate[];
  saved?: number;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: JsonResponse }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as JsonResponse;
  return { ok: res.ok, data };
}

export default function GenerateView() {
  const [text, setText] = useState("");
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [status, setStatus] = useState<"idle" | "generating" | "saving">("idle");
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const trimmedLength = text.trim().length;
  const overLimit = trimmedLength > MAX_INPUT_CHARS;
  const acceptedCount = cards.filter((c) => c.status === "accepted").length;
  const pendingCount = cards.filter((c) => c.status === "pending").length;
  const generating = status === "generating";
  const saving = status === "saving";

  async function handleGenerate() {
    setError(null);
    setSavedCount(null);
    setCards([]);
    setStatus("generating");
    try {
      const { ok, data } = await postJson("/api/flashcards/generate", { text });
      if (!ok) {
        setError(data.error ?? "ai_unavailable");
        return;
      }
      setCards(
        (data.candidates ?? []).map((c) => ({
          id: crypto.randomUUID(),
          question: c.question,
          answer: c.answer,
          status: "pending",
        })),
      );
    } catch {
      setError("ai_unavailable");
    } finally {
      setStatus("idle");
    }
  }

  async function handleSave() {
    const accepted = cards.filter((c) => c.status === "accepted");
    if (accepted.length === 0) return;
    setError(null);
    setStatus("saving");
    try {
      const { ok, data } = await postJson("/api/flashcards", {
        cards: accepted.map(({ question, answer }) => ({ question, answer })),
      });
      if (!ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      setSavedCount(data.saved ?? accepted.length);
      setCards([]);
      setText("");
    } catch {
      setError("save_failed");
    } finally {
      setStatus("idle");
    }
  }

  function editCard(id: string, field: "question" | "answer", value: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  }
  function acceptCard(id: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "accepted" } : c)));
  }
  function rejectCard(id: string) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, status: "rejected" } : c)));
  }
  function acceptAll() {
    setCards((prev) => prev.map((c) => (c.status === "pending" ? { ...c, status: "accepted" } : c)));
  }
  function rejectAll() {
    setCards((prev) => prev.map((c) => (c.status === "pending" ? { ...c, status: "rejected" } : c)));
  }
  function resetSession() {
    setCards([]);
    setText("");
    setError(null);
    setSavedCount(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <textarea
          className="h-40 w-full resize-y rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-purple-300 disabled:opacity-50"
          placeholder="Paste your source text here…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          disabled={generating || saving}
        />
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={overLimit ? "text-red-300" : "text-blue-100/50"}>
            {trimmedLength.toLocaleString()} / {MAX_INPUT_CHARS.toLocaleString()}
          </span>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={generating || saving || text.trim().length === 0 || overLimit}
          >
            {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {generating ? "Generating cards…" : "Generate"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {ERROR_COPY[error]}
        </p>
      )}

      {savedCount !== null && (
        <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {savedCount} {savedCount === 1 ? "card" : "cards"} saved to your deck.
        </p>
      )}

      {generating && (
        <div className="flex flex-col items-center gap-2 py-16 text-blue-100/70">
          <Loader2 className="size-6 animate-spin" />
          <span className="text-sm">Generating cards…</span>
        </div>
      )}

      {!generating && cards.length > 0 && (
        <>
          <ul className="space-y-3">
            {cards.map((card, i) => (
              <CandidateCard
                key={card.id}
                card={card}
                index={i}
                disabled={saving}
                onEdit={editCard}
                onAccept={acceptCard}
                onReject={rejectCard}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-blue-100/60">{acceptedCount} accepted</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={acceptAll}
                disabled={pendingCount === 0 || saving}
              >
                Accept all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={rejectAll}
                disabled={pendingCount === 0 || saving}
              >
                Reject all
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" disabled={saving}>
                    Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset this review session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your unsaved candidates and edits will be discarded.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={resetSession}>Reset</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button type="button" onClick={handleSave} disabled={saving || acceptedCount === 0}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save accepted"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
