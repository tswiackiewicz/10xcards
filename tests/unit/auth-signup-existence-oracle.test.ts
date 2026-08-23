import { afterAll, describe, expect, it } from "vitest";
import { POST as SIGNUP } from "@/pages/api/auth/signup";
import { buildContext } from "../helpers/api-context";
import { adminClient, cleanupUser, seedUser } from "../helpers/auth";

/**
 * Route-level regression guard for the account-existence oracle.
 *
 * tests/unit/auth-error-enumeration.test.ts asserts the same property one layer too low: it
 * feeds two *error* objects to a pure mapping function, so it can never observe a status line
 * or a `Location`, and the success branch never reaches it at all. It stayed green while
 * signup redirected a free address to `/auth/confirm-email` and an already-registered one to
 * `/auth/signup?error=...` — one header, every account enumerated. What follows asserts on
 * what an unauthenticated client can actually see.
 */

const VALID_PASSWORD = "Probe-password-123!";
/** Below `minimum_password_length = 6` (supabase/config.toml). */
const WEAK_PASSWORD = "a";

const createdEmails: string[] = [];

function freshEmail(): string {
  const email = `oracle-probe-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  createdEmails.push(email);
  return email;
}

interface Probe {
  status: number;
  location: string | null;
}

/** Exactly what an unauthenticated client gets back: the status line and the redirect target. */
async function signupProbe(email: string, password: string): Promise<Probe> {
  const response = await SIGNUP(
    buildContext({ method: "POST", url: "http://localhost/api/auth/signup", formBody: { email, password } }),
  );
  return { status: response.status, location: response.headers.get("Location") };
}

describe("POST /api/auth/signup — account-existence oracle", () => {
  afterAll(async () => {
    const { data } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
    for (const email of createdEmails) {
      const user = data.users.find((candidate) => candidate.email === email);
      if (user) {
        await cleanupUser(user.id);
      }
    }
  });

  it("answers a taken address exactly as it answers a free one", async () => {
    const existing = await seedUser();
    try {
      const taken = await signupProbe(existing.email, VALID_PASSWORD);
      const free = await signupProbe(freshEmail(), VALID_PASSWORD);

      expect(taken).toEqual(free);
      expect(taken.location).toBe("/auth/confirm-email");
    } finally {
      await cleanupUser(existing.id);
    }
  });

  it("answers a weak-password probe the same way for a taken and a free address", async () => {
    // The fix above leans on GoTrue validating the password *before* it looks the address up:
    // otherwise a weak-password probe would still separate the branches (taken -> the
    // already-exists fall-through, free -> the generic error). Pin that ordering here, so a
    // GoTrue change that reverses it fails loudly instead of silently reopening the channel.
    const existing = await seedUser();
    try {
      const taken = await signupProbe(existing.email, WEAK_PASSWORD);
      const free = await signupProbe(freshEmail(), WEAK_PASSWORD);

      expect(taken).toEqual(free);
      expect(taken.location).toContain("/auth/signup?error=");
    } finally {
      await cleanupUser(existing.id);
    }
  });
});
