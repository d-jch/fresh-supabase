import type { JwtPayload } from "@supabase/supabase-js";
import { csrf } from "fresh";
import { define } from "@/utils.ts";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";

const browserCsrf = csrf();

// Keep browser CSRF checks scoped to auth flows and the protected sign-out
// POST. Authentication routing is applied separately by supabaseSession.
export const scopedAuthCsrf = define.middleware((ctx) => {
  const mutation = ctx.req.method !== "GET" && ctx.req.method !== "HEAD";
  const authPath = withFreshBasePath(ctx.config.basePath, "/auth");
  const protectedMutation = mutation && ctx.url.pathname ===
      withFreshBasePath(ctx.config.basePath, "/protected");
  return ctx.url.pathname.startsWith(`${authPath}/`) || protectedMutation
    ? browserCsrf(ctx)
    : ctx.next();
});

export const supabaseSession = define.middleware(async (ctx) => {
  const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
  let claims: JwtPayload | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    // Match upstream: an unavailable or unverifiable session is anonymous.
    // Supabase's cookie adapter still owns any refresh-cookie cleanup.
  }
  Reflect.set(ctx.state, "supabaseClaims", claims);

  if (
    claims === null &&
    !isSupabasePublicPath(ctx.url.pathname, ctx.config.basePath)
  ) {
    const location = new URL(ctx.url);
    location.pathname = withFreshBasePath(
      ctx.config.basePath,
      "/auth/login",
    );
    return commitSupabaseResponse(
      new Response(null, {
        status: 307,
        headers: { location: location.toString() },
      }),
      pending,
    );
  }

  return commitSupabaseResponse(await ctx.next(), pending);
});

export function isSupabasePublicPath(
  pathname: string,
  basePath: string,
): boolean {
  return pathname.startsWith(withFreshBasePath(basePath, "/login")) ||
    pathname.startsWith(withFreshBasePath(basePath, "/auth"));
}

export function getSupabaseClaims(state: object): JwtPayload | null {
  return (Reflect.get(state, "supabaseClaims") as
    | JwtPayload
    | null
    | undefined) ??
    null;
}
