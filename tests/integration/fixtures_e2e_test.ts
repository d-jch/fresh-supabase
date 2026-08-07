import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExecutablePlan,
  executeInstallPlan,
} from "../../packages/cli/src/executor.ts";
import { createInstallPlan } from "../../packages/cli/src/planner.ts";
import { assert as assertCondition, assertEquals } from "../unit/assert.ts";

const REPOSITORY_ROOT = dirname(
  dirname(dirname(fileURLToPath(import.meta.url))),
);
const UPSTREAM_ROOT = join(REPOSITORY_ROOT, "tests", "fixtures", "upstream");
const MUTATED_ROOT = join(REPOSITORY_ROOT, "tests", "fixtures", "mutated");
const GOLDEN_ROOT = join(REPOSITORY_ROOT, "tests", "golden");
const EXAMPLE_ROOT = join(REPOSITORY_ROOT, "examples", "with-supabase");

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  ).toHex();
}

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  assertCondition(Boolean(condition), message);
}

async function fileHashes(
  directory: string,
  ignoredTopLevel: ReadonlySet<string> = new Set(),
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    const entries = [];
    for await (const entry of Deno.readDir(current)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (current === directory && ignoredTopLevel.has(entry.name)) continue;
      const target = join(current, entry.name);
      if (entry.isDirectory) {
        await visit(target);
      } else if (entry.isFile) {
        hashes[relative(directory, target).replaceAll("\\", "/")] =
          await sha256(
            await Deno.readFile(target),
          );
      } else {
        throw new Error(`unexpected non-file entry: ${target}`);
      }
    }
  };
  await visit(directory);
  return hashes;
}

async function copyTree(
  source: string,
  target: string,
  ignoredTopLevel: ReadonlySet<string> = new Set(),
): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  const entries = [];
  for await (const entry of Deno.readDir(source)) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (source === EXAMPLE_ROOT && ignoredTopLevel.has(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory) {
      await copyTree(sourcePath, targetPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, targetPath);
    } else {
      throw new Error(`unexpected non-file entry: ${sourcePath}`);
    }
  }
}

async function withFixture<T>(
  source: string,
  action: (root: string) => Promise<T>,
): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "fresh-supabase-fixture-" });
  try {
    await copyTree(source, root);
    return await action(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

interface HashProvenance {
  files: Record<string, Record<string, string>>;
}

async function verifyHashProvenance(
  root: string,
  provenance: HashProvenance,
): Promise<void> {
  for (const [directory, expected] of Object.entries(provenance.files)) {
    assertEquals(await fileHashes(join(root, directory)), expected, directory);
  }
}

Deno.test("committed fixtures are pinned and match their provenance", async () => {
  const upstream = await readJson<
    HashProvenance & {
      denoVersion: string;
      freshVersion: string;
      initializer: {
        package: string;
        commit: string;
        module: string;
        moduleSha256: string;
      };
      pinnedFavicon: { source: string; sha256: string };
      generation: {
        command: string;
        dependencyInstallSkipped: boolean;
        latestResolutionDisabled: boolean;
      };
    }
  >(join(UPSTREAM_ROOT, "provenance.json"));
  assertEquals(upstream.denoVersion, "2.9.3");
  assertEquals(upstream.freshVersion, "2.3.3");
  assertEquals(upstream.initializer.package, "@fresh/init@2.3.3");
  assertEquals(
    upstream.initializer.commit,
    "39b5f06f8a7d7fa02dd2e2950f2291d04ef9fea7",
  );
  assertEquals(
    upstream.initializer.module,
    "https://jsr.io/@fresh/init/2.3.3/src/init.ts",
  );
  assertEquals(
    upstream.initializer.moduleSha256,
    "38b132e97fb71953d1304f975a21d9ca14436926513585e5e403f4c723dc2848",
  );
  assertEquals(
    upstream.pinnedFavicon.source,
    "https://raw.githubusercontent.com/denoland/fresh/2.3.3/packages/init/src/assets/favicon.ico",
  );
  assertEquals(
    upstream.pinnedFavicon.sha256,
    "ceefc31bd51194e03c78f9d35f9ca4d8b474b01280f83cd1490fb96a87c0dd12",
  );
  assertEquals(
    upstream.generation.command,
    "deno run --no-config --no-lock --allow-env --allow-net=jsr.io,raw.githubusercontent.com --allow-read --allow-write scripts/generate_upstream_fixtures.ts",
  );
  assertEquals(upstream.generation.dependencyInstallSkipped, true);
  assertEquals(upstream.generation.latestResolutionDisabled, true);
  await verifyHashProvenance(UPSTREAM_ROOT, upstream);

  const noTailwind = await readJson<Record<string, unknown>>(
    join(UPSTREAM_ROOT, "fresh-2.3.3-no-tailwind", "deno.json"),
  );
  const tailwind = await readJson<Record<string, unknown>>(
    join(UPSTREAM_ROOT, "fresh-2.3.3-tailwind", "deno.json"),
  );
  const noTailwindImports = noTailwind.imports as Record<string, string>;
  const tailwindImports = tailwind.imports as Record<string, string>;
  assertEquals(noTailwindImports.fresh, "jsr:@fresh/core@^2.3.3");
  assertEquals(tailwindImports.fresh, "jsr:@fresh/core@^2.3.3");
  assertEquals(noTailwindImports.tailwindcss, undefined);
  assertEquals(tailwindImports.tailwindcss, "npm:tailwindcss@^4.1.10");

  const mutated = await readJson<HashProvenance>(
    join(MUTATED_ROOT, "provenance.json"),
  );
  await verifyHashProvenance(MUTATED_ROOT, mutated);
  const golden = await readJson<HashProvenance>(
    join(GOLDEN_ROOT, "provenance.json"),
  );
  await verifyHashProvenance(GOLDEN_ROOT, golden);

  const workflow = await Deno.readTextFile(
    join(REPOSITORY_ROOT, ".github", "workflows", "quality.yml"),
  );
  assert(!workflow.includes("generate_upstream_fixtures"));
  assert(!workflow.includes("generate_golden_and_example"));
  assert(!workflow.includes("@fresh/init"));
});

Deno.test("mutated fixtures exercise existing-project safety cases", async () => {
  await withFixture(join(MUTATED_ROOT, "existing-daisyui"), async (root) => {
    const plan = await createInstallPlan(root, "daisyui");
    assertEquals(plan.issues, []);
    assert(
      plan.operations.every((operation) => operation.state === "satisfied"),
    );
    assertEquals(plan.partialInstallation, false);
  });

  await withFixture(join(MUTATED_ROOT, "existing-auth-route"), async (root) => {
    const before = await fileHashes(root);
    const plan = await createInstallPlan(root, "password-based-auth");
    assert(
      plan.issues.some((issue) =>
        issue.kind === "conflict" && issue.message.includes("login.tsx")
      ),
    );
    assertEquals(await fileHashes(root), before, "preflight must not write");
  });

  await withFixture(
    join(MUTATED_ROOT, "commented-deno-jsonc"),
    async (root) => {
      const executable = await createExecutablePlan(
        root,
        "client",
        "0.2.0",
      );
      assertEquals(executable.installPlan.issues, []);
      await executeInstallPlan(executable);
      const config = await Deno.readTextFile(join(root, "deno.jsonc"));
      assert(config.includes("// Keep dependency installation explicit."));
      assert(config.includes("// The installer must preserve comments"));
      await Deno.lstat(join(root, "deno.json")).then(
        () => {
          throw new Error(
            "installer must not create deno.json beside deno.jsonc",
          );
        },
        (error) => assert(error instanceof Deno.errors.NotFound),
      );
    },
  );

  await withFixture(
    join(MUTATED_ROOT, "missing-tailwind-plugin"),
    async (root) => {
      const before = await fileHashes(root);
      const plan = await createInstallPlan(root, "password-based-auth");
      assert(
        plan.issues.some((issue) =>
          issue.kind === "requirement" && issue.message.includes("tailwind-4")
        ),
      );
      assertEquals(
        await fileHashes(root),
        before,
        "failed preflight must not write",
      );
    },
  );

  await withFixture(
    join(MUTATED_ROOT, "partial-installation"),
    async (root) => {
      const executable = await createExecutablePlan(
        root,
        "client",
        "0.2.0",
      );
      assertEquals(executable.installPlan.issues, []);
      assert(executable.installPlan.partialInstallation);
      assert(
        executable.installPlan.operations.some((operation) =>
          operation.state === "satisfied" &&
          operation.operation.kind === "file.create" &&
          operation.operation.path === "lib/supabase/client.ts"
        ),
      );
      await executeInstallPlan(executable);
      const repeated = await createExecutablePlan(
        root,
        "client",
        "0.2.0",
      );
      assertEquals((await executeInstallPlan(repeated)).changed, false);
    },
  );
});

Deno.test("fresh installations match committed golden projects", async () => {
  for (
    const testCase of [
      {
        source: "fresh-2.3.3-no-tailwind",
        block: "client",
        golden: "client",
      },
      {
        source: "fresh-2.3.3-tailwind",
        block: "password-based-auth",
        golden: "password-based-auth",
      },
    ]
  ) {
    await withFixture(join(UPSTREAM_ROOT, testCase.source), async (root) => {
      const executable = await createExecutablePlan(
        root,
        testCase.block,
        "0.2.0",
      );
      assertEquals(executable.installPlan.issues, []);
      await executeInstallPlan(executable);
      assertEquals(
        await fileHashes(root),
        await fileHashes(join(GOLDEN_ROOT, testCase.golden)),
        testCase.golden,
      );
    });
  }
});

Deno.test("generated example has reviewed server-first structure", async () => {
  const provenance = await readJson<{
    denoVersion: string;
    requestedBlock: string;
    standaloneLockSha256: string;
    files: Record<string, string>;
  }>(join(REPOSITORY_ROOT, "examples", "provenance.json"));
  assertEquals(provenance.denoVersion, "2.9.3");
  assertEquals(provenance.requestedBlock, "password-based-auth");
  assertEquals(
    await fileHashes(EXAMPLE_ROOT, new Set(["_fresh", "node_modules"])),
    provenance.files,
  );
  assertEquals(
    await sha256(await Deno.readFile(join(EXAMPLE_ROOT, "deno.lock"))),
    provenance.standaloneLockSha256,
  );

  const manifest = await readJson<{
    blocks: Array<{ name: string; version: string }>;
  }>(join(EXAMPLE_ROOT, ".fresh-supabase", "manifest.json"));
  assertEquals(
    manifest.blocks.map((block) => `${block.name}@${block.version}`),
    [
      "client@0.2.0",
      "daisyui@0.2.0",
      "password-based-auth@0.2.0",
    ],
  );

  for (
    const path of [
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
    ]
  ) {
    assert(
      (await Deno.stat(join(EXAMPLE_ROOT, ...path.split("/")))).isFile,
      path,
    );
  }
  for (const [path] of Object.entries(provenance.files)) {
    if (!/\.[tj]sx?$/.test(path)) continue;
    assert(
      !(await Deno.readTextFile(join(EXAMPLE_ROOT, ...path.split("/"))))
        .includes(
          "@fresh-supabase/cli",
        ),
      `${path} must not import the CLI at runtime`,
    );
  }

  const golden = await fileHashes(join(GOLDEN_ROOT, "password-based-auth"));
  const example = { ...provenance.files };
  delete example["README.md"];
  delete example["deno.lock"];
  delete golden["README.md"];
  assertEquals(example, golden);
});

async function commandOutput(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const text = decoder.decode(output.stdout) + decoder.decode(output.stderr);
  assert(output.success, `command failed: deno ${args.join(" ")}\n${text}`);
  return text;
}

Deno.test({
  name:
    "generated example builds cleanly and passes auth smoke on deploy output",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.makeTempDir({
      prefix: "fresh-supabase-example-e2e-",
    });
    try {
      await copyTree(
        EXAMPLE_ROOT,
        root,
        new Set(["_fresh", "node_modules"]),
      );
      await commandOutput(["install", "--frozen"], root);
      const projectCheck = await commandOutput(["task", "check"], root);
      assert(projectCheck.includes("Checked"), projectCheck);
      const normalBuild = await commandOutput(["task", "build"], root);
      assert(normalBuild.includes("built in"), normalBuild);
      assert((await Deno.stat(join(root, "_fresh", "server.js"))).isFile);

      const deployBuild = await commandOutput(
        ["task", "build"],
        root,
        { DENO_DEPLOYMENT_ID: "phase4-integration" },
      );
      assert(deployBuild.includes("built in"), deployBuild);

      const smoke = await commandOutput(
        [
          "test",
          "--no-config",
          "--allow-env",
          "--allow-read",
          "--allow-net",
          join(
            REPOSITORY_ROOT,
            "tests",
            "integration",
            "harnesses",
            "password_auth_smoke_harness.ts",
          ),
        ],
        root,
        { GENERATED_PROJECT_ROOT: root },
      );
      assert(smoke.includes("1 passed"), smoke);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
