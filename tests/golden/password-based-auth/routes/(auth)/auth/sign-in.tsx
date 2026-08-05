import { page } from "fresh";
import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { resolveRedirectPath } from "../../../lib/supabase/redirect.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

interface SignInData {
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

function passwordField(form: FormData): string {
  const value = form.get("password");
  return typeof value === "string" ? value : "";
}

function SignInView({ error, message, next }: SignInData) {
  return (
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-5">
          <div>
            <h1 class="card-title text-2xl">Sign in</h1>
            <p class="mt-1 text-sm text-base-content/70">
              Continue with your email and password.
            </p>
          </div>
          {message && <div class="alert alert-success">{message}</div>}
          {error && <div class="alert alert-error" role="alert">{error}</div>}
          <form method="post" class="space-y-4">
            <input type="hidden" name="next" value={next} />
            <label class="form-control w-full">
              <span class="label-text mb-1">Email</span>
              <input
                class="input input-bordered w-full"
                type="email"
                name="email"
                autocomplete="email"
                required
              />
            </label>
            <label class="form-control w-full">
              <span class="label-text mb-1">Password</span>
              <input
                class="input input-bordered w-full"
                type="password"
                name="password"
                autocomplete="current-password"
                required
              />
            </label>
            <button class="btn btn-primary w-full" type="submit">
              Sign in
            </button>
          </form>
          <nav class="flex justify-between text-sm">
            <a class="link link-hover" href="/auth/forgot-password">
              Forgot password?
            </a>
            <a class="link link-hover" href="/auth/sign-up">Create account</a>
          </nav>
        </div>
      </section>
    </main>
  );
}

export const handler = define.handlers({
  GET(ctx) {
    const messageKey = ctx.url.searchParams.get("message") ?? "";
    return page<SignInData>({
      error: null,
      message: MESSAGES[messageKey] ?? null,
      next: resolveRedirectPath(ctx.url.searchParams.get("next"), "/account"),
    });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = textField(form, "email");
    const password = passwordField(form);
    const next = resolveRedirectPath(form.get("next"), "/account");
    if (!email || !password) {
      return page<SignInData>({
        error: "Enter both your email and password.",
        message: null,
        next,
      }, { status: 400 });
    }

    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return commitSupabaseResponse(
        await ctx.render(
          <SignInView
            error="The email or password was not accepted."
            message={null}
            next={next}
          />,
          { status: 400 },
        ),
        pending,
      );
    }

    return commitSupabaseResponse(
      new Response(null, { status: 303, headers: { location: next } }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <SignInView {...data} />
));
