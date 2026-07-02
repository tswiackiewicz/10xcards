import type { APIRoute } from "astro";
import { CRON_PURGE_SECRET } from "astro:env/server";
import { createAdminClient } from "@/lib/supabase-admin";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time string compare — avoids leaking the secret via response timing.
// Length is compared first (unavoidable early-out), then every byte is XOR-accumulated.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// S-05 Phase 3: permanently erase accounts past the 30-day retention window.
// Bearer-guarded (GitHub Actions cron posts the shared secret). Idempotent — a run
// with nothing eligible deletes nothing. Bounded batch per invocation keeps us under
// the Workers free-tier 50-subrequest cap; the daily cadence drains any backlog.
const RETENTION_DAYS = 30;
const BATCH = 40;

export const POST: APIRoute = async (context) => {
  const auth = context.request.headers.get("authorization") ?? "";
  const expected = `Bearer ${CRON_PURGE_SECRET ?? ""}`;
  // Reject when the secret is unconfigured (expected has an empty token → no valid
  // bearer can match) or the header doesn't match.
  if (!CRON_PURGE_SECRET || !safeEqual(auth, expected)) {
    return json(401, { error: "unauthorized" });
  }

  const admin = createAdminClient();
  if (!admin) {
    return json(503, { error: "service_unavailable" });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, count, error } = await admin
    .from("account_deletions")
    .select("user_id", { count: "exact" })
    .lt("requested_at", cutoff)
    .order("requested_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    // eslint-disable-next-line no-console -- Workers Logs: a silent failure retains data past the promised window (GDPR).
    console.error(JSON.stringify({ event: "account_purge", ok: false, error: error.message }));
    return json(500, { error: "purge_failed" });
  }

  const eligible = count ?? data.length;
  let deleted = 0;
  let errors = 0;
  for (const row of data) {
    // The on-delete-cascade FKs erase the user's flashcards and their
    // account_deletions row automatically.
    const { error: delErr } = await admin.auth.admin.deleteUser(row.user_id);
    if (delErr) errors++;
    else deleted++;
  }
  const skipped = Math.max(0, eligible - data.length);

  // eslint-disable-next-line no-console -- Workers Logs: explicit success/failure line is a GDPR safeguard.
  console.log(JSON.stringify({ event: "account_purge", ok: errors === 0, eligible, deleted, skipped, errors }));

  return json(200, { deleted, skipped });
};
