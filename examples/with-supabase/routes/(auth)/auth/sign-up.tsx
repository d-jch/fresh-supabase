import { page } from "fresh";
import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

interface SignUpData {
  error: string | null;
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function passwordField(form: FormData): string {
  const value = form.get("password");
  return typeof value === "string" ? value : "";
}

function SignUpView({ error }: SignUpData) {
  return (
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-5">
          <div>
            <h1 class="card-title text-2xl">Create account</h1>
            <p class="mt-1 text-sm text-base-content/70">
              Use an email address you can verify.
            </p>
          </div>
          {error && <div class="alert alert-error" role="alert">{error}</div>}
          <form method="post" class="space-y-4">
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
                autocomplete="new-password"
                minlength={8}
                required
              />
            </label>
            <button class="btn btn-primary w-full" type="submit">
              Create account
            </button>
          </form>
          <a class="link link-hover text-sm" href="/auth/sign-in">
            Already have an account? Sign in
          </a>
        </div>
      </section>
    </main>
  );
}

export const handler = define.handlers({
  GET() {
    return page<SignUpData>({ error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = textField(form, "email");
    const password = passwordField(form);
    if (!email || password.length < 8) {
      return page<SignUpData>({
        error: "Enter an email and a password of at least 8 characters.",
      }, { status: 400 });
    }

    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      return commitSupabaseResponse(
        await ctx.render(
          <SignUpView error="We could not create that account." />,
          { status: 400 },
        ),
        pending,
      );
    }

    const location = data.session
      ? "/account"
      : "/auth/sign-in?message=check-email";
    return commitSupabaseResponse(
      new Response(null, { status: 303, headers: { location } }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <SignUpView {...data} />
));
