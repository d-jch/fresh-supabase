import { page } from "fresh";
import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

interface ForgotPasswordData {
  error: string | null;
}

function ForgotPasswordView({ error }: ForgotPasswordData) {
  return (
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-5">
          <div>
            <h1 class="card-title text-2xl">Reset password</h1>
            <p class="mt-1 text-sm text-base-content/70">
              We will send password reset instructions if the account exists.
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
            <button class="btn btn-primary w-full" type="submit">
              Send reset instructions
            </button>
          </form>
          <a class="link link-hover text-sm" href="/auth/sign-in">
            Back to sign in
          </a>
        </div>
      </section>
    </main>
  );
}

export const handler = define.handlers({
  GET() {
    return page<ForgotPasswordData>({ error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const value = form.get("email");
    const email = typeof value === "string" ? value.trim() : "";
    if (!email) {
      return page<ForgotPasswordData>({ error: "Enter your email address." }, {
        status: 400,
      });
    }

    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      return commitSupabaseResponse(
        await ctx.render(
          <ForgotPasswordView error="Reset instructions could not be sent." />,
          { status: 400 },
        ),
        pending,
      );
    }

    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: { location: "/auth/sign-in?message=reset-email" },
      }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <ForgotPasswordView {...data} />
));
