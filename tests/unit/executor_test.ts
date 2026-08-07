import { join } from "node:path";
import {
  createExecutablePlan,
  type ExecutableMutation,
  executeInstallPlan,
  MANIFEST_PATH,
  recoverInterruptedInstall,
} from "../../packages/cli/src/executor.ts";
import { runCli, VERSION } from "../../packages/cli/main.ts";
import { createInstallPlan } from "../../packages/cli/src/planner.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";
import { snapshotProject, withTestProject } from "./test_project.ts";

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

async function sha256Text(content: string): Promise<string> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
  ).toHex();
}

async function writeLegacySupabaseClientState(
  root: string,
  clientContent: string,
  staleContent: string,
  staleCurrent = staleContent,
): Promise<void> {
  await Deno.mkdir(join(root, "lib", "supabase"), { recursive: true });
  await Deno.mkdir(join(root, ".fresh-supabase"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "lib", "supabase", "client.ts"),
    clientContent,
  );
  await Deno.writeTextFile(
    join(root, "lib", "supabase", "env.ts"),
    staleCurrent,
  );
  await Deno.writeTextFile(
    join(root, ".fresh-supabase", "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cliVersion: "0.1.1",
        blocks: [{ name: "supabase-client", version: "0.1.0" }],
        operations: [{
          block: "supabase-client",
          key: "file:lib/supabase/client.ts",
          kind: "file.create",
          target: "lib/supabase/client.ts",
          contentHash: await sha256Text(clientContent),
        }, {
          block: "supabase-client",
          key: "file:lib/supabase/env.ts",
          kind: "file.create",
          target: "lib/supabase/env.ts",
          contentHash: await sha256Text(staleContent),
        }],
      },
      null,
      2,
    ) + "\n",
  );
}

Deno.test("client executes without Tailwind and is idempotent", async () => {
  await withTestProject({}, async (root) => {
    const first = await createExecutablePlan(root, "client", VERSION);
    assertEquals(first.installPlan.issues, []);
    assert(first.mutations.length > 1, "expected executable mutations");
    assert(
      first.mutations.every((mutation) =>
        typeof mutation.afterHash === "string" &&
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
    assertEquals(config.exclude, ["supabase/.temp/**"]);
    assert(
      (await Deno.stat(join(root, "lib", "supabase", "server.ts"))).isFile,
      "server client was not created",
    );
    const manifestBefore = await Deno.readTextFile(
      join(root, ...MANIFEST_PATH.split("/")),
    );
    const snapshotBefore = await snapshotProject(root);

    const second = await createExecutablePlan(root, "client", VERSION);
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

Deno.test("0.2 migrates the renamed client block and upgrades managed files", async () => {
  await withTestProject({}, async (root) => {
    const oldClient = "// managed client from 0.1\n";
    const oldEnv = "// managed env helper from 0.1\n";
    await writeLegacySupabaseClientState(root, oldClient, oldEnv);

    const plan = await createExecutablePlan(root, "client", VERSION);
    assertEquals(plan.installPlan.issues, []);
    assert(
      plan.installPlan.removals.some((removal) =>
        removal.path === "lib/supabase/env.ts" && removal.state === "pending"
      ),
      "legacy env helper was not planned for cleanup",
    );
    assert(
      plan.mutations.some((mutation) =>
        mutation.path === "lib/supabase/client.ts" && mutation.content !== null
      ),
      "unchanged managed client was not planned for upgrade",
    );
    assert(
      plan.mutations.some((mutation) =>
        mutation.path === "lib/supabase/env.ts" && mutation.content === null
      ),
      "stale managed helper was not planned for deletion",
    );

    await executeInstallPlan(plan);
    assert(
      (await Deno.readTextFile(join(root, "lib", "supabase", "client.ts")))
        .includes("createSupabaseBrowserClient"),
      "client was not upgraded",
    );
    await Deno.lstat(join(root, "lib", "supabase", "env.ts")).then(
      () => {
        throw new Error("stale managed helper was not removed");
      },
      (error) => assert(error instanceof Deno.errors.NotFound, String(error)),
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(join(root, ...MANIFEST_PATH.split("/"))),
    );
    assertEquals(manifest.blocks, [{ name: "client", version: VERSION }]);
    assert(
      manifest.operations.every(
        (operation: { block: string }) => operation.block === "client",
      ),
      "legacy operation ownership was not migrated to client",
    );
  });
});

Deno.test("0.2 refuses to remove a stale managed file with user changes", async () => {
  await withTestProject({}, async (root) => {
    const oldClient = "// managed client from 0.1\n";
    const oldEnv = "// managed env helper from 0.1\n";
    await writeLegacySupabaseClientState(
      root,
      oldClient,
      oldEnv,
      oldEnv + "// user change\n",
    );
    const before = await snapshotProject(root);
    const plan = await createExecutablePlan(root, "client", VERSION);
    assert(
      plan.installPlan.issues.some((issue) =>
        issue.message.includes("user changes; refusing removal")
      ),
      "user-edited stale file did not block cleanup",
    );
    assertEquals(plan.mutations, []);
    assertEquals(await snapshotProject(root), before);
  });
});

Deno.test("a missing managed file cannot bypass block downgrade protection", async () => {
  await withTestProject({}, async (root) => {
    await Deno.mkdir(join(root, ".fresh-supabase"));
    await Deno.writeTextFile(
      join(root, ".fresh-supabase", "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          cliVersion: "0.3.0",
          blocks: [{ name: "client", version: "0.3.0" }],
          operations: [{
            block: "client",
            key: "file:lib/supabase/client.ts",
            kind: "file.create",
            target: "lib/supabase/client.ts",
            contentHash: "0".repeat(64),
          }],
        },
        null,
        2,
      ) + "\n",
    );

    const plan = await createExecutablePlan(root, "client", VERSION);
    assert(
      plan.installPlan.issues.some((issue) =>
        issue.message.includes(
          "installed client@0.3.0 is newer than requested client@0.2.0",
        )
      ),
      "missing target did not trigger block downgrade protection",
    );
    assertEquals(plan.mutations, []);
    assertEquals(plan.manifest, null);
    await Deno.lstat(join(root, "lib", "supabase", "client.ts")).then(
      () => {
        throw new Error("downgrade unexpectedly recreated the missing file");
      },
      (error) => assert(error instanceof Deno.errors.NotFound, String(error)),
    );
  });
});

Deno.test("rollback restores a managed file deleted during upgrade", async () => {
  await withTestProject({}, async (root) => {
    await writeLegacySupabaseClientState(
      root,
      "// managed client from 0.1\n",
      "// managed env helper from 0.1\n",
    );
    const before = await snapshotProject(root);
    const plan = await createExecutablePlan(root, "client", VERSION);
    await assertRejects(
      () =>
        executeInstallPlan(plan, {
          afterMutation(_index, mutation) {
            if (mutation.content === null) throw new Error("after deletion");
          },
        }),
      "installer changes were restored",
    );
    assertEquals(await snapshotProject(root), before);
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

Deno.test("client also executes in a Tailwind project", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const plan = await createExecutablePlan(root, "client", VERSION);
    assertEquals(plan.installPlan.issues, []);
    const result = await executeInstallPlan(plan);
    assert(result.changed, "Tailwind fixture was not installed");
  });
});

Deno.test("executor preserves a commented deno.jsonc", async () => {
  await withTestProject({ jsonc: true }, async (root) => {
    const plan = await createExecutablePlan(root, "client", VERSION);
    assertEquals(plan.installPlan.issues, []);
    await executeInstallPlan(plan);
    const source = await Deno.readTextFile(join(root, "deno.jsonc"));
    assert(
      source.includes("Fresh project config"),
      "JSONC comment was removed",
    );
    assert(source.includes('"@supabase/ssr"'), "SSR import is missing");
    assert(source.includes('"@supabase/supabase-js"'), "JS import is missing");
    assert(
      source.includes('"supabase/.temp/**"'),
      "Supabase CLI temp exclusion is missing",
    );
  });
});

Deno.test("failure after the first mutation restores the project", async () => {
  await withTestProject({}, async (root) => {
    const before = await snapshotProject(root);
    const plan = await createExecutablePlan(root, "client", VERSION);
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
    const plan = await createExecutablePlan(root, "client", VERSION);
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
    const plan = await createExecutablePlan(root, "client", VERSION);
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
    const plan = await createExecutablePlan(root, "client", VERSION);
    const mutation = plan.mutations.find((entry) =>
      entry.path === "deno.json"
    )!;
    await writeJournal(root, [mutation]);
    await Deno.writeTextFile(
      join(root, mutation.path),
      mutation.content! + " ",
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
    const plan = await createExecutablePlan(root, "client", VERSION);
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
      configMutation.content!,
    );
    await Deno.writeTextFile(
      join(root, mutation.path),
      mutation.content! + "# user change after interruption\n",
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
      "client",
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
    await Deno.writeTextFile(join(root, first.path), first.content!);

    const dryRunSnapshot = await snapshotProject(root);
    const dryRun = await createInstallPlan(root, "client");
    assert(
      dryRun.issues.some((issue) => issue.message.includes("interrupted")),
      "dry-run did not report the journal",
    );
    assertEquals(await snapshotProject(root), dryRunSnapshot);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["add", "client"], {
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
      "client",
      VERSION,
    );
    assertEquals(repeated.mutations, []);
  });
});
