import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { error } = await supabase.auth.signOut();
    if (error) {
      return commitSupabaseResponse(
        new Response("Sign out could not be completed.", { status: 502 }),
        pending,
      );
    }
    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: { location: "/auth/sign-in" },
      }),
      pending,
    );
  },
});
