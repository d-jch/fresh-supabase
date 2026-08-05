export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function readSupabasePublicConfig(): SupabasePublicConfig {
  return {
    url: required("FRESH_PUBLIC_SUPABASE_URL"),
    publishableKey: required("FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}
