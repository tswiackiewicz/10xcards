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
  disabled?: boolean;
  onEdit: (id: string, field: "question" | "answer", value: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

export function CandidateCard({ card, index, disabled, onEdit, onAccept, onReject }: Props) {
  const tone =
    card.status === "accepted"
      ? "border-primary/40 bg-primary/10"
      : card.status === "rejected"
        ? "border-border bg-muted opacity-50"
        : "border-border bg-card";

  return (
    <li className={`rounded-xl border p-4 transition-colors ${tone}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium">Card {index + 1}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={card.status === "accepted" ? "default" : "outline"}
            disabled={disabled}
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
            disabled={disabled}
            onClick={() => {
              onReject(card.id);
            }}
          >
            <X className="size-4" /> Reject
          </Button>
        </div>
      </div>

      <label className="text-muted-foreground mb-1 block text-xs">Question</label>
      <textarea
        className="border-input text-foreground focus:border-ring mb-3 w-full resize-y rounded-md border bg-transparent p-2 text-sm outline-none disabled:opacity-50"
        rows={2}
        value={card.question}
        disabled={disabled}
        onChange={(e) => {
          onEdit(card.id, "question", e.target.value);
        }}
      />

      <label className="text-muted-foreground mb-1 block text-xs">Answer</label>
      <textarea
        className="border-input text-foreground focus:border-ring w-full resize-y rounded-md border bg-transparent p-2 text-sm outline-none disabled:opacity-50"
        rows={3}
        value={card.answer}
        disabled={disabled}
        onChange={(e) => {
          onEdit(card.id, "answer", e.target.value);
        }}
      />
    </li>
  );
}
