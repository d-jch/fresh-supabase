import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { readSupabasePublicConfig } from "./env.ts";

export interface PendingSupabaseCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface PendingSupabaseChanges {
  cookies: PendingSupabaseCookie[];
  headers: Headers;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function requestCookies(
  request: Request,
): Array<{ name: string; value: string }> {
  const header = request.headers.get("cookie");
  if (!header) return [];
  const cookies: Array<{ name: string; value: string }> = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    cookies.push({
      name,
      value: decodeCookieValue(part.slice(separator + 1).trim()),
    });
  }
  return cookies;
}

export function createSupabaseServerClient(request: Request) {
  const config = readSupabasePublicConfig();
  const pending: PendingSupabaseChanges = {
    cookies: [],
    headers: new Headers(),
  };
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => requestCookies(request),
      setAll: (cookies, headers) => {
        pending.cookies.push(...cookies);
        for (const [name, value] of Object.entries(headers)) {
          pending.headers.set(name, value);
        }
      },
    },
  });
  return { supabase, pending };
}
