import { page } from "fresh";
import { Head } from "fresh/runtime";
import { LogoutButton } from "@/components/auth/logout-button.tsx";
import { getSupabaseClaims } from "@/lib/supabase/middleware.ts";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

interface ProtectedData {
  identity: string;
}

function redirectToLogin(basePath: string): Response {
  const search = new URLSearchParams({
    next: withFreshBasePath(basePath, "/protected"),
  });
  return new Response(null, {
    status: 303,
    headers: {
      location: `${withFreshBasePath(basePath, "/auth/login")}?${search}`,
    },
  });
}

export const handler = define.handlers({
  GET(ctx) {
    const claims = getSupabaseClaims(ctx.state);
    if (!claims) return redirectToLogin(ctx.config.basePath);
    const identity = typeof claims.email === "string" && claims.email
      ? claims.email
      : claims.sub ?? "Authenticated user";
    return page<ProtectedData>({ identity });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (form.get("intent") !== "sign-out") {
      return new Response("Unknown action", { status: 400 });
    }
    const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      return commitSupabaseResponse(
        new Response("Sign out could not be completed.", { status: 502 }),
        pending,
      );
    }
    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: {
          location: withFreshBasePath(ctx.config.basePath, "/auth/login"),
        },
      }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ config, data }) => (
  <>
    <Head>
      <title>Your account</title>
    </Head>
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
            <dd class="mt-1 break-all font-medium">{data.identity}</dd>
          </dl>
          <LogoutButton
            action={withFreshBasePath(config.basePath, "/protected")}
          />
        </div>
      </section>
    </main>
  </>
));
