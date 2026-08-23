import { SUPABASE_URL, SUPABASE_KEY, OPENROUTER_API_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase is not configured — authentication features are disabled.",
    docsUrl: "https://github.com/tswiackiewicz/10xcards#readme",
    docsLabel: "See setup instructions",
  },
  {
    name: "OpenRouter",
    configured: Boolean(OPENROUTER_API_KEY),
    message: "OpenRouter is not configured — AI flashcard generation is disabled.",
    docsUrl: "https://openrouter.ai/docs/api/reference/authentication",
    docsLabel: "See setup instructions",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
