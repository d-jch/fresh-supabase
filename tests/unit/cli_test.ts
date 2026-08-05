import { VERSION } from "../../packages/cli/main.ts";
import cliConfig from "../../packages/cli/deno.json" with { type: "json" };

const cliUrl = new URL("../../packages/cli/main.ts", import.meta.url);
const decoder = new TextDecoder();

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(...args: string[]): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--quiet", cliUrl.href, ...args],
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

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("--help prints the Phase 0 CLI contract", async () => {
  const result = await runCli("--help");

  assert(result.code === 0, `expected exit code 0, got ${result.code}`);
  assert(result.stderr === "", `expected empty stderr, got ${result.stderr}`);
  assert(result.stdout.includes("fresh-supabase"), "missing CLI name");
  assert(result.stdout.includes("--help"), "missing --help option");
  assert(result.stdout.includes("--version"), "missing --version option");
  assert(
    result.stdout.includes("Phase 0 supports only"),
    "missing Phase 0 scope notice",
  );
});

Deno.test("--version prints the package version", async () => {
  const result = await runCli("--version");

  assert(
    VERSION === cliConfig.version,
    `CLI version ${VERSION} does not match package version ${cliConfig.version}`,
  );
  assert(result.code === 0, `expected exit code 0, got ${result.code}`);
  assert(result.stderr === "", `expected empty stderr, got ${result.stderr}`);
  assert(
    result.stdout === `fresh-supabase ${VERSION}\n`,
    `unexpected version output: ${result.stdout}`,
  );
});
