import { VERSION } from "../../packages/cli/main.ts";
import cliConfig from "../../packages/cli/deno.json" with { type: "json" };
import { assert } from "./assert.ts";
import { withTestProject } from "./test_project.ts";

const cliUrl = new URL("../../packages/cli/main.ts", import.meta.url);
const decoder = new TextDecoder();

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCliIn(
  cwd: string | undefined,
  ...args: string[]
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      "--allow-read",
      "--allow-write",
      cliUrl.href,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();

  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

function runCli(...args: string[]): Promise<CliResult> {
  return runCliIn(undefined, ...args);
}

Deno.test("--help prints the CLI contract", async () => {
  const result = await runCli("--help");

  assert(result.code === 0, `expected exit code 0, got ${result.code}`);
  assert(result.stderr === "", `expected empty stderr, got ${result.stderr}`);
  assert(result.stdout.includes("fresh-supabase"), "missing CLI name");
  assert(result.stdout.includes("--help"), "missing --help option");
  assert(result.stdout.includes("--version"), "missing --version option");
  for (const command of ["doctor", "list", "view", "add", "--dry-run"]) {
    assert(result.stdout.includes(command), `missing ${command} command`);
  }
  assert(
    result.stdout.includes("preflight checks finish"),
    "missing preflight notice",
  );
});

Deno.test("no arguments prints help", async () => {
  const result = await runCli();

  assert(result.code === 0, `expected exit code 0, got ${result.code}`);
  assert(result.stderr === "", `expected empty stderr, got ${result.stderr}`);
  assert(result.stdout.includes("Usage:"), "missing help usage");
});

Deno.test("--version prints the package version", async () => {
  const result = await runCli("--version");

  assert(
    VERSION === cliConfig.version,
    `CLI version ${VERSION} does not match package version ${cliConfig.version}`,
  );
  assert(cliConfig.lock === false, "published CLI must not create a lockfile");
  assert(result.code === 0, `expected exit code 0, got ${result.code}`);
  assert(result.stderr === "", `expected empty stderr, got ${result.stderr}`);
  assert(
    result.stdout === `fresh-supabase ${VERSION}\n`,
    `unexpected version output: ${result.stdout}`,
  );
});

Deno.test("unsupported arguments fail without pretending to run a command", async () => {
  const result = await runCli("unknown-command");

  assert(result.code === 1, `expected exit code 1, got ${result.code}`);
  assert(result.stdout === "", `expected empty stdout, got ${result.stdout}`);
  assert(
    result.stderr.includes("Unknown command: unknown-command"),
    `unexpected stderr: ${result.stderr}`,
  );
});

Deno.test("list and view expose the embedded catalog", async () => {
  const list = await runCli("list");
  assert(list.code === 0, `list failed: ${list.stderr}`);
  for (const block of ["daisyui", "client", "password-based-auth"]) {
    assert(list.stdout.includes(block), `list is missing ${block}`);
  }

  const view = await runCli("view", "password-based-auth");
  assert(view.code === 0, `view failed: ${view.stderr}`);
  assert(
    view.stdout.includes("Dependencies: client, daisyui"),
    view.stdout,
  );
  assert(view.stdout.includes("file.create"), view.stdout);
});

Deno.test("doctor verifies an official-shape Fresh Tailwind project", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const result = await runCliIn(root, "doctor");
    assert(result.code === 0, `doctor failed: ${result.stderr}`);
    assert(result.stdout.includes("Fresh 2"), result.stdout);
    assert(result.stdout.includes("Tailwind 4"), result.stdout);
    assert(result.stdout.includes("OK"), result.stdout);
  });
});

Deno.test("doctor fails when the Fresh scaffold contract is incomplete", async () => {
  await withTestProject({ rootAlias: false }, async (root) => {
    const result = await runCliIn(root, "doctor");
    assert(result.code === 1, `doctor unexpectedly passed: ${result.stdout}`);
    assert(result.stdout.includes("Root alias"), result.stdout);
    assert(result.stdout.includes("MISSING"), result.stdout);
  });
});

Deno.test("add --dry-run prints a full plan and does not install", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const result = await runCliIn(
      root,
      "add",
      "password-based-auth",
      "--dry-run",
    );
    assert(
      result.code === 0,
      `dry-run failed: ${result.stderr}\n${result.stdout}`,
    );
    assert(result.stdout.includes("1. client"), result.stdout);
    assert(result.stdout.includes("2. daisyui"), result.stdout);
    assert(result.stdout.includes("3. password-based-auth"), result.stdout);
    assert(result.stdout.includes("Preflight: PASS"), result.stdout);
    assert(result.stdout.includes("No files were changed."), result.stdout);

    const repeated = await runCliIn(
      root,
      "add",
      "password-based-auth",
      "--dry-run",
    );
    assert(repeated.stdout === result.stdout, "dry-run output is not stable");
  });
});

Deno.test("add accepts multiple blocks and deduplicates their dependency closure", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const result = await runCliIn(
      root,
      "add",
      "client",
      "password-based-auth",
      "--dry-run",
    );
    assert(result.code === 0, result.stderr + result.stdout);
    assert(
      result.stdout.includes(
        "Dry run: client, password-based-auth",
      ),
      result.stdout,
    );
    assert(result.stdout.includes("1. client"), result.stdout);
    assert(result.stdout.includes("2. daisyui"), result.stdout);
    assert(result.stdout.includes("3. password-based-auth"), result.stdout);
    assert(!result.stdout.includes("4. client"), result.stdout);
  });
});

Deno.test("add installs a base block and a repeat is unchanged", async () => {
  await withTestProject({}, async (root) => {
    const installed = await runCliIn(root, "add", "client");
    assert(installed.code === 0, installed.stderr + installed.stdout);
    assert(
      installed.stdout.includes("Installed client"),
      installed.stdout,
    );
    assert(installed.stdout.includes("manifest.json"), installed.stdout);

    const repeated = await runCliIn(root, "add", "client");
    assert(repeated.code === 0, repeated.stderr + repeated.stdout);
    assert(repeated.stdout.includes("already installed"), repeated.stdout);
  });
});
