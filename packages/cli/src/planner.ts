import {
  type BlockDefinition,
  type BlockOperation,
  blockOperationKey,
  type Capability,
  compareSemanticVersions,
} from "./block.ts";
import { resolveBlockOrder } from "./catalog.ts";
import {
  type InstallerManifest,
  InstallerStateError,
  JOURNAL_PATH,
  MANIFEST_PATH,
  validateInstallerManifest,
} from "./installer_state.ts";
import { PathSecurityError, resolveContainedTarget } from "./paths.ts";
import {
  inspectProject,
  type ProjectCapabilities,
  type ProjectInspection,
} from "./project.ts";
import { BlockTemplateError, loadBlockTemplate } from "./templates.ts";

export type OperationState = "pending" | "satisfied" | "conflict";

export interface PlannedOperation {
  block: string;
  operation: BlockOperation;
  state: OperationState;
  detail: string;
}

export interface PlannedFileRemoval {
  block: string;
  path: string;
  state: OperationState;
  detail: string;
}

export interface PlanIssue {
  kind: "requirement" | "conflict" | "path";
  block: string;
  message: string;
}

export interface InstallPlan {
  requested: string[];
  project: ProjectInspection;
  blocks: BlockDefinition[];
  operations: PlannedOperation[];
  removals: PlannedFileRemoval[];
  issues: PlanIssue[];
  partialInstallation: boolean;
}

export function capabilityResult(
  capabilities: ProjectCapabilities,
  requirement: Capability,
) {
  switch (requirement) {
    case "env-file-ignored":
      return capabilities.envFileIgnored;
    case "fresh-2":
      return capabilities.fresh2;
    case "fresh-file-routes":
      return capabilities.freshFileRoutes;
    case "fresh-default-routes":
      return capabilities.freshDefaultRoutes;
    case "fresh-define-helper":
      return capabilities.freshDefineHelper;
    case "fresh-root-alias":
      return capabilities.freshRootAlias;
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
    case "config.exclude.ensure":
      return null;
  }
}

interface PackageSpecifier {
  protocol: "jsr" | "npm";
  packageName: string;
  range: string;
}

function parsePackageSpecifier(value: string): PackageSpecifier | null {
  const match = /^(jsr|npm):((?:@[^/@]+\/)?[^/@]+)@(.+)$/.exec(value);
  if (!match) return null;
  return {
    protocol: match[1] as PackageSpecifier["protocol"],
    packageName: match[2],
    range: match[3],
  };
}

interface StableVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseStableVersion(value: string): StableVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match
    ? {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    }
    : null;
}

function versionAtLeast(left: StableVersion, right: StableVersion): boolean {
  if (left.major !== right.major) return left.major > right.major;
  if (left.minor !== right.minor) return left.minor > right.minor;
  return left.patch >= right.patch;
}

function satisfiesCaret(version: StableVersion, floor: StableVersion): boolean {
  if (!versionAtLeast(version, floor)) return false;
  if (floor.major > 0) return version.major === floor.major;
  if (floor.minor > 0) {
    return version.major === 0 && version.minor === floor.minor;
  }
  return version.major === 0 && version.minor === 0 &&
    version.patch === floor.patch;
}

function existingSpecifierSatisfies(
  existingValue: unknown,
  requiredValue: string,
): boolean {
  if (typeof existingValue !== "string") return false;
  const existing = parsePackageSpecifier(existingValue);
  const required = parsePackageSpecifier(requiredValue);
  if (
    !existing || !required || existing.protocol !== required.protocol ||
    existing.packageName !== required.packageName ||
    !required.range.startsWith("^")
  ) return false;

  const requiredFloor = parseStableVersion(required.range.slice(1));
  if (!requiredFloor) return false;
  if (existing.range.startsWith("^")) {
    const existingFloor = parseStableVersion(existing.range.slice(1));
    return existingFloor !== null &&
      satisfiesCaret(existingFloor, requiredFloor) &&
      (requiredFloor.major > 0
        ? existingFloor.major === requiredFloor.major
        : requiredFloor.minor > 0
        ? existingFloor.major === 0 &&
          existingFloor.minor === requiredFloor.minor
        : existingFloor.major === 0 && existingFloor.minor === 0 &&
          existingFloor.patch === requiredFloor.patch);
  }
  const exact = parseStableVersion(existing.range);
  return exact !== null && satisfiesCaret(exact, requiredFloor);
}

async function inspectOperation(
  project: ProjectInspection,
  block: BlockDefinition,
  operation: BlockOperation,
  manifest: InstallerManifest | null,
): Promise<{ planned: PlannedOperation; issue?: PlanIssue }> {
  const blockName = block.name;
  if (operation.kind === "config.exclude.ensure") {
    const rawExclude = project.config.exclude;
    if (rawExclude === undefined) {
      return {
        planned: {
          block: blockName,
          operation,
          state: "pending",
          detail: "Deno config exclude pattern is absent",
        },
      };
    }
    if (
      !Array.isArray(rawExclude) ||
      rawExclude.some((entry) => typeof entry !== "string")
    ) {
      const detail = "Deno config exclude must be an array of strings";
      return {
        planned: { block: blockName, operation, state: "conflict", detail },
        issue: { kind: "conflict", block: blockName, message: detail },
      };
    }
    return rawExclude.includes(operation.pattern)
      ? {
        planned: {
          block: blockName,
          operation,
          state: "satisfied",
          detail: "Deno config exclude pattern is already configured",
        },
      }
      : {
        planned: {
          block: blockName,
          operation,
          state: "pending",
          detail: "Deno config exclude pattern is absent",
        },
      };
  }
  if (operation.kind === "dependency.ensure") {
    const rawImports = isRecord(project.config.imports)
      ? project.config.imports
      : {};
    if (!Object.hasOwn(rawImports, operation.alias)) {
      return {
        planned: {
          block: blockName,
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
          block: blockName,
          operation,
          state: "satisfied",
          detail: "exact dependency specifier is already configured",
        },
      };
    }
    if (existingSpecifierSatisfies(existing, operation.specifier)) {
      return {
        planned: {
          block: blockName,
          operation,
          state: "satisfied",
          detail: `compatible host dependency is retained: ${existing}`,
        },
      };
    }
    const detail = `${operation.alias} is already configured as ${
      typeof existing === "string" ? existing : "a non-string value"
    }`;
    return {
      planned: { block: blockName, operation, state: "conflict", detail },
      issue: { kind: "conflict", block: blockName, message: detail },
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
        block: blockName,
        operation,
        state: "conflict",
        detail: error.message,
      },
      issue: { kind: "path", block: blockName, message: error.message },
    };
  }

  let file: Awaited<ReturnType<typeof regularFileContent>>;
  try {
    file = await regularFileContent(target, path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      planned: { block: blockName, operation, state: "conflict", detail },
      issue: { kind: "conflict", block: blockName, message: detail },
    };
  }

  if (operation.kind === "file.create") {
    if (!file.exists) {
      return {
        planned: {
          block: blockName,
          operation,
          state: "pending",
          detail: "target file is absent",
        },
      };
    }
    const installedBlock = manifest?.blocks.find((entry) =>
      entry.name === block.name
    );
    if (
      installedBlock &&
      compareSemanticVersions(installedBlock.version, block.version) > 0
    ) {
      const detail =
        `${path} belongs to newer installed ${block.name}@${installedBlock.version}; refusing downgrade to ${block.version}`;
      return {
        planned: { block: blockName, operation, state: "conflict", detail },
        issue: { kind: "conflict", block: blockName, message: detail },
      };
    }

    try {
      const expected = await loadBlockTemplate(block, operation.template);
      if (file.content === expected) {
        return {
          planned: {
            block: blockName,
            operation,
            state: "satisfied",
            detail: "target file exactly matches the embedded template",
          },
        };
      }

      const previousOperation = manifest?.operations.find((entry) =>
        entry.block === block.name &&
        entry.key === blockOperationKey(operation)
      );
      if (
        installedBlock &&
        compareSemanticVersions(block.version, installedBlock.version) > 0 &&
        previousOperation?.kind === "file.create" &&
        previousOperation.target === path &&
        previousOperation.contentHash === await sha256(file.content)
      ) {
        return {
          planned: {
            block: blockName,
            operation,
            state: "pending",
            detail:
              `managed file is unchanged since ${block.name}@${installedBlock.version} and will be upgraded`,
          },
        };
      }
    } catch (error) {
      if (!(error instanceof BlockTemplateError)) throw error;
    }
    const detail = `${path} already exists with different content`;
    return {
      planned: { block: blockName, operation, state: "conflict", detail },
      issue: { kind: "conflict", block: blockName, message: detail },
    };
  }

  if (operation.kind === "env.ensure") {
    if (!file.exists) {
      return {
        planned: {
          block: blockName,
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
          block: blockName,
          operation,
          state: "pending",
          detail: "environment entry is absent",
        },
      };
    }
    if (count === 1) {
      return {
        planned: {
          block: blockName,
          operation,
          state: "satisfied",
          detail:
            "environment entry already exists and will not be overwritten",
        },
      };
    }
    const detail = `${path} contains duplicate ${operation.name} entries`;
    return {
      planned: { block: blockName, operation, state: "conflict", detail },
      issue: { kind: "conflict", block: blockName, message: detail },
    };
  }

  if (!file.exists) {
    return {
      planned: {
        block: blockName,
        operation,
        state: "pending",
        detail: "stylesheet is absent",
      },
    };
  }
  if (stripCssComments(file.content) === null) {
    const detail = `${path} contains an unterminated CSS comment`;
    return {
      planned: { block: blockName, operation, state: "conflict", detail },
      issue: { kind: "conflict", block: blockName, message: detail },
    };
  }
  return cssStatementPresent(file.content, operation.statement)
    ? {
      planned: {
        block: blockName,
        operation,
        state: "satisfied",
        detail: "CSS statement is already configured",
      },
    }
    : {
      planned: {
        block: blockName,
        operation,
        state: "pending",
        detail: "CSS statement is absent",
      },
    };
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function operationOwnershipIssues(
  blocks: readonly BlockDefinition[],
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const keys = new Map<string, string>();
  const targets = new Map<
    string,
    Array<{ block: string; kind: BlockOperation["kind"] }>
  >();

  for (const block of blocks) {
    for (const operation of block.operations) {
      const key = blockOperationKey(operation);
      const keyOwner = keys.get(key);
      if (keyOwner) {
        issues.push({
          kind: "conflict",
          block: block.name,
          message: `${key} is already owned by block ${keyOwner}`,
        });
        continue;
      }
      keys.set(key, block.name);

      const path = operationPath(operation);
      if (path === null) continue;
      const claims = targets.get(path) ?? [];
      const exclusive = operation.kind === "file.create" ||
        claims.some((claim) => claim.kind === "file.create");
      if (exclusive && claims.length > 0) {
        issues.push({
          kind: "conflict",
          block: block.name,
          message: `${path} has incompatible operation owners: ${
            [...new Set(claims.map((claim) => claim.block)), block.name].join(
              ", ",
            )
          }`,
        });
      }
      claims.push({ block: block.name, kind: operation.kind });
      targets.set(path, claims);
    }
  }
  return issues;
}

async function inspectInstallerState(
  project: ProjectInspection,
  requested: string[],
): Promise<{ issues: PlanIssue[]; manifest: InstallerManifest | null }> {
  const issues: PlanIssue[] = [];
  let manifest: InstallerManifest | null = null;
  for (const path of [JOURNAL_PATH, MANIFEST_PATH]) {
    const target = await resolveContainedTarget(project.root, path);
    let file: Awaited<ReturnType<typeof regularFileContent>>;
    try {
      file = await regularFileContent(target, path);
    } catch (error) {
      issues.push({
        kind: "conflict",
        block: requested.join(", "),
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!file.exists) continue;
    if (path === JOURNAL_PATH) {
      issues.push({
        kind: "conflict",
        block: requested.join(", "),
        message:
          `${JOURNAL_PATH} records an interrupted installation; a non-dry-run add must recover it first`,
      });
      continue;
    }
    try {
      manifest = validateInstallerManifest(JSON.parse(file.content));
    } catch (error) {
      const detail = error instanceof SyntaxError
        ? "installer manifest is not valid JSON"
        : error instanceof InstallerStateError
        ? error.message
        : error instanceof Error
        ? error.message
        : String(error);
      issues.push({
        kind: "conflict",
        block: requested.join(", "),
        message: detail,
      });
    }
  }
  return { issues, manifest };
}

function inspectBlockDowngrades(
  blocks: readonly BlockDefinition[],
  manifest: InstallerManifest | null,
): { details: Map<string, string>; issues: PlanIssue[] } {
  const details = new Map<string, string>();
  const issues: PlanIssue[] = [];
  if (!manifest) return { details, issues };

  for (const block of blocks) {
    const installed = manifest.blocks.find((entry) =>
      entry.name === block.name
    );
    if (
      !installed ||
      compareSemanticVersions(installed.version, block.version) <= 0
    ) continue;
    const detail =
      `installed ${block.name}@${installed.version} is newer than requested ${block.name}@${block.version}; refusing downgrade`;
    details.set(block.name, detail);
    issues.push({ kind: "conflict", block: block.name, message: detail });
  }
  return { details, issues };
}

async function inspectStaleManagedFiles(
  project: ProjectInspection,
  blocks: readonly BlockDefinition[],
  manifest: InstallerManifest | null,
): Promise<{ removals: PlannedFileRemoval[]; issues: PlanIssue[] }> {
  const removals: PlannedFileRemoval[] = [];
  const issues: PlanIssue[] = [];
  if (!manifest) return { removals, issues };

  for (const block of blocks) {
    const installed = manifest.blocks.find((entry) =>
      entry.name === block.name
    );
    if (
      !installed ||
      compareSemanticVersions(block.version, installed.version) <= 0
    ) continue;

    const currentTargets = new Set(
      block.operations.flatMap((operation) =>
        operation.kind === "file.create" ? [operation.path] : []
      ),
    );
    for (
      const previous of manifest.operations.filter((entry) =>
        entry.block === block.name && entry.kind === "file.create" &&
        !currentTargets.has(entry.target)
      )
    ) {
      let target: string;
      try {
        target = await resolveContainedTarget(project.root, previous.target);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        removals.push({
          block: block.name,
          path: previous.target,
          state: "conflict",
          detail,
        });
        issues.push({ kind: "path", block: block.name, message: detail });
        continue;
      }

      let file: Awaited<ReturnType<typeof regularFileContent>>;
      try {
        file = await regularFileContent(target, previous.target);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        removals.push({
          block: block.name,
          path: previous.target,
          state: "conflict",
          detail,
        });
        issues.push({ kind: "conflict", block: block.name, message: detail });
        continue;
      }
      if (!file.exists) {
        removals.push({
          block: block.name,
          path: previous.target,
          state: "satisfied",
          detail: "stale managed file is already absent",
        });
        continue;
      }
      if (await sha256(file.content) === previous.contentHash) {
        removals.push({
          block: block.name,
          path: previous.target,
          state: "pending",
          detail:
            `unchanged managed file from ${block.name}@${installed.version} will be removed`,
        });
        continue;
      }
      const detail =
        `${previous.target} was managed by ${block.name}@${installed.version} but has user changes; refusing removal`;
      removals.push({
        block: block.name,
        path: previous.target,
        state: "conflict",
        detail,
      });
      issues.push({ kind: "conflict", block: block.name, message: detail });
    }
  }
  return { removals, issues };
}

export async function createInstallPlan(
  root: string,
  requestedInput: string | readonly string[],
): Promise<InstallPlan> {
  const requested = typeof requestedInput === "string"
    ? [requestedInput]
    : [...requestedInput];
  const project = await inspectProject(root);
  const blocks = resolveBlockOrder(requested);
  const issues: PlanIssue[] = [];
  const installerState = await inspectInstallerState(project, requested);
  issues.push(...installerState.issues);
  issues.push(...operationOwnershipIssues(blocks));
  const downgrades = inspectBlockDowngrades(
    blocks,
    installerState.manifest,
  );
  issues.push(...downgrades.issues);
  const staleFiles = await inspectStaleManagedFiles(
    project,
    blocks,
    installerState.manifest,
  );
  issues.push(...staleFiles.issues);

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
    const downgradeDetail = downgrades.details.get(block.name);
    for (const operation of block.operations) {
      if (downgradeDetail) {
        operations.push({
          block: block.name,
          operation,
          state: "conflict",
          detail: downgradeDetail,
        });
        continue;
      }
      const inspected = await inspectOperation(
        project,
        block,
        operation,
        installerState.manifest,
      );
      operations.push(inspected.planned);
      if (inspected.issue) issues.push(inspected.issue);
    }
  }

  const partialInstallation =
    [...operations, ...staleFiles.removals].some((planned) =>
      planned.state !== "pending"
    ) &&
    [...operations, ...staleFiles.removals].some((planned) =>
      planned.state === "pending"
    );

  return {
    requested,
    project,
    blocks,
    operations,
    removals: staleFiles.removals,
    issues,
    partialInstallation,
  };
}
