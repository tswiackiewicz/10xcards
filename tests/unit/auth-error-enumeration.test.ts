import { describe, expect, it } from "vitest";
import { AUTH_ERROR_MESSAGES, toGenericAuthError, type AuthErrorLike } from "@/lib/auth/errors";

/**
 * The regression guard for the account-existence oracle. Before this mapping existed both
 * auth routes put Supabase's verbatim `error.message` into the `?error=` query string, so
 * signing up with an already-registered address answered `"User already registered"`.
 *
 * No e2e spec asserts on auth error copy (the five files are landing-smoke, risk1, risk3,
 * risk8 and seed), so without this test the oracle could come back silently.
 */

/** The two that must never be tellable apart — the oracle, and an ordinary bad password. */
const USER_EXISTS: AuthErrorLike = { message: "User already registered", code: "user_already_exists", status: 422 };
const BAD_CREDENTIALS: AuthErrorLike = {
  message: "Invalid login credentials",
  code: "invalid_credentials",
  status: 400,
};

/** Real Supabase GoTrue failures, verbatim. */
const SUPABASE_ERRORS: { label: string; error: AuthErrorLike }[] = [
  { label: "user already registered", error: USER_EXISTS },
  { label: "invalid credentials", error: BAD_CREDENTIALS },
  {
    label: "weak password",
    error: { message: "Password should be at least 6 characters", code: "weak_password", status: 422 },
  },
  { label: "email not confirmed", error: { message: "Email not confirmed", code: "email_not_confirmed", status: 400 } },
  {
    label: "invalid email",
    error: { message: "Unable to validate email address: invalid format", code: "validation_failed", status: 400 },
  },
  {
    label: "signups disabled",
    error: { message: "Signups not allowed for this instance", code: "signup_disabled", status: 422 },
  },
  { label: "user banned", error: { message: "User is banned", code: "user_banned", status: 403 } },
  { label: "empty error", error: {} },
];

describe("toGenericAuthError", () => {
  for (const flow of ["signin", "signup"] as const) {
    describe(`${flow} flow`, () => {
      it("collapses every Supabase error to that flow's one generic string", () => {
        const produced = new Set(SUPABASE_ERRORS.map(({ error }) => toGenericAuthError(flow, error)));
        expect([...produced]).toEqual([AUTH_ERROR_MESSAGES[flow]]);
      });

      it("makes 'user already registered' indistinguishable from a bad-credentials failure", () => {
        expect(toGenericAuthError(flow, USER_EXISTS)).toBe(toGenericAuthError(flow, BAD_CREDENTIALS));
      });

      it("only ever returns a string from the fixed set", () => {
        const allowed = Object.values(AUTH_ERROR_MESSAGES) as string[];
        for (const { error } of SUPABASE_ERRORS) {
          expect(allowed).toContain(toGenericAuthError(flow, error));
        }
      });
    });
  }

  // Rate limiting fires before any credential is evaluated, so it cannot signal existence —
  // and the user needs to see it, or they retry into the limit forever.
  it("surfaces rate limiting, the one non-oracle carve-out", () => {
    expect(
      toGenericAuthError("signup", {
        message: "Email rate limit exceeded",
        code: "over_email_send_rate_limit",
        status: 429,
      }),
    ).toBe(AUTH_ERROR_MESSAGES.rateLimited);
    expect(toGenericAuthError("signin", { message: "Request rate limit reached", status: 429 })).toBe(
      AUTH_ERROR_MESSAGES.rateLimited,
    );
  });

  it("carries no Supabase-specific vocabulary in any of the fixed strings", () => {
    // If a future edit reaches for "helpful" copy, these are the words that give the game away.
    const TELLS = ["registered", "already", "exists", "credentials", "confirmed", "banned", "signup", "characters"];
    for (const message of Object.values(AUTH_ERROR_MESSAGES)) {
      for (const tell of TELLS) {
        expect(message.toLowerCase(), `"${message}" carries the tell "${tell}"`).not.toContain(tell);
      }
    }
  });

  it("does not treat rate limiting as a way to probe existence", () => {
    // Same status, both flows, regardless of which account it was: one string.
    const a = toGenericAuthError("signup", { code: "over_request_rate_limit", status: 429 });
    const b = toGenericAuthError("signin", { code: "over_request_rate_limit", status: 429 });
    expect(a).toBe(b);
  });
});
