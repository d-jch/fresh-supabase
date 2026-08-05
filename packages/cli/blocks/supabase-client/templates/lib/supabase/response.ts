import type {
  PendingSupabaseChanges,
  PendingSupabaseCookie,
} from "./server.ts";

const CACHE_HEADERS = new Set(["cache-control", "expires", "pragma"]);
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\u0021-\u003a\u003c-\u007e]*$/;

function cookieAttribute(value: string, name: string): string {
  if (/[\u0000-\u001f\u007f;]/.test(value)) {
    throw new Error(`Invalid cookie ${name}`);
  }
  return value;
}

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
  const options = cookie.options;
  const encoded = options.encode
    ? options.encode(cookie.value)
    : encodeURIComponent(cookie.value);
  if (!COOKIE_VALUE.test(encoded)) {
    throw new Error("Supabase returned an invalid cookie value");
  }
  const parts = [`${cookie.name}=${encoded}`];
  if (options.maxAge !== undefined) {
    if (!Number.isInteger(options.maxAge)) {
      throw new Error("Invalid cookie max age");
    }
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain) {
    parts.push(`Domain=${cookieAttribute(options.domain, "domain")}`);
  }
  if (options.path) {
    parts.push(`Path=${cookieAttribute(options.path, "path")}`);
  }
  if (options.expires) parts.push(`Expires=${cookieDate(options.expires)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.partitioned) parts.push("Partitioned");
  if (options.priority) {
    const priorities = { low: "Low", medium: "Medium", high: "High" } as const;
    const priority = priorities[options.priority];
    if (!priority) throw new Error("Invalid cookie priority");
    parts.push(`Priority=${priority}`);
  }
  if (options.sameSite) {
    const sites = { lax: "Lax", strict: "Strict", none: "None" } as const;
    const sameSite = options.sameSite === true
      ? "Strict"
      : sites[options.sameSite];
    if (!sameSite) throw new Error("Invalid cookie same-site policy");
    parts.push(`SameSite=${sameSite}`);
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
