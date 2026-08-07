import { type CookieOptions, createServerClient } from "@supabase/ssr";

export interface PendingSupabaseCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface PendingSupabaseChanges {
  cookies: PendingSupabaseCookie[];
  headers: Headers;
}

export interface SupabaseServerContext {
  request: Request;
  supabase: ReturnType<typeof createServerClient>;
  pending: PendingSupabaseChanges;
}

const requestContexts = new WeakMap<object, SupabaseServerContext>();
const CACHE_HEADERS = new Set(["cache-control", "expires", "pragma"]);
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_VALUE = /^[\u0021-\u003a\u003c-\u007e]*$/;
// deno-lint-ignore no-control-regex -- cookie attributes must reject controls.
const INVALID_COOKIE_ATTRIBUTE = /[\u0000-\u001f\u007f;]/;
const REDIRECT_BASE = new URL("https://fresh-supabase.invalid");
// deno-lint-ignore no-control-regex -- redirects must reject every URL control.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const ENCODED_CONTROL_OR_BACKSLASH =
  /%(?:0[0-9A-Fa-f]|1[0-9A-Fa-f]|5[cC]|7[fF])/;

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createPendingSupabaseChanges(): PendingSupabaseChanges {
  return { cookies: [], headers: new Headers() };
}

export function collectPendingSupabaseChanges(
  pending: PendingSupabaseChanges,
  cookies: PendingSupabaseCookie[],
  headers: Record<string, string>,
): void {
  pending.cookies.push(...cookies.map((cookie) => ({
    ...cookie,
    options: { ...cookie.options },
  })));
  for (const [name, value] of Object.entries(headers)) {
    pending.headers.set(name, value);
  }
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
  const pending = createPendingSupabaseChanges();
  const supabase = createServerClient(
    required("FRESH_PUBLIC_SUPABASE_URL"),
    required("FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => requestCookies(request),
        setAll: (cookies, headers) =>
          collectPendingSupabaseChanges(pending, cookies, headers),
      },
    },
  );
  return { supabase, pending };
}

export function getSupabaseServerContext(
  state: object,
  request: Request,
): SupabaseServerContext {
  const existing = requestContexts.get(state);
  if (existing) {
    if (existing.request !== request) {
      throw new Error("Fresh request state was reused across requests");
    }
    return existing;
  }
  const created = { request, ...createSupabaseServerClient(request) };
  requestContexts.set(state, created);
  return created;
}

function cookieAttribute(value: string, name: string): string {
  if (INVALID_COOKIE_ATTRIBUTE.test(value)) {
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
  if (!TOKEN.test(cookie.name) || INVALID_COOKIE_ATTRIBUTE.test(cookie.value)) {
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
  if (options.path) parts.push(`Path=${cookieAttribute(options.path, "path")}`);
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
  // WebSocket upgrade responses cannot be reconstructed with Response().
  if (response.status === 101) return response;
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
  const committed = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  pending.cookies.length = 0;
  for (const name of [...pending.headers.keys()]) pending.headers.delete(name);
  return committed;
}

function normalizeInternalPath(value: string): string | null {
  if (
    value.length === 0 || !value.startsWith("/") || value.startsWith("//") ||
    value.includes("\\") || CONTROL_CHARACTER.test(value) ||
    INVALID_PERCENT_ESCAPE.test(value) ||
    ENCODED_CONTROL_OR_BACKSLASH.test(value)
  ) return null;
  try {
    encodeURI(value);
    const parsed = new URL(value, REDIRECT_BASE);
    if (
      parsed.origin !== REDIRECT_BASE.origin || parsed.username !== "" ||
      parsed.password !== "" || !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//")
    ) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function normalizeFreshBasePath(basePath: string): string | null {
  if (basePath === "" || basePath === "/") return "";
  const safeBase = normalizeInternalPath(basePath);
  if (
    safeBase === null || safeBase.includes("?") || safeBase.includes("#")
  ) return null;
  return safeBase.replace(/\/$/, "");
}

function pathIsWithinBasePath(path: string, basePath: string): boolean {
  if (basePath === "") return true;
  const pathname = new URL(path, REDIRECT_BASE).pathname;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function resolveRedirectPath(
  value: unknown,
  fallback = "/",
  basePath = "",
): string {
  const safeFallback = normalizeInternalPath(fallback);
  if (safeFallback === null) {
    throw new TypeError("Redirect fallback must be an internal path");
  }
  const safeBase = normalizeFreshBasePath(basePath);
  if (safeBase === null) {
    throw new TypeError("Fresh basePath must be an internal path prefix");
  }
  if (!pathIsWithinBasePath(safeFallback, safeBase)) {
    throw new TypeError("Redirect fallback must stay within Fresh basePath");
  }
  const candidate = typeof value === "string"
    ? normalizeInternalPath(value)
    : null;
  return candidate !== null && pathIsWithinBasePath(candidate, safeBase)
    ? candidate
    : safeFallback;
}

export function withFreshBasePath(basePath: string, path: string): string {
  const safePath = normalizeInternalPath(path);
  if (safePath === null) {
    throw new TypeError("Application path must be an internal path");
  }
  const safeBase = normalizeFreshBasePath(basePath);
  if (safeBase === null) {
    throw new TypeError("Fresh basePath must be an internal path prefix");
  }
  return `${safeBase}${safePath}`;
}
