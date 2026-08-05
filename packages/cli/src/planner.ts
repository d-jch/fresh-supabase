import type { BlockDefinition, BlockOperation, Capability } from "./block.ts";
import { resolveBlockOrder } from "./catalog.ts";
import {
  PathSecurityError,
  resolveContainedTarget,
  targetExists,
} from "./paths.ts";
import {
  inspectProject,
  type ProjectCapabilities,
  type ProjectInspection,
} from "./project.ts";

export interface PlannedOperation {
  block: string;
  operation: BlockOperation;
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

export async function createInstallPlan(
  root: string,
  requested: string,
): Promise<InstallPlan> {
  const project = await inspectProject(root);
  const blocks = resolveBlockOrder(requested);
  const operations = blocks.flatMap((block) =>
    block.operations.map((operation) => ({ block: block.name, operation }))
  );
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

  for (const planned of operations) {
    const path = operationPath(planned.operation);
    if (!path) continue;

    try {
      const target = await resolveContainedTarget(project.root, path);
      if (
        planned.operation.kind === "file.create" && await targetExists(target)
      ) {
        issues.push({
          kind: "conflict",
          block: planned.block,
          message: `${path} already exists`,
        });
      }
    } catch (error) {
      if (error instanceof PathSecurityError) {
        issues.push({
          kind: "path",
          block: planned.block,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  }

  return { requested, project, blocks, operations, issues };
}
