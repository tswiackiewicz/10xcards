import { adminClient } from "./auth";

/**
 * Seeds an `account_deletions` row at a controlled age, via the service-role client —
 * a normal signed-in insert always gets `now()` from the column default, so an aged row
 * can only be produced by bypassing RLS deliberately (mirrors seedUser/cleanupUser in
 * tests/helpers/auth.ts).
 */
export async function seedAccountDeletion(userId: string, ageDays: number, ageMinutesOffset = 0): Promise<void> {
  const requestedAt = new Date(Date.now() - (ageDays * 24 * 60 + ageMinutesOffset) * 60_000).toISOString();
  const { error } = await adminClient()
    .from("account_deletions")
    .insert({ user_id: userId, requested_at: requestedAt });
  if (error) {
    throw new Error(`Failed to seed account_deletions for ${userId}: ${error.message}`);
  }
}
