import { csrf } from "fresh";
import { define } from "../../utils.ts";
import { commitSupabaseResponse } from "../../lib/supabase/response.ts";
import {
  requireRequestUser,
  setSupabaseUser,
} from "../../lib/supabase/require_user.ts";
import { resolveRedirectPath } from "../../lib/supabase/redirect.ts";

const requireUser = define.middleware(async (ctx) => {
  const { user, pending } = await requireRequestUser(ctx.req);
  if (user === null) {
    const next = resolveRedirectPath(
      `${ctx.url.pathname}${ctx.url.search}`,
      "/account",
    );
    const search = new URLSearchParams({ next });
    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: { location: `/auth/sign-in?${search}` },
      }),
      pending,
    );
  }

  setSupabaseUser(ctx.state, user);
  return commitSupabaseResponse(await ctx.next(), pending);
});

export default define.middleware([csrf(), requireUser]);
