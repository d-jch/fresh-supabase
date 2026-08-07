import type { EmailOtpType } from "@supabase/supabase-js";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  resolveRedirectPath,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function authError(basePath: string, message: string): Response {
  const search = new URLSearchParams({ error: message });
  return new Response(null, {
    status: 303,
    headers: {
      location: `${withFreshBasePath(basePath, "/auth/error")}?${search}`,
    },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const basePath = ctx.config.basePath;
    const tokenHash = ctx.url.searchParams.get("token_hash");
    const candidate = ctx.url.searchParams.get("type") as EmailOtpType | null;
    if (!tokenHash || !candidate || !OTP_TYPES.has(candidate)) {
      return authError(basePath, "No token hash or type");
    }
    const fallback = candidate === "recovery"
      ? withFreshBasePath(basePath, "/auth/update-password")
      : withFreshBasePath(basePath, "/protected");
    const next = resolveRedirectPath(
      ctx.url.searchParams.get("next"),
      fallback,
    );
    const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: candidate,
    });
    return commitSupabaseResponse(
      error
        ? authError(basePath, error.message)
        : new Response(null, { status: 303, headers: { location: next } }),
      pending,
    );
  },
});
