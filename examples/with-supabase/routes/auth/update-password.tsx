import { page } from "fresh";
import { Head } from "fresh/runtime";
import { UpdatePasswordForm } from "@/components/auth/update-password-form.tsx";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

interface UpdatePasswordData {
  error: string | null;
}

export const handler = define.handlers({
  GET() {
    return page<UpdatePasswordData>({ error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const password = form.get("password");
    if (typeof password !== "string" || !password) {
      return page<UpdatePasswordData>({
        error: "Enter a new password.",
      }, { status: 400 });
    }
    const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return page<UpdatePasswordData>({
        error: "Your password could not be updated.",
      }, { status: 400 });
    }
    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: {
          location: withFreshBasePath(ctx.config.basePath, "/protected"),
        },
      }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <>
    <Head>
      <title>Choose a new password</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <UpdatePasswordForm {...data} />
    </main>
  </>
));
