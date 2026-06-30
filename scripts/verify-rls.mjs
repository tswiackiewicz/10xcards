/* eslint-disable no-console -- standalone CLI verification script; console is its output */
// F-01 RLS isolation proof — the launch-gate evidence for the flashcards store.
//
// Exercises the REAL runtime path (anon key + a user's JWT) to prove that one user
// cannot see or mutate another user's flashcards, and that a signed-out client sees
// nothing. The service-role key is used ONLY to seed/clean up users — never for the
// isolation assertions, because it bypasses RLS and would falsely pass.
//
// Run with the local credentials from `npx supabase status -o env`:
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/verify-rls.mjs
//
// Exits 0 only if every assertion holds; non-zero with a clear message otherwise.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env. Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY\n" +
      "(all printed by `npx supabase status -o env`).",
  );
  process.exit(2);
}

let passed = 0;
function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

// Service-role client — seeding/cleanup only, NEVER for isolation checks.
const admin = createClient(URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A fresh anon-key client (one per identity / per signed-out check).
function anonClient() {
  return createClient(URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userA = { email: `rls-a-${suffix}@example.com`, password: "Password123!", id: null };
const userB = { email: `rls-b-${suffix}@example.com`, password: "Password123!", id: null };

async function seedUser(u) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to seed ${u.email}: ${error.message}`);
  u.id = data.user.id;
}

async function signIn(u) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error(`Sign-in failed for ${u.email}: ${error.message}`);
  return client;
}

async function main() {
  console.log("RLS isolation verification — flashcards\n");

  // 1. Seed two confirmed users (service-role / admin).
  await seedUser(userA);
  await seedUser(userB);
  console.log(`Seeded users A=${userA.id} B=${userB.id}\n`);

  // 2. Sign in as each (anon key + that user's JWT).
  const asA = await signIn(userA);
  const asB = await signIn(userB);

  // 3. A inserts a card (own user_id) — must succeed.
  const insA = await asA
    .from("flashcards")
    .insert({ user_id: userA.id, question: "A question", answer: "A answer", source: "manual" })
    .select()
    .single();
  assert(!insA.error && insA.data?.id, "A can insert a card it owns");
  const cardId = insA.data.id;

  // 4. B cannot see A's card.
  const selB = await asB.from("flashcards").select("*");
  assert(!selB.error, "B select query itself succeeds (no permission error)");
  assert(
    Array.isArray(selB.data) && selB.data.every((r) => r.id !== cardId),
    "B does not see A's card in its result set",
  );
  assert(selB.data.length === 0, "B sees zero flashcards (owns none)");

  // 5. B cannot update A's card (RLS hides the row → 0 rows affected).
  const updB = await asB
    .from("flashcards")
    .update({ answer: "hacked by B" })
    .eq("id", cardId)
    .select();
  assert(!updB.error && Array.isArray(updB.data) && updB.data.length === 0, "B's update of A's card affects 0 rows");

  // 6. B cannot delete A's card (0 rows affected).
  const delB = await asB.from("flashcards").delete().eq("id", cardId).select();
  assert(!delB.error && Array.isArray(delB.data) && delB.data.length === 0, "B's delete of A's card affects 0 rows");

  // 7. B cannot insert a card stamped with A's user_id (INSERT WITH CHECK rejects it).
  const insBasA = await asB
    .from("flashcards")
    .insert({ user_id: userA.id, question: "spoofed", answer: "spoofed" })
    .select();
  assert(!!insBasA.error, "B cannot insert a card owned by A (WITH CHECK rejects it)");

  // 8. A signed-OUT (anon role) client reads zero cards — unauthenticated access denied.
  const anon = anonClient();
  const selAnon = await anon.from("flashcards").select("*");
  assert(
    (selAnon.data?.length ?? 0) === 0,
    "Unauthenticated (anon) client reads zero flashcards",
  );

  // 9. A's card is still intact and unchanged after B's and anon's attempts.
  const reA = await asA.from("flashcards").select("*").eq("id", cardId).single();
  assert(!reA.error && reA.data?.id === cardId, "A's card still exists");
  assert(reA.data.answer === "A answer", "A's card answer is unchanged");

  console.log(`\nAll ${passed} assertions passed. RLS isolation holds. ✅`);
}

async function cleanup() {
  for (const u of [userA, userB]) {
    if (u.id) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
}

try {
  await main();
  await cleanup();
  process.exit(0);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  await cleanup();
  process.exit(1);
}
