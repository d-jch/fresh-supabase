import { join } from "node:path";
import {
  createExecutablePlan,
  type ExecutableMutation,
  executeInstallPlan,
  MANIFEST_PATH,
  recoverInterruptedInstall,
} from "../../packages/cli/src/executor.ts";
import { runCli } from "../../packages/cli/main.ts";
import { createInstallPlan } from "../../packages/cli/src/planner.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";
import { snapshotProject, withTestProject } from "./test_project.ts";

const VERSION = "0.1.0";

async function writeJournal(
  root: string,
  mutations: ExecutableMutation[],
  createdDirectories = [".fresh-supabase"],
): Promise<void> {
  await Deno.mkdir(join(root, ".fresh-supabase"), { recursive: true });
  await Deno.writeTextFile(
    join(root, ".fresh-supabase", "install-journal.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        mutations: mutations.map((mutation) => ({
          path: mutation.path,
          beforeExists: mutation.before.exists,
          beforeHash: mutation.before.hash,
          beforeContent: mutation.before.content,
          afterHash: mutation.afterHash,
        })),
        createdDirectories,
      },
      null,
      2,
    ) + "\n",
  );
}

Deno.test("supabase-client executes without Tailwind and is idempotent", async () => {
  await withTestProject({}, async (root) => {
    const first = await createExecutablePlan(root, "supabase-client", VERSION);
    assertEquals(first.installPlan.issues, []);
    assert(first.mutations.length > 1, "expected executable mutations");
    assert(
      first.mutations.every((mutation) =>
        /^[0-9a-f]{64}$/.test(mutation.afterHash)
      ),
      "missing SHA-256 after hash",
    );
    const result = await executeInstallPlan(first);
    assert(result.changed, "first install should change files");

    const config = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
    assertEquals(
      config.imports["@supabase/ssr"],
      "npm:@supabase/ssr@^0.12.4",
    );
    assert(
      (await Deno.stat(join(root, "lib", "supabase", "server.ts"))).isFile,
      "server client was not created",
    );
    const manifestBefore = await Deno.readTextFile(
      join(root, ...MANIFEST_PATH.split("/")),
    );
    const snapshotBefore = await snapshotProject(root);

    const second = await createExecutablePlan(root, "supabase-client", VERSION);
    assertEquals(second.installPlan.issues, []);
    assertEquals(second.mutations, []);
    const repeated = await executeInstallPlan(second);
    assertEquals(repeated.changed, false);
    assertEquals(await snapshotProject(root), snapshotBefore);
    assertEquals(
      await Deno.readTextFile(join(root, ...MANIFEST_PATH.split("/"))),
      manifestBefore,
    );
  });
});

Deno.test("daisyui executes only with verified Tailwind v4", async () => {
  await withTestProject({}, async (root) => {
    const rejected = await createExecutablePlan(root, "daisyui", VERSION);
    assert(
      rejected.installPlan.issues.some((issue) => issue.kind === "requirement"),
      "missing Tailwind requirement failure",
    );
    assertEquals(rejected.mutations, []);
  });

  await withTestProject({ tailwind: true }, async (root) => {
    const plan = await createExecutablePlan(root, "daisyui", VERSION);
    assertEquals(plan.installPlan.issues, []);
    await executeInstallPlan(plan);
    const css = await Deno.readTextFile(join(root, "assets", "styles.css"));
    assert(css.includes('@plugin "daisyui";'), "missing daisyUI directive");
  });
});

Deno.test("supabase-client also executes in a Tailwind project", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    assertEquals(plan.installPlan.issues, []);
    const result = await executeInstallPlan(plan);
    assert(result.changed, "Tailwind fixture was not installed");
  });
});

Deno.test("executor preserves a commented deno.jsonc", async () => {
  await withTestProject({ jsonc: true }, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    assertEquals(plan.installPlan.issues, []);
    await executeInstallPlan(plan);
    const source = await Deno.readTextFile(join(root, "deno.jsonc"));
    assert(
      source.includes("Fresh project config"),
      "JSONC comment was removed",
    );
    assert(source.includes('"@supabase/ssr"'), "SSR import is missing");
    assert(source.includes('"@supabase/supabase-js"'), "JS import is missing");
  });
});

Deno.test("failure after the first mutation restores the project", async () => {
  await withTestProject({}, async (root) => {
    const before = await snapshotProject(root);
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    await assertRejects(
      () =>
        executeInstallPlan(plan, {
          afterMutation(index) {
            if (index === 0) throw new Error("injected failure");
          },
        }),
      "installer changes were restored",
    );
    assertEquals(await snapshotProject(root), before);
  });
});

Deno.test("executor rejects a stale plan before the first installer write", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    const configPath = join(root, "deno.json");
    await Deno.writeTextFile(
      configPath,
      (await Deno.readTextFile(configPath)) + " ",
    );
    await assertRejects(() => executeInstallPlan(plan), "stale plan");
    let manifestExists = true;
    try {
      await Deno.lstat(join(root, ...MANIFEST_PATH.split("/")));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) manifestExists = false;
      else throw error;
    }
    assertEquals(manifestExists, false);
  });
});

Deno.test("malformed existing manifest blocks execution without writes", async () => {
  await withTestProject({}, async (root) => {
    await Deno.mkdir(join(root, ".fresh-supabase"));
    await Deno.writeTextFile(
      join(root, ".fresh-supabase", "manifest.json"),
      "{}\n",
    );
    const before = await snapshotProject(root);
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    assert(
      plan.installPlan.issues.some((issue) =>
        issue.message.includes("manifest")
      ),
      "missing manifest conflict",
    );
    assertEquals(plan.mutations, []);
    assertEquals(await snapshotProject(root), before);
  });
});

Deno.test("stale journal recovery preserves a later edit to an existing file", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    const mutation = plan.mutations.find((entry) =>
      entry.path === "deno.json"
    )!;
    await writeJournal(root, [mutation]);
    await Deno.writeTextFile(
      join(root, mutation.path),
      mutation.content + " ",
    );
    const diverged = await snapshotProject(root);

    await assertRejects(
      () => recoverInterruptedInstall(root),
      "stale recovery",
    );
    assertEquals(await snapshotProject(root), diverged);
  });
});

Deno.test("stale journal recovery does not delete a later-edited created file", async () => {
  await withTestProject({}, async (root) => {
    const plan = await createExecutablePlan(root, "supabase-client", VERSION);
    const mutation = plan.mutations.find((entry) =>
      entry.path === ".env.example"
    )!;
    const configMutation = plan.mutations.find((entry) =>
      entry.path === "deno.json"
    )!;
    assertEquals(mutation.before.exists, false);
    await writeJournal(root, [configMutation, mutation]);
    await Deno.writeTextFile(
      join(root, configMutation.path),
      configMutation.content,
    );
    await Deno.writeTextFile(
      join(root, mutation.path),
      mutation.content + "# user change after interruption\n",
    );
    const diverged = await snapshotProject(root);

    await assertRejects(
      () => recoverInterruptedInstall(root),
      "stale recovery",
    );
    assertEquals(await snapshotProject(root), diverged);
  });
});

Deno.test("dry-run reports a journal and the next add recovers it", async () => {
  await withTestProject({}, async (root) => {
    const interrupted = await createExecutablePlan(
      root,
      "supabase-client",
      VERSION,
    );
    const first = interrupted.mutations[0];
    assert(first.before.exists, "expected the Deno config mutation first");
    await Deno.mkdir(join(root, ".fresh-supabase"));
    await Deno.writeTextFile(
      join(root, ".fresh-supabase", "install-journal.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          mutations: [{
            path: first.path,
            beforeExists: first.before.exists,
            beforeHash: first.before.hash,
            beforeContent: first.before.content,
            afterHash: first.afterHash,
          }],
          createdDirectories: [".fresh-supabase"],
        },
        null,
        2,
      ) + "\n",
    );
    await Deno.writeTextFile(join(root, first.path), first.content);

    const dryRunSnapshot = await snapshotProject(root);
    const dryRun = await createInstallPlan(root, "supabase-client");
    assert(
      dryRun.issues.some((issue) => issue.message.includes("interrupted")),
      "dry-run did not report the journal",
    );
    assertEquals(await snapshotProject(root), dryRunSnapshot);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["add", "supabase-client"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    }, root);
    assertEquals(code, 0, stderr.join("\n"));
    assert(
      stdout.join("\n").includes("Recovered an interrupted"),
      "add did not report recovery",
    );
    const repeated = await createExecutablePlan(
      root,
      "supabase-client",
      VERSION,
    );
    assertEquals(repeated.mutations, []);
  });
});
