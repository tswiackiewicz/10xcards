/** Reads a required env var populated by tests/setup/env.ts's globalSetup, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name} — did tests/setup/env.ts's globalSetup run?`);
  }
  return value;
}
