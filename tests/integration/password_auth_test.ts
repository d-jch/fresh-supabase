import { join } from "node:path";
import {
  createExecutablePlan,
  executeInstallPlan,
} from "../../packages/cli/src/executor.ts";
import { assert, assertEquals } from "../unit/assert.ts";
import { withTestProject } from "../unit/test_project.ts";

const UPSTREAM_ALIGNED_FILES = [
  "routes/auth/login.tsx",
  "routes/auth/error.tsx",
  "routes/protected/index.tsx",
  "routes/auth/confirm.ts",
  "components/auth/login-form.tsx",
  "routes/_middleware.ts",
  "routes/auth/sign-up.tsx",
  "routes/auth/sign-up-success.tsx",
  "components/auth/sign-up-form.tsx",
  "routes/auth/forgot-password.tsx",
  "routes/auth/update-password.tsx",
  "components/auth/forgot-password-form.tsx",
  "components/auth/update-password-form.tsx",
  "components/auth/logout-button.tsx",
  "lib/supabase/client.ts",
  "lib/supabase/middleware.ts",
  "lib/supabase/server.ts",
] as const;

function target(root: string, path: string): string {
  return join(root, ...path.split("/"));
}

async function commandOutput(command: Deno.Command): Promise<string> {
  const output = await command.output();
  const decoder = new TextDecoder();
  const text = decoder.decode(output.stdout) + decoder.decode(output.stderr);
  assert(output.code === 0, `command failed:\n${text}`);
  return text;
}

Deno.test("password auth installs the upstream-aligned 17-file Fresh port", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const machineRoute = target(root, "routes/api/webhook.ts");
    const machineSource =
      'export const handler = () => new Response("machine route");\n';
    await Deno.mkdir(join(machineRoute, ".."), { recursive: true });
    await Deno.writeTextFile(machineRoute, machineSource);

    const executable = await createExecutablePlan(
      root,
      "password-based-auth",
      "0.2.0",
    );
    assertEquals(executable.installPlan.issues, []);
    const result = await executeInstallPlan(executable);
    assert(result.changed, "password auth install should change the project");

    for (const path of UPSTREAM_ALIGNED_FILES) {
      assert((await Deno.stat(target(root, path))).isFile, path);
      assert(
        !(await Deno.readTextFile(target(root, path))).includes(
          "@fresh-supabase/cli",
        ),
        `${path} must not import the CLI at runtime`,
      );
    }
    assertEquals(await Deno.readTextFile(machineRoute), machineSource);

    for (
      const route of [
        "login.tsx",
        "sign-up.tsx",
        "forgot-password.tsx",
        "update-password.tsx",
      ]
    ) {
      const source = await Deno.readTextFile(
        target(root, `routes/auth/${route}`),
      );
      assert(source.includes("async POST(ctx)"), route);
      assert(!source.includes("islands/"), route);
      assert(
        !source.includes("password.length"),
        `${route} must defer password policy to Supabase`,
      );
    }
    for (
      const component of [
        "login-form.tsx",
        "sign-up-form.tsx",
        "forgot-password-form.tsx",
        "update-password-form.tsx",
      ]
    ) {
      const source = await Deno.readTextFile(
        target(root, `components/auth/${component}`),
      );
      assert(source.includes('<form method="post"'), component);
      assert(!source.includes("useState"), component);
      assert(
        !source.includes("minlength="),
        `${component} must defer password policy to Supabase`,
      );
    }
    const protectedRoute = await Deno.readTextFile(
      target(root, "routes/protected/index.tsx"),
    );
    assert(
      protectedRoute.includes('signOut({ scope: "local" })'),
      "protected POST must perform a local-only sign-out",
    );
    assert(
      protectedRoute.includes("getSupabaseClaims(ctx.state)"),
      "protected GET must reuse middleware-verified claims",
    );
    assert(
      !protectedRoute.includes("auth.getUser"),
      "protected GET must not repeat identity validation over the network",
    );
    const logout = await Deno.readTextFile(
      target(root, "components/auth/logout-button.tsx"),
    );
    assert(
      logout.includes('method="post" action={action}'),
      "logout must use a base-path-aware POST form",
    );

    for (
      const route of [
        "login.tsx",
        "error.tsx",
        "sign-up.tsx",
        "sign-up-success.tsx",
        "forgot-password.tsx",
        "update-password.tsx",
      ]
    ) {
      const source = await Deno.readTextFile(
        target(root, `routes/auth/${route}`),
      );
      assert(source.includes("<Head>"), `${route} must set page metadata`);
    }
    assert(
      protectedRoute.includes("<Head>"),
      "protected page must set page metadata",
    );

    const rootMiddleware = await Deno.readTextFile(
      target(root, "routes/_middleware.ts"),
    );
    assert(rootMiddleware.includes("scopedAuthCsrf"), "missing scoped CSRF");
    assert(
      rootMiddleware.includes("supabaseSession"),
      "missing session middleware",
    );

    const generatedModules = [
      "utils.ts",
      ...UPSTREAM_ALIGNED_FILES.filter((path) => /\.[tj]sx?$/.test(path)),
    ].map((path) => target(root, path));
    await commandOutput(
      new Deno.Command(Deno.execPath(), {
        args: [
          "check",
          "--config",
          target(root, "deno.json"),
          ...generatedModules,
        ],
        cwd: root,
        stdout: "piped",
        stderr: "piped",
      }),
    );
    const securityOutput = await commandOutput(
      new Deno.Command(Deno.execPath(), {
        args: [
          "test",
          "--config",
          target(root, "deno.json"),
          "--allow-read",
          "--allow-env",
          join(
            Deno.cwd(),
            "tests/integration/harnesses/password_auth_security_harness.ts",
          ),
        ],
        cwd: root,
        env: { GENERATED_PROJECT_ROOT: root },
        stdout: "piped",
        stderr: "piped",
      }),
    );
    assert(
      securityOutput.includes("16 passed"),
      `security harness evidence missing:\n${securityOutput}`,
    );

    const repeated = await createExecutablePlan(
      root,
      "password-based-auth",
      "0.2.0",
    );
    assertEquals(repeated.installPlan.issues, []);
    assertEquals((await executeInstallPlan(repeated)).changed, false);
  });
});
