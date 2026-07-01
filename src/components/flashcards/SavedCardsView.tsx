import { useState } from "react";
import { Sparkles, PenLine } from "lucide-react";
import type { Flashcard } from "@/lib/flashcards/schemas";

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

function SavedCard({ card }: { card: Flashcard }) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs tracking-wide text-blue-100/50 uppercase">Question</span>
        <SourceBadge source={card.source} />
      </div>
      <p className="text-sm whitespace-pre-wrap text-white">{card.question}</p>
      <div className="mt-3 mb-1 text-xs tracking-wide text-blue-100/50 uppercase">Answer</div>
      <p className="text-sm whitespace-pre-wrap text-blue-100/80">{card.answer}</p>
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
  const [deck] = useState<Flashcard[]>(cards);

  if (deck.length === 0) {
    return <EmptyState />;
  }

  return (
    <ul className="space-y-3">
      {deck.map((card) => (
        <SavedCard key={card.id} card={card} />
      ))}
    </ul>
  );
}
