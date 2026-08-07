import { page } from "fresh";
import { Head } from "fresh/runtime";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form.tsx";
import {
  getSupabaseServerContext,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

interface ForgotPasswordData {
  basePath: string;
  error: string | null;
  success: boolean;
}

export const handler = define.handlers({
  GET(ctx) {
    return page<ForgotPasswordData>({
      basePath: ctx.config.basePath,
      error: null,
      success: false,
    });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const value = form.get("email");
    const email = typeof value === "string" ? value.trim() : "";
    const basePath = ctx.config.basePath;
    if (!email) {
      return page<ForgotPasswordData>({
        basePath,
        error: "Enter your email address.",
        success: false,
      }, { status: 400 });
    }
    const { supabase } = getSupabaseServerContext(ctx.state, ctx.req);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${ctx.url.origin}${
        withFreshBasePath(basePath, "/auth/confirm")
      }?next=${
        encodeURIComponent(withFreshBasePath(basePath, "/auth/update-password"))
      }`,
    });
    return error
      ? page<ForgotPasswordData>({
        basePath,
        error: "Reset instructions could not be sent.",
        success: false,
      }, { status: 400 })
      : page<ForgotPasswordData>({ basePath, error: null, success: true });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <>
    <Head>
      <title>Reset password</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <ForgotPasswordForm {...data} />
    </main>
  </>
));
