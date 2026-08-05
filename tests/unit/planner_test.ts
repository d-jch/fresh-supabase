import { join } from "node:path";
import { createInstallPlan } from "../../packages/cli/src/planner.ts";
import { assert, assertEquals } from "./assert.ts";
import { snapshotProject, withTestProject } from "./test_project.ts";

Deno.test("password auth dry-run orders dependencies deterministically", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const plan = await createInstallPlan(root, "password-based-auth");
    assertEquals(plan.blocks.map((block) => block.name), [
      "supabase-client",
      "daisyui",
      "password-based-auth",
    ]);
    assertEquals(plan.issues, []);
    assert(plan.operations.length > 10, "expected a complete auth plan");
  });
});

Deno.test("supabase-client plans without Tailwind", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createInstallPlan(root, "supabase-client");
    assertEquals(plan.issues, []);
  });
});

Deno.test("daisyui safely rejects a project without Tailwind", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createInstallPlan(root, "daisyui");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" && issue.message.startsWith("tailwind-4:")
      ),
      "missing Tailwind requirement issue",
    );
  });
});

Deno.test("planner reports file conflicts before execution", async () => {
  await withTestProject({}, async (root) => {
    await Deno.mkdir(join(root, "lib", "supabase"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "lib", "supabase", "client.ts"),
      "// user file\n",
    );
    const plan = await createInstallPlan(root, "supabase-client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" &&
        issue.message === "lib/supabase/client.ts already exists"
      ),
      "missing file conflict",
    );
    assertEquals(plan.partialInstallation, true);
  });
});

Deno.test("planner rejects an incompatible dependency alias", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.imports["@supabase/supabase-js"] = "npm:some-other-package@1.0.0";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );

    const plan = await createInstallPlan(root, "supabase-client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" &&
        issue.message.includes("npm:some-other-package@1.0.0")
      ),
      "missing dependency alias conflict",
    );
    const dependency = plan.operations.find((planned) =>
      planned.operation.kind === "dependency.ensure" &&
      planned.operation.alias === "@supabase/supabase-js"
    );
    assertEquals(dependency?.state, "conflict");
  });
});

Deno.test("planner detects a safe partial installation", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.imports["@supabase/supabase-js"] =
      "npm:@supabase/supabase-js@^2.112.0";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );
    await Deno.writeTextFile(
      join(root, ".env.example"),
      "FRESH_PUBLIC_SUPABASE_URL=https://existing.example.test\n",
    );

    const plan = await createInstallPlan(root, "supabase-client");
    assertEquals(plan.issues, []);
    assertEquals(plan.partialInstallation, true);
    assertEquals(
      plan.operations.filter((planned) => planned.state === "satisfied").length,
      2,
    );
    assert(
      plan.operations.some((planned) => planned.state === "pending"),
      "missing pending operations",
    );
  });
});

Deno.test("planner inspects CSS content and ignores commented directives", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "assets", "styles.css"),
      '@import "tailwindcss";\n/* @plugin "daisyui"; */\n',
    );
    const plan = await createInstallPlan(root, "daisyui");
    const css = plan.operations.find((planned) =>
      planned.operation.kind === "css.ensure"
    );
    assertEquals(css?.state, "pending");
  });
});

Deno.test("planner rejects ambiguous duplicate environment entries", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, ".env.example"),
      `FRESH_PUBLIC_SUPABASE_URL=https://one.example.test
FRESH_PUBLIC_SUPABASE_URL=https://two.example.test
`,
    );
    const plan = await createInstallPlan(root, "supabase-client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" && issue.message.includes("duplicate")
      ),
      "missing duplicate environment conflict",
    );
  });
});

Deno.test("planning performs no project mutation", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const before = await snapshotProject(root);
    await createInstallPlan(root, "password-based-auth");
    const after = await snapshotProject(root);
    assertEquals(after, before);
  });
});

Deno.test({
  name: "planner rejects a project path that escapes through a symlink",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const outside = await Deno.makeTempDir({
      prefix: "fresh-supabase-outside-",
    });
    try {
      await withTestProject({}, async (root) => {
        await Deno.symlink(outside, join(root, "lib"));
        const plan = await createInstallPlan(root, "supabase-client");
        assert(
          plan.issues.some((issue) =>
            issue.kind === "path" && issue.message.includes("symlink")
          ),
          "missing symlink escape issue",
        );
      });
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  },
});
