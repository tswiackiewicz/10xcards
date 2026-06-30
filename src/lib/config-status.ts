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
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "OpenRouter",
    configured: Boolean(OPENROUTER_API_KEY),
    message: "OpenRouter nie jest skonfigurowany — generowanie fiszek przez AI jest wyłączone.",
    docsUrl: "https://openrouter.ai/docs/api/reference/authentication",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
