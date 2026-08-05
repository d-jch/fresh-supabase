import { createBrowserClient } from "@supabase/ssr";
import type { SupabasePublicConfig } from "./env.ts";

// Pass public configuration from a server-rendered route into an island when a
// browser client is actually needed. Most routes should use the server client.
export function createSupabaseBrowserClient(config: SupabasePublicConfig) {
  return createBrowserClient(config.url, config.publishableKey);
}
