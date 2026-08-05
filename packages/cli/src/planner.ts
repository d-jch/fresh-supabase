import type { BlockDefinition, BlockOperation, Capability } from "./block.ts";
import { resolveBlockOrder } from "./catalog.ts";
import { PathSecurityError, resolveContainedTarget } from "./paths.ts";
import {
  inspectProject,
  type ProjectCapabilities,
  type ProjectInspection,
} from "./project.ts";

export type OperationState = "pending" | "satisfied" | "conflict";

export interface PlannedOperation {
  block: string;
  operation: BlockOperation;
  state: OperationState;
  detail: string;
}

export interface PlanIssue {
  kind: "requirement" | "conflict" | "path";
  block: string;
  message: string;
}

export interface InstallPlan {
  requested: string;
  project: ProjectInspection;
  blocks: BlockDefinition[];
  operations: PlannedOperation[];
  issues: PlanIssue[];
  partialInstallation: boolean;
}

export function capabilityResult(
  capabilities: ProjectCapabilities,
  requirement: Capability,
) {
  switch (requirement) {
    case "fresh-2":
      return capabilities.fresh2;
    case "fresh-vite":
      return capabilities.vite;
    case "tailwind-4":
      return capabilities.tailwind4;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function regularFileContent(
  target: string,
  projectPath: string,
): Promise<{ exists: false } | { exists: true; content: string }> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(target);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { exists: false };
    throw error;
  }
  if (!info.isFile) {
    throw new Error(`${projectPath} exists but is not a regular file`);
  }
  return { exists: true, content: await Deno.readTextFile(target) };
}

function stripCssComments(source: string): string | null {
  let output = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return null;
      const comment = source.slice(index, end + 2);
      output += comment.replace(/[^\r\n]/g, " ");
      index = end + 1;
      continue;
    }
    output += char;
  }
  return output;
}

function cssStatementPresent(source: string, statement: string): boolean {
  const withoutComments = stripCssComments(source);
  if (withoutComments === null) return false;
  const plugin = statement.match(/^@plugin\s+["']([^"']+)["']\s*;$/);
  if (plugin) {
    const packageName = plugin[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return withoutComments.split(/\r?\n/).some((line) =>
      new RegExp(`^\\s*@plugin\\s+["']${packageName}["']\\s*;\\s*$`).test(
        line,
      )
    );
  }
  return withoutComments.split(/\r?\n/).some((line) =>
    line.trim() === statement
  );
}

function envEntryCount(source: string, name: string): number {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignment = new RegExp(`^(?:export\\s+)?${escapedName}\\s*=`);
  return source.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") &&
      assignment.test(trimmed);
  }).length;
}

function operationPath(operation: BlockOperation): string | null {
  switch (operation.kind) {
    case "file.create":
    case "env.ensure":
    case "css.ensure":
      return operation.path;
    case "dependency.ensure":
      return null;
  }
}

async function inspectOperation(
  project: ProjectInspection,
  block: string,
  operation: BlockOperation,
): Promise<{ planned: PlannedOperation; issue?: PlanIssue }> {
  if (operation.kind === "dependency.ensure") {
    const rawImports = isRecord(project.config.imports)
      ? project.config.imports
      : {};
    if (!Object.hasOwn(rawImports, operation.alias)) {
      return {
        planned: {
          block,
          operation,
          state: "pending",
          detail: "dependency alias is absent",
        },
      };
    }
    const existing = rawImports[operation.alias];
    if (existing === operation.specifier) {
      return {
        planned: {
          block,
          operation,
          state: "satisfied",
          detail: "exact dependency specifier is already configured",
        },
      };
    }
    const detail = `${operation.alias} is already configured as ${
      typeof existing === "string" ? existing : "a non-string value"
    }`;
    return {
      planned: { block, operation, state: "conflict", detail },
      issue: { kind: "conflict", block, message: detail },
    };
  }

  const path = operationPath(operation)!;
  let target: string;
  try {
    target = await resolveContainedTarget(project.root, path);
  } catch (error) {
    if (!(error instanceof PathSecurityError)) throw error;
    return {
      planned: {
        block,
        operation,
        state: "conflict",
        detail: error.message,
      },
      issue: { kind: "path", block, message: error.message },
    };
  }

  let file: Awaited<ReturnType<typeof regularFileContent>>;
  try {
    file = await regularFileContent(target, path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      planned: { block, operation, state: "conflict", detail },
      issue: { kind: "conflict", block, message: detail },
    };
  }

  if (operation.kind === "file.create") {
    if (!file.exists) {
      return {
        planned: {
          block,
          operation,
          state: "pending",
          detail: "target file is absent",
        },
      };
    }
    const detail = `${path} already exists`;
    return {
      planned: { block, operation, state: "conflict", detail },
      issue: { kind: "conflict", block, message: detail },
    };
  }

  if (operation.kind === "env.ensure") {
    if (!file.exists) {
      return {
        planned: {
          block,
          operation,
          state: "pending",
          detail: "environment example file is absent",
        },
      };
    }
    const count = envEntryCount(file.content, operation.name);
    if (count === 0) {
      return {
        planned: {
          block,
          operation,
          state: "pending",
          detail: "environment entry is absent",
        },
      };
    }
    if (count === 1) {
      return {
        planned: {
          block,
          operation,
          state: "satisfied",
          detail:
            "environment entry already exists and will not be overwritten",
        },
      };
    }
    const detail = `${path} contains duplicate ${operation.name} entries`;
    return {
      planned: { block, operation, state: "conflict", detail },
      issue: { kind: "conflict", block, message: detail },
    };
  }

  if (!file.exists) {
    return {
      planned: {
        block,
        operation,
        state: "pending",
        detail: "stylesheet is absent",
      },
    };
  }
  if (stripCssComments(file.content) === null) {
    const detail = `${path} contains an unterminated CSS comment`;
    return {
      planned: { block, operation, state: "conflict", detail },
      issue: { kind: "conflict", block, message: detail },
    };
  }
  return cssStatementPresent(file.content, operation.statement)
    ? {
      planned: {
        block,
        operation,
        state: "satisfied",
        detail: "CSS statement is already configured",
      },
    }
    : {
      planned: {
        block,
        operation,
        state: "pending",
        detail: "CSS statement is absent",
      },
    };
}

export async function createInstallPlan(
  root: string,
  requested: string,
): Promise<InstallPlan> {
  const project = await inspectProject(root);
  const blocks = resolveBlockOrder(requested);
  const issues: PlanIssue[] = [];

  for (const block of blocks) {
    for (const requirement of block.requirements) {
      const capability = capabilityResult(project.capabilities, requirement);
      if (capability.status !== "ok") {
        issues.push({
          kind: "requirement",
          block: block.name,
          message: `${requirement}: ${capability.detail}`,
        });
      }
    }
  }

  const operations: PlannedOperation[] = [];
  for (const block of blocks) {
    for (const operation of block.operations) {
      const inspected = await inspectOperation(project, block.name, operation);
      operations.push(inspected.planned);
      if (inspected.issue) issues.push(inspected.issue);
    }
  }

  const partialInstallation =
    operations.some((planned) => planned.state !== "pending") &&
    operations.some((planned) => planned.state === "pending");

  return {
    requested,
    project,
    blocks,
    operations,
    issues,
    partialInstallation,
  };
}
