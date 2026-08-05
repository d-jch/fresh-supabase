import { join } from "node:path";
import {
  createExecutablePlan,
  executeInstallPlan,
} from "../../packages/cli/src/executor.ts";
import { assert, assertEquals } from "../unit/assert.ts";
import { withTestProject } from "../unit/test_project.ts";

const AUTH_FILES = [
  "lib/supabase/redirect.ts",
  "lib/supabase/require_user.ts",
  "routes/(auth)/_middleware.ts",
  "routes/(auth)/auth/sign-in.tsx",
  "routes/(auth)/auth/sign-up.tsx",
  "routes/(auth)/auth/forgot-password.tsx",
  "routes/(auth)/auth/update-password.tsx",
  "routes/(auth)/auth/confirm.ts",
  "routes/(auth)/auth/sign-out.ts",
  "routes/(protected)/_middleware.ts",
  "routes/(protected)/account.tsx",
  "supabase/templates/confirmation.html",
  "supabase/templates/recovery.html",
];

function target(root: string, path: string): string {
  return join(root, ...path.split("/"));
}

async function commandOutput(command: Deno.Command): Promise<string> {
  const output = await command.output();
  const decoder = new TextDecoder();
  const text = decoder.decode(output.stdout) + decoder.decode(output.stderr);
  assert(
    output.code === 0,
    `command failed:\n${text}`,
  );
  return text;
}

Deno.test("password auth installs server-first routes and security helpers", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const machineRoute = target(root, "routes/api/webhook.ts");
    const machineSource =
      'export const handler = () => new Response("machine route");\n';
    await Deno.mkdir(join(machineRoute, ".."), { recursive: true });
    await Deno.writeTextFile(machineRoute, machineSource);

    const executable = await createExecutablePlan(
      root,
      "password-based-auth",
      "0.1.0",
    );
    assertEquals(executable.installPlan.issues, []);
    const result = await executeInstallPlan(executable);
    assert(result.changed, "password auth install should change the project");

    for (const path of AUTH_FILES) {
      assert((await Deno.stat(target(root, path))).isFile, path);
      assert(
        !(await Deno.readTextFile(target(root, path))).includes(
          "@fresh-supabase/cli",
        ),
        `${path} must not import the CLI at runtime`,
      );
    }
    await Deno.stat(target(root, "routes/_middleware.ts")).then(
      () => {
        throw new Error("auth must not install global middleware");
      },
      (error) =>
        assert(
          error instanceof Deno.errors.NotFound,
          "root middleware should not exist",
        ),
    );
    assertEquals(await Deno.readTextFile(machineRoute), machineSource);

    const formRoutes = [
      "sign-in.tsx",
      "sign-up.tsx",
      "forgot-password.tsx",
      "update-password.tsx",
    ];
    for (const route of formRoutes) {
      const source = await Deno.readTextFile(
        target(root, `routes/(auth)/auth/${route}`),
      );
      assert(source.includes('<form method="post"'), route);
      assert(source.includes("async POST(ctx)"), route);
      assert(source.includes("status: 303"), route);
      assert(!source.includes("islands/"), route);
    }
    const account = await Deno.readTextFile(
      target(root, "routes/(protected)/account.tsx"),
    );
    assert(
      account.includes('method="post" action="/auth/sign-out"'),
      "account sign-out must use a POST form",
    );
    const signOut = await Deno.readTextFile(
      target(root, "routes/(auth)/auth/sign-out.ts"),
    );
    assert(signOut.includes("async POST(ctx)"), "sign-out needs POST handler");
    assert(!signOut.includes("GET(ctx)"), "sign-out must not accept GET");

    for (const group of ["(auth)", "(protected)"]) {
      const middleware = await Deno.readTextFile(
        target(root, `routes/${group}/_middleware.ts`),
      );
      assert(middleware.includes("csrf()"), group);
    }

    const generatedModules = [
      "utils.ts",
      "lib/supabase/env.ts",
      "lib/supabase/client.ts",
      "lib/supabase/server.ts",
      "lib/supabase/response.ts",
      ...AUTH_FILES.filter((path) => /\.[tj]sx?$/.test(path)),
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
      securityOutput.includes("9 passed"),
      `security harness evidence missing:\n${securityOutput}`,
    );

    const repeated = await createExecutablePlan(
      root,
      "password-based-auth",
      "0.1.0",
    );
    assertEquals(repeated.installPlan.issues, []);
    assertEquals((await executeInstallPlan(repeated)).changed, false);
  });
});
