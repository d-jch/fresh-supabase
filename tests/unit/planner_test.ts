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
