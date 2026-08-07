import { page } from "fresh";
import { Head } from "fresh/runtime";
import { LoginForm } from "@/components/auth/login-form.tsx";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  resolveRedirectPath,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

interface LoginData {
  basePath: string;
  error: string | null;
  message: string | null;
  next: string;
}

const MESSAGES: Record<string, string> = {
  "check-email": "Check your email to finish creating your account.",
  "reset-email": "Check your email for password reset instructions.",
};

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export const handler = define.handlers({
  GET(ctx) {
    const message = ctx.url.searchParams.get("message") ?? "";
    const basePath = ctx.config.basePath;
    return page<LoginData>({
      basePath,
      error: null,
      message: MESSAGES[message] ?? null,
      next: resolveRedirectPath(
        ctx.url.searchParams.get("next"),
        withFreshBasePath(basePath, "/protected"),
      ),
    });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = textField(form, "email");
    const password = form.get("password");
    const basePath = ctx.config.basePath;
    const next = resolveRedirectPath(
      form.get("next"),
      withFreshBasePath(basePath, "/protected"),
    );
    if (!email || typeof password !== "string" || !password) {
      return page<LoginData>({
        basePath,
        error: "Enter both your email and password.",
        message: null,
        next,
      }, { status: 400 });
    }

    const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return page<LoginData>({
        basePath,
        error: "The email or password was not accepted.",
        message: null,
        next,
      }, { status: 400 });
    }
    return commitSupabaseResponse(
      new Response(null, { status: 303, headers: { location: next } }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <>
    <Head>
      <title>Log in</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <LoginForm {...data} />
    </main>
  </>
));
