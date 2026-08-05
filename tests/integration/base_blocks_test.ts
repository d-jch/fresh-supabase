import { join } from "node:path";
import {
  createExecutablePlan,
  executeInstallPlan,
} from "../../packages/cli/src/executor.ts";
import { assert, assertEquals } from "../unit/assert.ts";
import { withTestProject } from "../unit/test_project.ts";

Deno.test("generated Supabase base modules type-check", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", "0.1.0");
    assertEquals(plan.installPlan.issues, []);
    await executeInstallPlan(plan);

    const generated = ["env.ts", "client.ts", "server.ts", "response.ts"].map(
      (name) => join(root, "lib", "supabase", name),
    );
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["check", "--config", join(root, "deno.json"), ...generated],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assert(
      output.code === 0,
      `generated module check failed:\n${decoder.decode(output.stdout)}${
        decoder.decode(output.stderr)
      }`,
    );
  });
});
