import { join } from "node:path";
import { createInstallPlan } from "../../packages/cli/src/planner.ts";
import { assert, assertEquals } from "./assert.ts";
import { snapshotProject, withTestProject } from "./test_project.ts";

Deno.test("password auth dry-run orders dependencies deterministically", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const plan = await createInstallPlan(root, "password-based-auth");
    assertEquals(plan.blocks.map((block) => block.name), [
      "client",
      "daisyui",
      "password-based-auth",
    ]);
    assertEquals(plan.issues, []);
    assert(plan.operations.length > 10, "expected a complete auth plan");
  });
});

Deno.test("client plans without Tailwind", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createInstallPlan(root, "client");
    assertEquals(plan.issues, []);
  });
});

Deno.test("client rejects a project that could commit .env", async () => {
  await withTestProject({ envIgnored: false }, async (root) => {
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" &&
        issue.message.startsWith("env-file-ignored:")
      ),
      "missing .env ignore requirement issue",
    );
  });
});

Deno.test("client rejects a project without the Fresh root alias", async () => {
  await withTestProject({ rootAlias: false }, async (root) => {
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" &&
        issue.message.startsWith("fresh-root-alias:")
      ),
      "missing Fresh root alias requirement issue",
    );
  });
});

Deno.test("client rejects a malformed Deno exclude setting", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.exclude = "supabase/.temp/**";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );

    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" &&
        issue.message === "Deno config exclude must be an array of strings"
      ),
      "malformed exclude should block installation",
    );
  });
});

Deno.test("block-level downgrade protection covers blocks without files", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.mkdir(join(root, ".fresh-supabase"));
    await Deno.writeTextFile(
      join(root, ".fresh-supabase", "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          cliVersion: "0.3.0",
          blocks: [{ name: "daisyui", version: "0.3.0" }],
          operations: [],
        },
        null,
        2,
      ) + "\n",
    );

    const plan = await createInstallPlan(root, "daisyui");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" &&
        issue.message.includes(
          "installed daisyui@0.3.0 is newer than requested daisyui@0.2.0",
        )
      ),
      "a configuration-only block downgrade must be rejected",
    );
    assert(
      plan.operations.every((operation) => operation.state === "conflict"),
      "every operation in a downgraded block must be classified as conflict",
    );
  });
});

Deno.test("client rejects a custom Fresh route directory", async () => {
  await withTestProject({ routeDir: "./src/routes" }, async (root) => {
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" &&
        issue.message.startsWith("fresh-default-routes:")
      ),
      "missing default Fresh routes requirement issue",
    );
  });
});

Deno.test("client rejects an app without file-system routes", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const app = new App();
app.use(staticFiles());
`,
    );
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" &&
        issue.message.startsWith("fresh-file-routes:")
      ),
      "missing Fresh file-routes requirement issue",
    );
  });
});

Deno.test("client rejects a missing Fresh define helper", async () => {
  await withTestProject({ defineHelper: false }, async (root) => {
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "requirement" &&
        issue.message.startsWith("fresh-define-helper:")
      ),
      "missing Fresh define helper requirement issue",
    );
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
    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" &&
        issue.message ===
          "lib/supabase/client.ts already exists with different content"
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

    const plan = await createInstallPlan(root, "client");
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

Deno.test("planner preserves a provably compatible newer host dependency", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.imports["@supabase/supabase-js"] =
      "npm:@supabase/supabase-js@^2.120.0";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );

    const plan = await createInstallPlan(root, "client");
    assertEquals(plan.issues, []);
    const dependency = plan.operations.find((planned) =>
      planned.operation.kind === "dependency.ensure" &&
      planned.operation.alias === "@supabase/supabase-js"
    );
    assertEquals(dependency?.state, "satisfied");
    assert(
      dependency?.detail.includes("compatible host dependency") === true,
      "compatible dependency detail is missing",
    );
  });
});

Deno.test("planner rejects a broader caret range below the required floor", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.imports["@supabase/ssr"] = "npm:@supabase/ssr@^0.11.0";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );

    const plan = await createInstallPlan(root, "client");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" && issue.message.includes("^0.11.0")
      ),
      "older host range must remain a conflict",
    );
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

    const plan = await createInstallPlan(root, "client");
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
    const plan = await createInstallPlan(root, "client");
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
        const plan = await createInstallPlan(root, "client");
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
