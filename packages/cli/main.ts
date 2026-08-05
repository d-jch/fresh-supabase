export const VERSION = "0.1.0";

const HELP = `fresh-supabase ${VERSION}

Incremental Supabase blocks for Deno Fresh 2 projects.

Usage:
  fresh-supabase --help
  fresh-supabase --version

Options:
  --help       Show this help message
  --version    Print the CLI version

Phase 0 supports only the options above.
Planned v0.1 commands: doctor, list, view, add, add --dry-run.`;

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export function runCli(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    io.stdout(HELP);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    io.stdout(`fresh-supabase ${VERSION}`);
    return 0;
  }

  io.stderr(
    `Unknown or unsupported arguments: ${args.join(" ")}\n` +
      "Phase 0 supports only --help and --version.",
  );
  return 1;
}

if (import.meta.main) {
  Deno.exit(runCli(Deno.args));
}
