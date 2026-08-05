import type {
  PendingSupabaseChanges,
  PendingSupabaseCookie,
} from "./server.ts";

const CACHE_HEADERS = new Set(["cache-control", "expires", "pragma"]);
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function cookieDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("Invalid cookie expiry");
  }
  return date.toUTCString();
}

function serializeCookie(cookie: PendingSupabaseCookie): string {
  if (!TOKEN.test(cookie.name) || /[\u0000-\u001f\u007f;]/.test(cookie.value)) {
    throw new Error("Supabase returned an invalid cookie");
  }
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`];
  const options = cookie.options;
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${cookieDate(options.expires)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const sameSite = typeof options.sameSite === "string"
      ? options.sameSite
      : options.sameSite
      ? "strict"
      : "";
    if (sameSite) {
      parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
    }
  }
  return parts.join("; ");
}

export function commitSupabaseResponse(
  response: Response,
  pending: PendingSupabaseChanges,
): Response {
  if (pending.cookies.length === 0 && [...pending.headers].length === 0) {
    return response;
  }
  if (response.status < 200 || response.status > 599) {
    throw new Error(
      `Cannot commit Supabase changes to status ${response.status}`,
    );
  }
  if (response.bodyUsed || response.body?.locked) {
    throw new Error(
      "Cannot commit Supabase changes to a consumed or locked body",
    );
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of pending.headers) {
    if (CACHE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  for (const cookie of pending.cookies) {
    headers.append("set-cookie", serializeCookie(cookie));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
