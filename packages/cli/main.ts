import type { BlockDefinition, BlockOperation } from "./src/block.ts";
import { getBlock, listBlocks } from "./src/catalog.ts";
import { createInstallPlan, type InstallPlan } from "./src/planner.ts";
import {
  inspectProject,
  type ProjectInspection,
  ProjectInspectionError,
} from "./src/project.ts";

export const VERSION = "0.1.0";

const HELP = `fresh-supabase ${VERSION}

Incremental Supabase blocks for Deno Fresh 2 projects.

Usage:
  fresh-supabase doctor
  fresh-supabase list
  fresh-supabase view <block>
  fresh-supabase add <block> --dry-run
  fresh-supabase --help
  fresh-supabase --version

Commands:
  doctor                   Inspect Fresh, Vite, Tailwind, and daisyUI capabilities
  list                     List embedded blocks
  view <block>             Show one block definition
  add <block> --dry-run    Preflight and print a deterministic installation plan

Options:
  --help       Show this help message
  --version    Print the CLI version

Phase 1 plans installations but does not write project files.
The add command without --dry-run is intentionally disabled until Phase 2.`;

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

function formatCapability(
  name: string,
  capability: { status: string; detail: string },
): string {
  return `  ${name.padEnd(12)} ${
    capability.status.toUpperCase().padEnd(11)
  } ${capability.detail}`;
}

function formatDoctor(project: ProjectInspection): string {
  const capabilities = project.capabilities;
  return [
    "Fresh project doctor",
    `Config: ${project.configPath}`,
    formatCapability("Fresh 2", capabilities.fresh2),
    formatCapability("Fresh Vite", capabilities.vite),
    formatCapability("Tailwind 4", capabilities.tailwind4),
    formatCapability("daisyUI", capabilities.daisyui),
  ].join("\n");
}

function formatOperation(operation: BlockOperation): string {
  switch (operation.kind) {
    case "file.create":
      return `file.create ${operation.path} <- ${operation.template}`;
    case "dependency.ensure":
      return `dependency.ensure ${operation.alias} = ${operation.specifier}`;
    case "env.ensure":
      return `env.ensure ${operation.path} ${operation.name}`;
    case "css.ensure":
      return `css.ensure ${operation.path} ${operation.statement}`;
  }
}

function formatBlock(block: BlockDefinition): string {
  const dependencies = block.dependencies.length > 0
    ? block.dependencies.join(", ")
    : "none";
  const requirements = block.requirements.length > 0
    ? block.requirements.join(", ")
    : "none";
  return [
    `${block.name}@${block.version}`,
    block.description,
    `Dependencies: ${dependencies}`,
    `Requirements: ${requirements}`,
    "Operations:",
    ...block.operations.map((operation) => `  - ${formatOperation(operation)}`),
  ].join("\n");
}

function formatPlan(plan: InstallPlan): string {
  const lines = [
    `Dry run: ${plan.requested}`,
    `Config: ${plan.project.configPath}`,
    "Blocks:",
    ...plan.blocks.map((block, index) => `  ${index + 1}. ${block.name}`),
    "Operations:",
    ...plan.operations.map((planned) =>
      `  - [${planned.state}] [${planned.block}] ${
        formatOperation(planned.operation)
      } — ${planned.detail}`
    ),
  ];

  if (plan.partialInstallation) {
    lines.push(
      "Partial installation: detected (existing state and pending operations both found).",
    );
  } else {
    lines.push("Partial installation: not detected.");
  }

  if (plan.issues.length === 0) {
    lines.push("Preflight: PASS");
  } else {
    lines.push("Preflight: FAIL", "Issues:");
    lines.push(
      ...plan.issues.map((issue) =>
        `  - [${issue.kind}] ${issue.block}: ${issue.message}`
      ),
    );
  }
  lines.push("No files were changed.");
  return lines.join("\n");
}

function usageError(message: string, io: CliIo): number {
  io.stderr(message);
  return 1;
}

export async function runCli(
  args: readonly string[],
  io: CliIo = defaultIo,
  cwd = Deno.cwd(),
): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    io.stdout(HELP);
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    io.stdout(`fresh-supabase ${VERSION}`);
    return 0;
  }

  const [command, ...rest] = args;
  try {
    switch (command) {
      case "list":
        if (rest.length !== 0) {
          return usageError("Usage: fresh-supabase list", io);
        }
        io.stdout(
          listBlocks().map((block) =>
            `${block.name.padEnd(22)} ${block.description}`
          ).join("\n"),
        );
        return 0;

      case "view": {
        if (rest.length !== 1) {
          return usageError("Usage: fresh-supabase view <block>", io);
        }
        const block = getBlock(rest[0]);
        if (!block) return usageError(`Unknown block: ${rest[0]}`, io);
        io.stdout(formatBlock(block));
        return 0;
      }

      case "doctor": {
        if (rest.length !== 0) {
          return usageError("Usage: fresh-supabase doctor", io);
        }
        const project = await inspectProject(cwd);
        io.stdout(formatDoctor(project));
        return project.capabilities.fresh2.status === "ok" ? 0 : 1;
      }

      case "add": {
        if (rest.length === 1 && getBlock(rest[0])) {
          return usageError(
            "Phase 1 does not execute installations. Re-run with --dry-run.",
            io,
          );
        }
        if (rest.length !== 2 || rest[1] !== "--dry-run") {
          return usageError(
            "Usage: fresh-supabase add <block> --dry-run",
            io,
          );
        }
        if (!getBlock(rest[0])) {
          return usageError(`Unknown block: ${rest[0]}`, io);
        }
        const plan = await createInstallPlan(cwd, rest[0]);
        io.stdout(formatPlan(plan));
        return plan.issues.length === 0 ? 0 : 1;
      }

      default:
        return usageError(
          `Unknown command: ${command}\nRun with --help to see supported commands.`,
          io,
        );
    }
  } catch (error) {
    if (error instanceof ProjectInspectionError) {
      io.stderr(`Project inspection failed: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  Deno.exit(await runCli(Deno.args));
}
