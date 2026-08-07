import { page } from "fresh";
import { Head } from "fresh/runtime";
import { SignUpForm } from "@/components/auth/sign-up-form.tsx";
import {
  commitSupabaseResponse,
  getSupabaseServerContext,
  withFreshBasePath,
} from "@/lib/supabase/server.ts";
import { define } from "@/utils.ts";

interface SignUpData {
  basePath: string;
  error: string | null;
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export const handler = define.handlers({
  GET(ctx) {
    return page<SignUpData>({ basePath: ctx.config.basePath, error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const email = textField(form, "email");
    const password = form.get("password");
    const repeated = form.get("repeat-password");
    const basePath = ctx.config.basePath;
    if (!email || typeof password !== "string" || !password) {
      return page<SignUpData>({
        basePath,
        error: "Enter your email and password.",
      }, { status: 400 });
    }
    if (password !== repeated) {
      return page<SignUpData>({ basePath, error: "Passwords do not match." }, {
        status: 400,
      });
    }

    const { supabase, pending } = getSupabaseServerContext(ctx.state, ctx.req);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${ctx.url.origin}${
          withFreshBasePath(basePath, "/auth/confirm")
        }?next=${
          encodeURIComponent(withFreshBasePath(basePath, "/protected"))
        }`,
      },
    });
    if (error) {
      return page<SignUpData>({
        basePath,
        error: "We could not create that account.",
      }, {
        status: 400,
      });
    }
    return commitSupabaseResponse(
      new Response(null, {
        status: 303,
        headers: {
          location: withFreshBasePath(
            basePath,
            data.session ? "/protected" : "/auth/sign-up-success",
          ),
        },
      }),
      pending,
    );
  },
});

export default define.page<typeof handler>(({ data }) => (
  <>
    <Head>
      <title>Sign up</title>
    </Head>
    <main class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <SignUpForm {...data} />
    </main>
  </>
));
