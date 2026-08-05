import { page } from "fresh";
import { define } from "../../../utils.ts";
import { commitSupabaseResponse } from "../../../lib/supabase/response.ts";
import { createSupabaseServerClient } from "../../../lib/supabase/server.ts";

interface UpdatePasswordData {
  error: string | null;
}

function UpdatePasswordView({ error }: UpdatePasswordData) {
  return (
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <section class="card w-full bg-base-100 shadow-xl">
        <div class="card-body gap-5">
          <div>
            <h1 class="card-title text-2xl">Choose a new password</h1>
            <p class="mt-1 text-sm text-base-content/70">
              Open this page from your password recovery email.
            </p>
          </div>
          {error && <div class="alert alert-error" role="alert">{error}</div>}
          <form method="post" class="space-y-4">
            <label class="form-control w-full">
              <span class="label-text mb-1">New password</span>
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
              Update password
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export const handler = define.handlers({
  GET() {
    return page<UpdatePasswordData>({ error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const value = form.get("password");
    const password = typeof value === "string" ? value : "";
    if (password.length < 8) {
      return page<UpdatePasswordData>({
        error: "Use a password of at least 8 characters.",
      }, { status: 400 });
    }

    const { supabase, pending } = createSupabaseServerClient(ctx.req);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return commitSupabaseResponse(
        await ctx.render(
          <UpdatePasswordView error="Your password could not be updated." />,
          { status: 400 },
        ),
        pending,
      );
    }

    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: { location: "/account" },
      }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <UpdatePasswordView {...data} />
));
