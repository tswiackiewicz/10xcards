import { execSync } from "node:child_process";

// Maps `supabase status -o env`'s own key names to the names the app and the test
// helpers expect. The CLI does not emit `SUPABASE_*`-prefixed keys, so this mapping
// is required, not cosmetic.
const REQUIRED: Record<string, string> = {
  API_URL: "SUPABASE_URL",
  ANON_KEY: "SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
};

function parseEnvOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
    if (match) {
      parsed[match[1]] = match[2];
    }
  }
  return parsed;
}

export default function setup(): void {
  let output: string;
  try {
    output = execSync("npx supabase status -o env", { encoding: "utf-8" });
  } catch (err) {
    throw new Error(
      "Could not read local Supabase status — is it running? Run `supabase start` before `npm test`.\n" +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = parseEnvOutput(output);

  for (const [sourceKey, targetKey] of Object.entries(REQUIRED)) {
    const value = parsed[sourceKey];
    if (!value) {
      throw new Error(
        `\`supabase status -o env\` did not report ${sourceKey}. Run \`supabase start\` before \`npm test\`.`,
      );
    }
    process.env[targetKey] = value;
  }

  // The app itself (src/lib/supabase.ts, via astro:env/server) reads the anon key under
  // its own name, SUPABASE_KEY — distinct from the test-helper name above but the same
  // underlying local-instance value.
  process.env.SUPABASE_KEY = parsed.ANON_KEY;

  // Fixed test-only values for the two secrets the astro:env/server stub exposes
  // (vitest.config.ts) that aren't part of `supabase status -o env` — deliberately not
  // sourced from .dev.vars, so test correctness never depends on a real secret.
  process.env.CRON_PURGE_SECRET = "test-purge-secret";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
}
