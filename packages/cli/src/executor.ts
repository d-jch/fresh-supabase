import { dirname } from "node:path";
import type { BlockOperation } from "./block.ts";
import {
  type InstallerManifest,
  InstallerStateError,
  JOURNAL_PATH,
  MANIFEST_PATH,
  type ManifestOperation,
  validateInstallerManifest,
} from "./installer_state.ts";
import { ensureJsoncImports, JsoncEditError } from "./jsonc_edit.ts";
import { resolveContainedTarget, targetExists } from "./paths.ts";
import {
  createInstallPlan,
  type InstallPlan,
  type PlannedOperation,
} from "./planner.ts";
import { BlockTemplateError, loadBlockTemplate } from "./templates.ts";

export { JOURNAL_PATH, MANIFEST_PATH } from "./installer_state.ts";
export type { InstallerManifest } from "./installer_state.ts";

interface TextState {
  exists: boolean;
  content: string | null;
  hash: string | null;
}

export interface ExecutableMutation {
  path: string;
  before: TextState;
  content: string;
  afterHash: string;
  operationKeys: string[];
}

export interface ExecutableInstallPlan {
  installPlan: InstallPlan;
  mutations: ExecutableMutation[];
  directoriesToCreate: string[];
  manifest: InstallerManifest | null;
}

export interface ExecuteHooks {
  afterMutation?(
    index: number,
    mutation: ExecutableMutation,
  ): void | Promise<void>;
}

export interface ExecuteResult {
  changed: boolean;
  mutationCount: number;
  manifest: InstallerManifest;
}

export class InstallExecutionError extends Error {
  override name = "InstallExecutionError";
}

class ExecutionPlanError extends Error {
  override name = "ExecutionPlanError";
}

interface WorkingTarget {
  path: string;
  before: TextState;
  content: string;
  operationKeys: string[];
}

interface InstallJournal {
  schemaVersion: 1;
  mutations: Array<{
    path: string;
    beforeExists: boolean;
    beforeHash: string | null;
    beforeContent: string | null;
    afterHash: string;
  }>;
  createdDirectories: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function readTextState(
  root: string,
  projectPath: string,
): Promise<TextState> {
  const target = await resolveContainedTarget(root, projectPath);
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(target);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { exists: false, content: null, hash: null };
    }
    throw error;
  }
  if (!info.isFile) {
    throw new ExecutionPlanError(
      `${projectPath} exists but is not a regular file`,
    );
  }
  const content = await Deno.readTextFile(target);
  return { exists: true, content, hash: await sha256(content) };
}

function operationTarget(
  planned: PlannedOperation,
  configPath: string,
): string {
  switch (planned.operation.kind) {
    case "dependency.ensure":
      return configPath;
    case "file.create":
    case "env.ensure":
    case "css.ensure":
      return planned.operation.path;
  }
}

function operationKey(operation: BlockOperation): string {
  switch (operation.kind) {
    case "file.create":
      return `file:${operation.path}`;
    case "dependency.ensure":
      return `dependency:${operation.alias}`;
    case "env.ensure":
      return `env:${operation.path}:${operation.name}`;
    case "css.ensure":
      return `css:${operation.path}:${operation.statement}`;
  }
}

function appendLine(source: string, line: string): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  if (source.length === 0) return line + eol;
  return source + (source.endsWith("\n") ? "" : eol) + line + eol;
}

function planWithIssue(
  plan: InstallPlan,
  block: string,
  message: string,
): InstallPlan {
  return {
    ...plan,
    issues: [...plan.issues, { kind: "conflict", block, message }],
  };
}

async function readManifest(root: string): Promise<InstallerManifest | null> {
  const state = await readTextState(root, MANIFEST_PATH);
  if (!state.exists) return null;
  try {
    return validateInstallerManifest(JSON.parse(state.content!));
  } catch (error) {
    if (error instanceof InstallerStateError) {
      throw new ExecutionPlanError(error.message);
    }
    throw new ExecutionPlanError(
      error instanceof SyntaxError
        ? "installer manifest is not valid JSON"
        : error instanceof Error
        ? error.message
        : String(error),
    );
  }
}

function mergeManifest(
  existing: InstallerManifest | null,
  plan: InstallPlan,
  operations: ManifestOperation[],
  cliVersion: string,
): InstallerManifest {
  const installedNames = new Set(plan.blocks.map((block) => block.name));
  const blocks = [
    ...(existing?.blocks.filter((block) => !installedNames.has(block.name)) ??
      []),
    ...plan.blocks.map(({ name, version }) => ({ name, version })),
  ].sort((left, right) => left.name.localeCompare(right.name));
  const mergedOperations = [
    ...(existing?.operations.filter((entry) =>
      !installedNames.has(entry.block)
    ) ?? []),
    ...operations,
  ].sort((left, right) =>
    left.block.localeCompare(right.block) || left.key.localeCompare(right.key)
  );
  return {
    schemaVersion: 1,
    cliVersion,
    blocks,
    operations: mergedOperations,
  };
}

async function missingParentDirectories(
  root: string,
  paths: readonly string[],
): Promise<string[]> {
  const missing = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").slice(0, -1);
    for (let count = 1; count <= segments.length; count++) {
      const relative = segments.slice(0, count).join("/");
      if (missing.has(relative)) continue;
      const target = await resolveContainedTarget(root, relative);
      try {
        const info = await Deno.lstat(target);
        if (!info.isDirectory) {
          throw new ExecutionPlanError(
            `${relative} exists but is not a directory`,
          );
        }
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          missing.add(relative);
          continue;
        }
        throw error;
      }
    }
  }
  return [...missing].sort((left, right) =>
    left.split("/").length - right.split("/").length ||
    left.localeCompare(right)
  );
}

export async function createExecutablePlan(
  root: string,
  requested: string,
  cliVersion: string,
): Promise<ExecutableInstallPlan> {
  let installPlan = await createInstallPlan(root, requested);
  if (installPlan.issues.length > 0) {
    return {
      installPlan,
      mutations: [],
      directoriesToCreate: [],
      manifest: null,
    };
  }

  if (await targetExists(await resolveContainedTarget(root, JOURNAL_PATH))) {
    installPlan = planWithIssue(
      installPlan,
      requested,
      `${JOURNAL_PATH} exists; recover the interrupted installation before continuing`,
    );
    return {
      installPlan,
      mutations: [],
      directoriesToCreate: [],
      manifest: null,
    };
  }

  let existingManifest: InstallerManifest | null;
  try {
    existingManifest = await readManifest(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    installPlan = planWithIssue(installPlan, requested, message);
    return {
      installPlan,
      mutations: [],
      directoriesToCreate: [],
      manifest: null,
    };
  }

  const working = new Map<string, WorkingTarget>();
  const blockByName = new Map(
    installPlan.blocks.map((block) => [block.name, block]),
  );
  const getWorking = async (path: string): Promise<WorkingTarget> => {
    const cached = working.get(path);
    if (cached) return cached;
    const before = await readTextState(root, path);
    const target: WorkingTarget = {
      path,
      before,
      content: before.content ?? "",
      operationKeys: [],
    };
    working.set(path, target);
    return target;
  };

  try {
    for (const planned of installPlan.operations) {
      const targetPath = operationTarget(
        planned,
        installPlan.project.configPath,
      );
      const target = await getWorking(targetPath);
      const key = `${planned.block}:${operationKey(planned.operation)}`;
      target.operationKeys.push(key);
      if (planned.state !== "pending") continue;

      switch (planned.operation.kind) {
        case "dependency.ensure":
          target.content = ensureJsoncImports(target.content, [{
            alias: planned.operation.alias,
            specifier: planned.operation.specifier,
          }]);
          break;
        case "env.ensure":
          target.content = appendLine(
            target.content,
            `${planned.operation.name}=${planned.operation.placeholder}`,
          );
          break;
        case "css.ensure":
          target.content = appendLine(
            target.content,
            planned.operation.statement,
          );
          break;
        case "file.create": {
          const block = blockByName.get(planned.block)!;
          target.content = await loadBlockTemplate(
            block,
            planned.operation.template,
          );
          break;
        }
      }
    }
  } catch (error) {
    if (
      error instanceof BlockTemplateError || error instanceof JsoncEditError ||
      error instanceof ExecutionPlanError
    ) {
      installPlan = planWithIssue(installPlan, requested, error.message);
      return {
        installPlan,
        mutations: [],
        directoriesToCreate: [],
        manifest: null,
      };
    }
    throw error;
  }

  const mutations: ExecutableMutation[] = [];
  const afterHashes = new Map<string, string>();
  for (const target of working.values()) {
    const afterHash = await sha256(target.content);
    afterHashes.set(target.path, afterHash);
    if (!target.before.exists || target.before.hash !== afterHash) {
      mutations.push({
        path: target.path,
        before: target.before,
        content: target.content,
        afterHash,
        operationKeys: target.operationKeys,
      });
    }
  }

  const manifestOperations: ManifestOperation[] = installPlan.operations.map(
    (planned) => {
      const target = operationTarget(planned, installPlan.project.configPath);
      return {
        block: planned.block,
        key: operationKey(planned.operation),
        kind: planned.operation.kind,
        target,
        contentHash: afterHashes.get(target)!,
      };
    },
  );
  const manifest = mergeManifest(
    existingManifest,
    installPlan,
    manifestOperations,
    cliVersion,
  );
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  const manifestBefore = await readTextState(root, MANIFEST_PATH);
  const manifestAfterHash = await sha256(manifestContent);
  if (!manifestBefore.exists || manifestBefore.hash !== manifestAfterHash) {
    mutations.push({
      path: MANIFEST_PATH,
      before: manifestBefore,
      content: manifestContent,
      afterHash: manifestAfterHash,
      operationKeys: ["installer:manifest"],
    });
  }

  const directoriesToCreate = await missingParentDirectories(
    root,
    [JOURNAL_PATH, ...mutations.map((mutation) => mutation.path)],
  );
  return { installPlan, mutations, directoriesToCreate, manifest };
}

async function verifyMutation(
  root: string,
  mutation: ExecutableMutation,
): Promise<void> {
  const current = await readTextState(root, mutation.path);
  if (
    current.exists !== mutation.before.exists ||
    current.hash !== mutation.before.hash
  ) {
    throw new InstallExecutionError(
      `stale plan: ${mutation.path} changed after preflight`,
    );
  }
}

function validateJournal(value: unknown): InstallJournal {
  if (
    !isRecord(value) || value.schemaVersion !== 1 ||
    !Array.isArray(value.mutations) || !Array.isArray(value.createdDirectories)
  ) {
    throw new InstallExecutionError("install journal has an invalid shape");
  }
  const mutations = value.mutations.map((entry, index) => {
    if (
      !isRecord(entry) || typeof entry.path !== "string" ||
      typeof entry.beforeExists !== "boolean" ||
      !(entry.beforeHash === null ||
        (typeof entry.beforeHash === "string" &&
          /^[0-9a-f]{64}$/.test(entry.beforeHash))) ||
      !(entry.beforeContent === null ||
        typeof entry.beforeContent === "string") ||
      typeof entry.afterHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry.afterHash) ||
      (entry.beforeExists &&
        (entry.beforeHash === null || entry.beforeContent === null)) ||
      (!entry.beforeExists &&
        (entry.beforeHash !== null || entry.beforeContent !== null))
    ) {
      throw new InstallExecutionError(
        `install journal mutations[${index}] is invalid`,
      );
    }
    return {
      path: entry.path,
      beforeExists: entry.beforeExists,
      beforeHash: entry.beforeHash,
      beforeContent: entry.beforeContent,
      afterHash: entry.afterHash,
    };
  });
  const createdDirectories = value.createdDirectories.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new InstallExecutionError(
        `install journal createdDirectories[${index}] is invalid`,
      );
    }
    return entry;
  });
  if (new Set(mutations.map((entry) => entry.path)).size !== mutations.length) {
    throw new InstallExecutionError(
      "install journal contains duplicate targets",
    );
  }
  if (new Set(createdDirectories).size !== createdDirectories.length) {
    throw new InstallExecutionError(
      "install journal contains duplicate directories",
    );
  }
  return { schemaVersion: 1, mutations, createdDirectories };
}

export async function recoverInterruptedInstall(
  root: string,
): Promise<boolean> {
  const journalTarget = await resolveContainedTarget(root, JOURNAL_PATH);
  if (!(await targetExists(journalTarget))) return false;
  const info = await Deno.lstat(journalTarget);
  if (!info.isFile) {
    throw new InstallExecutionError(
      `${JOURNAL_PATH} exists but is not a regular file`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(journalTarget));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InstallExecutionError("install journal is not valid JSON");
    }
    throw error;
  }
  const journal = validateJournal(parsed);

  const targets: string[] = [];
  for (const mutation of journal.mutations) {
    targets.push(await resolveContainedTarget(root, mutation.path));
    if (
      mutation.beforeExists &&
      await sha256(mutation.beforeContent!) !== mutation.beforeHash
    ) {
      throw new InstallExecutionError(
        `install journal preimage hash is invalid for ${mutation.path}`,
      );
    }
  }
  const directoryTargets: string[] = [];
  for (const directory of journal.createdDirectories) {
    directoryTargets.push(await resolveContainedTarget(root, directory));
  }

  const actions: Array<"none" | "restore" | "remove"> = [];
  for (const mutation of journal.mutations) {
    let current: TextState;
    try {
      current = await readTextState(root, mutation.path);
    } catch (error) {
      throw new InstallExecutionError(
        `stale recovery: cannot verify ${mutation.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (mutation.beforeExists) {
      if (current.exists && current.hash === mutation.beforeHash) {
        actions.push("none");
      } else if (current.exists && current.hash === mutation.afterHash) {
        actions.push("restore");
      } else {
        throw new InstallExecutionError(
          `stale recovery: ${mutation.path} no longer matches its recorded before or after hash; journal was preserved`,
        );
      }
    } else if (!current.exists) {
      actions.push("none");
    } else if (current.hash === mutation.afterHash) {
      actions.push("remove");
    } else {
      throw new InstallExecutionError(
        `stale recovery: ${mutation.path} no longer matches its recorded after hash; journal was preserved`,
      );
    }
  }

  for (let index = journal.mutations.length - 1; index >= 0; index--) {
    const mutation = journal.mutations[index];
    const target = targets[index];
    if (actions[index] === "restore") {
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.writeTextFile(target, mutation.beforeContent!);
    } else if (actions[index] === "remove") {
      const info = await Deno.lstat(target);
      if (!info.isFile) {
        throw new InstallExecutionError(
          `cannot recover ${mutation.path}: target is not a regular file`,
        );
      }
      await Deno.remove(target);
    }
  }

  await Deno.remove(journalTarget);
  for (let index = directoryTargets.length - 1; index >= 0; index--) {
    const target = directoryTargets[index];
    try {
      let empty = true;
      for await (const _entry of Deno.readDir(target)) {
        empty = false;
        break;
      }
      if (!empty) continue;
      await Deno.remove(target);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return true;
}

export async function executeInstallPlan(
  plan: ExecutableInstallPlan,
  hooks: ExecuteHooks = {},
): Promise<ExecuteResult> {
  if (plan.installPlan.issues.length > 0 || !plan.manifest) {
    throw new InstallExecutionError(
      "cannot execute a plan that failed preflight",
    );
  }
  if (plan.mutations.length === 0) {
    return { changed: false, mutationCount: 0, manifest: plan.manifest };
  }

  const root = plan.installPlan.project.root;
  for (const mutation of plan.mutations) await verifyMutation(root, mutation);
  for (const directory of plan.directoriesToCreate) {
    const target = await resolveContainedTarget(root, directory);
    if (await targetExists(target)) {
      throw new InstallExecutionError(
        `stale plan: ${directory} appeared after preflight`,
      );
    }
  }

  const journal: InstallJournal = {
    schemaVersion: 1,
    mutations: plan.mutations.map((mutation) => ({
      path: mutation.path,
      beforeExists: mutation.before.exists,
      beforeHash: mutation.before.hash,
      beforeContent: mutation.before.content,
      afterHash: mutation.afterHash,
    })),
    createdDirectories: plan.directoriesToCreate,
  };
  const journalTarget = await resolveContainedTarget(root, JOURNAL_PATH);
  const journalDirectory = JOURNAL_PATH.split("/").slice(0, -1).join("/");
  const createdDirectories: string[] = [];
  let journalWritten = false;

  try {
    if (plan.directoriesToCreate.includes(journalDirectory)) {
      await Deno.mkdir(
        await resolveContainedTarget(root, journalDirectory),
      );
      createdDirectories.push(journalDirectory);
    }
    await Deno.writeTextFile(
      journalTarget,
      JSON.stringify(journal, null, 2) + "\n",
      { createNew: true },
    );
    journalWritten = true;

    for (const directory of plan.directoriesToCreate) {
      if (directory === journalDirectory) continue;
      await Deno.mkdir(await resolveContainedTarget(root, directory));
      createdDirectories.push(directory);
    }

    for (let index = 0; index < plan.mutations.length; index++) {
      const mutation = plan.mutations[index];
      await verifyMutation(root, mutation);
      const target = await resolveContainedTarget(root, mutation.path);
      await Deno.writeTextFile(target, mutation.content, {
        create: false,
        createNew: !mutation.before.exists,
      });
      const written = await readTextState(root, mutation.path);
      if (written.hash !== mutation.afterHash) {
        throw new InstallExecutionError(
          `post-write hash mismatch for ${mutation.path}`,
        );
      }
      await hooks.afterMutation?.(index, mutation);
    }
    await Deno.remove(journalTarget);
    return {
      changed: true,
      mutationCount: plan.mutations.length,
      manifest: plan.manifest,
    };
  } catch (error) {
    let recoveryError: unknown;
    try {
      if (journalWritten) {
        await recoverInterruptedInstall(root);
      } else {
        for (const directory of [...createdDirectories].reverse()) {
          const target = await resolveContainedTarget(root, directory);
          let empty = true;
          for await (const _entry of Deno.readDir(target)) {
            empty = false;
            break;
          }
          if (empty) await Deno.remove(target);
        }
      }
    } catch (caught) {
      recoveryError = caught;
    }
    const original = error instanceof Error ? error.message : String(error);
    if (recoveryError) {
      const recovery = recoveryError instanceof Error
        ? recoveryError.message
        : String(recoveryError);
      throw new InstallExecutionError(
        `${original}; automatic recovery failed: ${recovery}`,
      );
    }
    throw new InstallExecutionError(
      `${original}; installer changes were restored`,
    );
  }
}
