import { useState } from "react";
import { Sparkles, PenLine, Pencil, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QUESTION_MAX, ANSWER_MAX, type Flashcard, type ApiErrorCode } from "@/lib/flashcards/schemas";

/** Typed error code → friendly inline copy (only the codes the [id] endpoint returns). */
const ERROR_COPY: Partial<Record<ApiErrorCode, string>> = {
  invalid_input: "Check the question and answer — both are required and within the length limits.",
  unauthorized: "Your session expired. Please sign in again.",
  not_found: "This card no longer exists. Refresh the page.",
  save_failed: "Couldn't save your changes. Please try again.",
};

const fieldClass =
  "w-full resize-y rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-purple-300 disabled:opacity-50";

function SourceBadge({ source }: { source: string }) {
  const isAi = source === "ai";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        isAi
          ? "border-purple-300/40 bg-purple-400/10 text-purple-100"
          : "border-blue-300/40 bg-blue-400/10 text-blue-100"
      }`}
    >
      {isAi ? <Sparkles className="size-3" /> : <PenLine className="size-3" />}
      {isAi ? "AI" : "Manual"}
    </span>
  );
}

/** Freshly mounted per edit, so its draft state seeds from the current card each time. */
function CardEditor({
  card,
  onCancel,
  onSaved,
}: {
  card: Flashcard;
  onCancel: () => void;
  onSaved: (question: string, answer: string) => void;
}) {
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const saving = status === "saving";
  const qLen = question.trim().length;
  const aLen = answer.trim().length;
  const qOver = qLen > QUESTION_MAX;
  const aOver = aLen > ANSWER_MAX;
  const canSave = qLen > 0 && aLen > 0 && !qOver && !aOver && !saving;

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    setStatus("saving");
    try {
      const res = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: ApiErrorCode };
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      onSaved(question, answer);
    } catch {
      setError("save_failed");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div>
        <label className="mb-1 block text-sm text-blue-100/70">Question</label>
        <textarea
          className={`h-24 ${fieldClass}`}
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          disabled={saving}
        />
        <div className="mt-1 text-right text-xs">
          <span className={qOver ? "text-red-300" : "text-blue-100/50"}>
            {qLen.toLocaleString()} / {QUESTION_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm text-blue-100/70">Answer</label>
        <textarea
          className={`h-32 ${fieldClass}`}
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
          }}
          disabled={saving}
        />
        <div className="mt-1 text-right text-xs">
          <span className={aOver ? "text-red-300" : "text-blue-100/50"}>
            {aLen.toLocaleString()} / {ANSWER_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {ERROR_COPY[error]}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          <X className="size-4" />
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </li>
  );
}

function SavedCard({ card, onStartEdit }: { card: Flashcard; onStartEdit: () => void }) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs tracking-wide text-blue-100/50 uppercase">Question</span>
        <SourceBadge source={card.source} />
      </div>
      <p className="text-sm whitespace-pre-wrap text-white">{card.question}</p>
      <div className="mt-3 mb-1 text-xs tracking-wide text-blue-100/50 uppercase">Answer</div>
      <p className="text-sm whitespace-pre-wrap text-blue-100/80">{card.answer}</p>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" onClick={onStartEdit}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
      <p className="text-sm text-blue-100/80">You don&apos;t have any flashcards yet.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        <a
          href="/generate"
          className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          Generate flashcards
        </a>
        <a
          href="/create"
          className="inline-block rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
        >
          Create flashcard
        </a>
      </div>
    </div>
  );
}

export default function SavedCardsView({ cards }: { cards: Flashcard[] }) {
  const [deck, setDeck] = useState<Flashcard[]>(cards);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (deck.length === 0) {
    return <EmptyState />;
  }

  function handleSaved(id: string, question: string, answer: string) {
    setDeck((prev) => prev.map((c) => (c.id === id ? { ...c, question, answer } : c)));
    setEditingId(null);
  }

  return (
    <ul className="space-y-3">
      {deck.map((card) =>
        card.id === editingId ? (
          <CardEditor
            key={card.id}
            card={card}
            onCancel={() => {
              setEditingId(null);
            }}
            onSaved={(q, a) => {
              handleSaved(card.id, q, a);
            }}
          />
        ) : (
          <SavedCard
            key={card.id}
            card={card}
            onStartEdit={() => {
              setEditingId(card.id);
            }}
          />
        ),
      )}
    </ul>
  );
}
