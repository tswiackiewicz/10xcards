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
 * generic string. The one carve-out is rate limiting, which fires before any credential is
 * evaluated and so cannot signal existence — and which the user genuinely needs to see, or
 * they will just keep retrying.
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
