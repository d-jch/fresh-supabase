import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { resolveRedirectPath } from "../../../lib/supabase/redirect.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

function failedConfirmation(): Response {
  return new Response(null, {
    status: 303,
    headers: { location: "/auth/sign-in" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const tokenHash = ctx.url.searchParams.get("token_hash");
    const type = ctx.url.searchParams.get("type");
    if (!tokenHash || (type !== "email" && type !== "recovery")) {
      return failedConfirmation();
    }

    const fallback = type === "recovery" ? "/auth/update-password" : "/account";
    const next = resolveRedirectPath(
      ctx.url.searchParams.get("next"),
      fallback,
    );
    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    return commitSupabaseResponse(
      error
        ? failedConfirmation()
        : new Response(null, { status: 303, headers: { location: next } }),
      pending,
    );
  },
});
