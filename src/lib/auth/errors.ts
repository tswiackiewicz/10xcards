/**
 * Generic auth failure copy.
 *
 * Supabase's verbatim `error.message` used to go straight into the `?error=` query string
 * that `ServerError.tsx` renders. With email confirmations off, signing up with an address
 * that already exists returns `"User already registered"` — an account-existence oracle,
 * and one that also lands in Referer headers, browser history and Cloudflare logs.
 *
 * The rule this module enforces: **no Supabase error may produce a message that reveals
 * whether an account exists.** Every failure in a flow collapses to that flow's single
 * generic string. The one carve-out is rate limiting, which the user genuinely needs to see or
 * they will just keep retrying. It is a carve-out and not a leak for request-rate limits, which
 * fire before any credential is evaluated. `over_email_send_rate_limit` is the narrower case:
 * it fires only where a confirmation email was actually attempted, so with confirmations enabled
 * it can only follow a *new* address — a residual channel, and one that would need reopening if
 * `enable_confirmations` is ever turned on.
 *
 * Deliberately *not* a per-code lookup table with helpful copy. "Password should be at
 * least 6 characters" looks harmless, but Supabase only reaches password validation for an
 * address that is free: submit a known-weak password and a specific message means "this
 * address is available", a generic one means "taken". Distinguishability is the leak, not
 * the wording.
 */

/** Every string this module can return. Nothing else reaches the query string. */
export const AUTH_ERROR_MESSAGES = {
  signin: "Invalid email or password.",
  signup: "Could not create an account with those details.",
  rateLimited: "Too many attempts. Please try again later.",
} as const;

export type AuthFlow = "signin" | "signup";

/** The shape of `AuthError` this module needs; kept structural so tests need no Supabase import. */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

function isRateLimited(error: AuthErrorLike): boolean {
  return error.status === 429 || (error.code ?? "").includes("rate_limit");
}

/**
 * Maps any Supabase auth error to a fixed generic string for `flow`.
 *
 * Within a flow the result depends only on whether the request was rate limited — never on
 * the address, the password, or which Supabase code came back.
 */
export function toGenericAuthError(flow: AuthFlow, error: AuthErrorLike): string {
  if (isRateLimited(error)) {
    return AUTH_ERROR_MESSAGES.rateLimited;
  }
  return AUTH_ERROR_MESSAGES[flow];
}

/**
 * `true` when signup failed *only* because the address is already registered.
 *
 * Callers must render this outcome exactly like a successful signup — see
 * `src/pages/api/auth/signup.ts`. Generic copy alone does not close the oracle: two
 * different redirect targets leak existence just as loudly as the message used to.
 */
export function isUserAlreadyExists(error: AuthErrorLike): boolean {
  return error.code === "user_already_exists" || error.message === "User already registered";
}
