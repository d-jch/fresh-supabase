const REDIRECT_BASE = new URL("https://fresh-supabase.invalid");
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const INVALID_PERCENT_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const ENCODED_CONTROL_OR_BACKSLASH =
  /%(?:0[0-9A-Fa-f]|1[0-9A-Fa-f]|5[cC]|7[fF])/;

function normalizeInternalPath(value: string): string | null {
  if (
    value.length === 0 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTER.test(value) ||
    INVALID_PERCENT_ESCAPE.test(value) ||
    ENCODED_CONTROL_OR_BACKSLASH.test(value)
  ) {
    return null;
  }

  try {
    // encodeURI rejects malformed Unicode without decoding URL components.
    encodeURI(value);
    const parsed = new URL(value, REDIRECT_BASE);
    if (
      parsed.origin !== REDIRECT_BASE.origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * Resolve an untrusted redirect to a same-origin path.
 *
 * Unsafe candidates use the validated fallback. Encoded slashes retain the URL
 * standard's path semantics because this helper parses once and never decodes
 * path components.
 */
export function resolveRedirectPath(
  value: unknown,
  fallback = "/",
): string {
  const safeFallback = normalizeInternalPath(fallback);
  if (safeFallback === null) {
    throw new TypeError("Redirect fallback must be an internal path");
  }
  return typeof value === "string"
    ? normalizeInternalPath(value) ?? safeFallback
    : safeFallback;
}
