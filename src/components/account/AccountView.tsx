import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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

interface Props {
  pending: boolean;
  requestedAt: string | null;
  email: string | null;
}

const RETENTION_DAYS = 30;

async function postJson(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
  return res.ok;
}

function purgeDate(requestedAt: string): string {
  const d = new Date(new Date(requestedAt).getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function AccountView({ pending, requestedAt, email }: Props) {
  const confirmPhrase = email ?? "DELETE";
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const canConfirm = confirmText.trim() === confirmPhrase && !busy;

  async function handleDelete() {
    setBusy(true);
    setError(false);
    const ok = await postJson("/api/account/delete");
    if (ok) {
      window.location.href = "/auth/signin";
    } else {
      setError(true);
      setBusy(false);
    }
  }

  async function handleReactivate() {
    setBusy(true);
    setError(false);
    const ok = await postJson("/api/account/reactivate");
    if (ok) {
      window.location.href = "/dashboard";
    } else {
      setError(true);
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="h-5 w-5" /> Account scheduled for deletion
        </h2>
        <p className="text-sm">
          Your account and all your flashcards are scheduled to be permanently deleted on{" "}
          <span className="font-semibold">{requestedAt ? purgeDate(requestedAt) : "soon"}</span>. Until then your data
          is hidden but recoverable. Reactivate to restore full access.
        </p>
        {error && <p className="text-destructive mt-3 text-sm">Something went wrong. Please try again.</p>}
        <Button type="button" className="mt-4" onClick={handleReactivate} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Reactivate account
        </Button>
      </div>
    );
  }

  return (
    <div className="border-destructive/40 bg-destructive/10 rounded-xl border p-6">
      <h2 className="text-destructive mb-2 flex items-center gap-2 text-lg font-semibold">
        <ShieldAlert className="h-5 w-5" /> Danger zone
      </h2>
      <p className="text-muted-foreground text-sm">
        Delete your account. Your flashcards are hidden immediately and permanently erased after {RETENTION_DAYS} days.
        You can restore everything by signing in and reactivating before then.
      </p>
      {error && <p className="text-destructive mt-3 text-sm">Something went wrong. Please try again.</p>}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" className="mt-4">
            Delete my account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This hides your flashcards immediately and signs you out. After {RETENTION_DAYS} days everything is
              permanently erased. Type <span className="font-semibold">{confirmPhrase}</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            autoComplete="off"
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
            }}
            placeholder={confirmPhrase}
            className="border-input bg-background text-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConfirmText("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction disabled={!canConfirm} onClick={handleDelete}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
