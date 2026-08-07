import type { BlockDefinition, BlockOperation } from "./src/block.ts";
import { getBlock, listBlocks } from "./src/catalog.ts";
import {
  createExecutablePlan,
  executeInstallPlan,
  InstallExecutionError,
  MANIFEST_PATH,
  recoverInterruptedInstall,
} from "./src/executor.ts";
import { createInstallPlan, type InstallPlan } from "./src/planner.ts";
import {
  inspectProject,
  type ProjectInspection,
  ProjectInspectionError,
} from "./src/project.ts";

export const VERSION = "0.2.0";

const HELP = `fresh-supabase ${VERSION}

Copy project-owned Supabase blocks into an existing Deno Fresh 2 project.

Usage:
  fresh-supabase doctor
  fresh-supabase list
  fresh-supabase view <block>
  fresh-supabase add <block...>
  fresh-supabase add <block...> --dry-run
  fresh-supabase --help
  fresh-supabase --version

Commands:
  doctor                   Inspect Fresh, root alias, Vite, Tailwind, and daisyUI capabilities
  list                     List embedded blocks
  view <block>             Show one block definition
  add <block...>           Preflight and install embedded blocks
  add <block...> --dry-run Preflight and print a deterministic installation plan

Options:
  --help       Show this help message
  --version    Print the CLI version

All preflight checks finish before installation writes begin.
Dry runs do not change files, dependencies, lockfiles, or installer state.
Generated projects do not depend on this CLI at runtime.`;

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
    formatCapability(".env ignore", capabilities.envFileIgnored),
    formatCapability("Fresh 2", capabilities.fresh2),
    formatCapability("FS routes", capabilities.freshFileRoutes),
    formatCapability("Route dir", capabilities.freshDefaultRoutes),
    formatCapability("define", capabilities.freshDefineHelper),
    formatCapability("Root alias", capabilities.freshRootAlias),
    formatCapability("Fresh Vite", capabilities.vite),
    formatCapability("Tailwind 4", capabilities.tailwind4),
    formatCapability("daisyUI", capabilities.daisyui),
  ].join("\n");
}

function hasHealthyFreshScaffold(project: ProjectInspection): boolean {
  const capabilities = project.capabilities;
  return [
    capabilities.envFileIgnored,
    capabilities.fresh2,
    capabilities.freshFileRoutes,
    capabilities.freshDefaultRoutes,
    capabilities.freshDefineHelper,
    capabilities.freshRootAlias,
    capabilities.vite,
  ].every((capability) => capability.status === "ok");
}

function formatOperation(operation: BlockOperation): string {
  switch (operation.kind) {
    case "file.create":
      return `file.create ${operation.path} <- ${operation.template}`;
    case "dependency.ensure":
      return `dependency.ensure ${operation.alias} = ${operation.specifier}`;
    case "config.exclude.ensure":
      return `config.exclude.ensure ${operation.pattern}`;
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
  const lines = [
    `${block.name}@${block.version}`,
    block.description,
    `Dependencies: ${dependencies}`,
    `Requirements: ${requirements}`,
  ];
  if (block.upstream) {
    lines.push(
      `Upstream: ${block.upstream.name} (${block.upstream.files.length} files)`,
      `Registry item: ${block.upstream.registryItem}`,
      `Upstream registry dependencies: ${
        block.upstream.registryDependencies.length > 0
          ? block.upstream.registryDependencies.join(", ")
          : "none"
      }`,
    );
  }
  lines.push(
    "Operations:",
    ...block.operations.map((operation) => `  - ${formatOperation(operation)}`),
  );
  if (block.postInstall.length > 0) {
    lines.push(
      "After install:",
      ...block.postInstall.map((instruction) => `  - ${instruction}`),
    );
  }
  return lines.join("\n");
}

function formatPlan(plan: InstallPlan, dryRun = true): string {
  const lines = [
    `${dryRun ? "Dry run" : "Install plan"}: ${plan.requested.join(", ")}`,
    `Config: ${plan.project.configPath}`,
    "Blocks:",
    ...plan.blocks.map((block, index) => `  ${index + 1}. ${block.name}`),
    "Operations:",
    ...plan.operations.map((planned) =>
      `  - [${planned.state}] [${planned.block}] ${
        formatOperation(planned.operation)
      } — ${planned.detail}`
    ),
    "Managed cleanup:",
    ...(plan.removals.length === 0
      ? ["  - none"]
      : plan.removals.map((removal) =>
        `  - [${removal.state}] [${removal.block}] remove ${removal.path} — ${removal.detail}`
      )),
    "After install:",
    ...(plan.blocks.flatMap((block) => block.postInstall).length === 0
      ? ["  - none"]
      : plan.blocks.flatMap((block) =>
        block.postInstall.map((instruction) =>
          `  - [${block.name}] ${instruction}`
        )
      )),
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
  lines.push(
    dryRun
      ? "No files were changed."
      : "Preflight failed before any installer write.",
  );
  return lines.join("\n");
}

function usageError(message: string, io: CliIo): number {
  io.stderr(message);
  return 1;
}

export async function runCli(
  args: readonly string[],
  io: CliIo = defaultIo,
  cwd: string = Deno.cwd(),
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
        return hasHealthyFreshScaffold(project) ? 0 : 1;
      }

      case "add": {
        const dryRunCount = rest.filter((argument) => argument === "--dry-run")
          .length;
        const unknownOption = rest.find((argument) =>
          argument.startsWith("--") && argument !== "--dry-run"
        );
        const requested = rest.filter((argument) => argument !== "--dry-run");
        if (
          requested.length === 0 || dryRunCount > 1 || unknownOption ||
          requested.some((name) => !getBlock(name))
        ) {
          const unknownBlock = requested.find((name) => !getBlock(name));
          if (unknownBlock) {
            return usageError(`Unknown block: ${unknownBlock}`, io);
          }
          return usageError(
            "Usage: fresh-supabase add <block...> [--dry-run]",
            io,
          );
        }

        if (dryRunCount === 0) {
          const recovered = await recoverInterruptedInstall(cwd);
          const executable = await createExecutablePlan(
            cwd,
            requested,
            VERSION,
          );
          if (executable.installPlan.issues.length > 0) {
            io.stdout(formatPlan(executable.installPlan, false));
            return 1;
          }
          const result = await executeInstallPlan(executable);
          const guidance = executable.installPlan.blocks.flatMap((block) =>
            block.postInstall.map((instruction) =>
              `  - [${block.name}] ${instruction}`
            )
          );
          io.stdout(
            (recovered
              ? "Recovered an interrupted installer transaction.\n"
              : "") +
              (result.changed
                ? `Installed ${
                  requested.join(", ")
                } with ${result.mutationCount} file mutation(s).\nManifest: ${MANIFEST_PATH}`
                : `${
                  requested.join(", ")
                } is already installed; no files changed.\nManifest: ${MANIFEST_PATH}`) +
              (guidance.length > 0
                ? `\nAfter install:\n${guidance.join("\n")}`
                : ""),
          );
          return 0;
        }
        const plan = await createInstallPlan(cwd, requested);
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
    if (error instanceof InstallExecutionError) {
      io.stderr(`Installation failed: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  Deno.exit(await runCli(Deno.args));
}
