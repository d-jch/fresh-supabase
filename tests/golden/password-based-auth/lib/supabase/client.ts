import { createBrowserClient } from "@supabase/ssr";

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

function required(value: string | undefined, name: string): string {
  value = value?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function readSupabasePublicConfig(): SupabasePublicConfig {
  return {
    url: required(
      Deno.env.get("FRESH_PUBLIC_SUPABASE_URL"),
      "FRESH_PUBLIC_SUPABASE_URL",
    ),
    publishableKey: required(
      Deno.env.get("FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      "FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}

export function createSupabaseBrowserClient(
  config = readSupabasePublicConfig(),
) {
  return createBrowserClient(config.url, config.publishableKey);
}
