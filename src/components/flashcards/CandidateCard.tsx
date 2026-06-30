import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ReviewCard {
  id: string;
  question: string;
  answer: string;
  status: "pending" | "accepted" | "rejected";
}

interface Props {
  card: ReviewCard;
  index: number;
  onEdit: (id: string, field: "question" | "answer", value: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

export function CandidateCard({ card, index, onEdit, onAccept, onReject }: Props) {
  const tone =
    card.status === "accepted"
      ? "border-emerald-400/60 bg-emerald-400/10"
      : card.status === "rejected"
        ? "border-white/5 bg-white/5 opacity-50"
        : "border-white/10 bg-white/5";

  return (
    <li className={`rounded-xl border p-4 transition-colors ${tone}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-blue-100/60">Card {index + 1}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={card.status === "accepted" ? "default" : "outline"}
            onClick={() => {
              onAccept(card.id);
            }}
          >
            <Check className="size-4" /> Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant={card.status === "rejected" ? "destructive" : "outline"}
            onClick={() => {
              onReject(card.id);
            }}
          >
            <X className="size-4" /> Reject
          </Button>
        </div>
      </div>

      <label className="mb-1 block text-xs text-blue-100/60">Question</label>
      <textarea
        className="mb-3 w-full resize-y rounded-md border border-white/10 bg-white/5 p-2 text-sm text-white outline-none focus:border-purple-300"
        rows={2}
        value={card.question}
        onChange={(e) => {
          onEdit(card.id, "question", e.target.value);
        }}
      />

      <label className="mb-1 block text-xs text-blue-100/60">Answer</label>
      <textarea
        className="w-full resize-y rounded-md border border-white/10 bg-white/5 p-2 text-sm text-white outline-none focus:border-purple-300"
        rows={3}
        value={card.answer}
        onChange={(e) => {
          onEdit(card.id, "answer", e.target.value);
        }}
      />
    </li>
  );
}
