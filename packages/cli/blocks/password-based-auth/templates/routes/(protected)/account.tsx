import { define } from "../../utils.ts";
import type { SupabaseAuthState } from "../../lib/supabase/require_user.ts";

export default define.page(({ state }) => {
  const { supabaseUser } = state as SupabaseAuthState;
  return (
    <main class="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <section class="card bg-base-100 shadow-xl">
        <div class="card-body gap-6">
          <div>
            <p class="text-sm font-semibold uppercase tracking-wide text-primary">
              Protected route
            </p>
            <h1 class="card-title mt-1 text-3xl">Your account</h1>
          </div>
          <dl class="rounded-box bg-base-200 p-5">
            <dt class="text-sm text-base-content/60">Signed in as</dt>
            <dd class="mt-1 break-all font-medium">
              {supabaseUser.email ?? supabaseUser.id}
            </dd>
          </dl>
          <form method="post" action="/auth/sign-out">
            <button class="btn btn-outline" type="submit">Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
});
