import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QUESTION_MAX, ANSWER_MAX, type ApiErrorCode } from "@/lib/flashcards/schemas";

/** Typed error code → friendly inline copy (only the codes this endpoint returns). */
const ERROR_COPY: Partial<Record<ApiErrorCode, string>> = {
  invalid_input: "Check the question and answer — both are required and within the length limits.",
  unauthorized: "Your session expired. Please sign in again.",
  save_failed: "Couldn't save your card. Please try again.",
};

interface JsonResponse {
  error?: ApiErrorCode;
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

const fieldClass =
  "w-full resize-y rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-purple-300 disabled:opacity-50";

export default function ManualCardForm() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [saved, setSaved] = useState(false);

  const saving = status === "saving";
  const qLen = question.trim().length;
  const aLen = answer.trim().length;
  const qOver = qLen > QUESTION_MAX;
  const aOver = aLen > ANSWER_MAX;
  const canSave = qLen > 0 && aLen > 0 && !qOver && !aOver && !saving;

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    setSaved(false);
    setStatus("saving");
    try {
      const { ok, data } = await postJson("/api/flashcards/manual", { question, answer });
      if (!ok) {
        setError(data.error ?? "save_failed");
        return;
      }
      setSaved(true);
      setQuestion("");
      setAnswer("");
    } catch {
      setError("save_failed");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-blue-100/70">Question</label>
        <textarea
          className={`h-24 ${fieldClass}`}
          placeholder="e.g. What does RLS stand for?"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSaved(false);
          }}
          disabled={saving}
        />
        <div className="mt-1 text-right text-xs">
          <span className={qOver ? "text-red-300" : "text-blue-100/50"}>
            {qLen.toLocaleString()} / {QUESTION_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-blue-100/70">Answer</label>
        <textarea
          className={`h-32 ${fieldClass}`}
          placeholder="e.g. Row-Level Security."
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setSaved(false);
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
        <p className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {ERROR_COPY[error]}
        </p>
      )}

      {saved && (
        <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Card saved to your deck.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving…" : "Save card"}
        </Button>
      </div>
    </div>
  );
}
