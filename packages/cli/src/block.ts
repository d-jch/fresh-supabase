import { posix, win32 } from "node:path";

export const CAPABILITIES = [
  "env-file-ignored",
  "fresh-2",
  "fresh-file-routes",
  "fresh-default-routes",
  "fresh-define-helper",
  "fresh-root-alias",
  "fresh-vite",
  "tailwind-4",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface FileCreateOperation {
  kind: "file.create";
  path: string;
  template: string;
}

export interface DependencyEnsureOperation {
  kind: "dependency.ensure";
  alias: string;
  specifier: string;
}

export interface ConfigExcludeEnsureOperation {
  kind: "config.exclude.ensure";
  pattern: string;
}

export interface EnvEnsureOperation {
  kind: "env.ensure";
  path: string;
  name: string;
  placeholder: string;
}

export interface CssEnsureOperation {
  kind: "css.ensure";
  path: string;
  statement: string;
}

export type BlockOperation =
  | FileCreateOperation
  | DependencyEnsureOperation
  | ConfigExcludeEnsureOperation
  | EnvEnsureOperation
  | CssEnsureOperation;

export interface UpstreamFileMapping {
  source: string;
  target: string;
}

export interface UpstreamDefinition {
  name: string;
  registryItem: string;
  registryDependencies: string[];
  files: UpstreamFileMapping[];
}

export interface BlockDefinition {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  requirements: Capability[];
  operations: BlockOperation[];
  postInstall: string[];
  upstream?: UpstreamDefinition;
}

export class BlockFormatError extends Error {
  override name = "BlockFormatError";
}

const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemanticVersion(value: unknown): value is string {
  return typeof value === "string" && SEMANTIC_VERSION.test(value);
}

export function compareSemanticVersions(left: string, right: string): number {
  const leftMatch = SEMANTIC_VERSION.exec(left);
  const rightMatch = SEMANTIC_VERSION.exec(right);
  if (!leftMatch || !rightMatch) {
    throw new TypeError("semantic version comparison requires valid versions");
  }

  for (let index = 1; index <= 3; index++) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }

  const leftPrerelease = leftMatch[4];
  const rightPrerelease = rightMatch[4];
  if (leftPrerelease === undefined && rightPrerelease === undefined) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;

  const leftIdentifiers = leftPrerelease.split(".");
  const rightIdentifiers = rightPrerelease.split(".");
  const count = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < count; index++) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) < Number(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function blockOperationKey(operation: BlockOperation): string {
  switch (operation.kind) {
    case "file.create":
      return `file:${operation.path}`;
    case "dependency.ensure":
      return `dependency:${operation.alias}`;
    case "config.exclude.ensure":
      return `config-exclude:${operation.pattern}`;
    case "env.ensure":
      return `env:${operation.path}:${operation.name}`;
    case "css.ensure":
      return `css:${operation.path}:${operation.statement}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BlockFormatError(`${label} must be an object`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BlockFormatError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new BlockFormatError(`${label} must be an array`);
  }
  return value.map((entry, index) =>
    requireString(entry, `${label}[${index}]`)
  );
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new BlockFormatError(
      `${label} contains unsupported field: ${unknown.sort().join(", ")}`,
    );
  }
}

export function validateBlockPath(value: unknown, label: string): string {
  const path = requireString(value, label);

  if (
    path.includes("\\") ||
    path.includes("\0") ||
    posix.isAbsolute(path) ||
    win32.isAbsolute(path)
  ) {
    throw new BlockFormatError(`${label} must be a portable relative path`);
  }

  const segments = path.split("/");
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    ) || posix.normalize(path) !== path
  ) {
    throw new BlockFormatError(`${label} contains an unsafe path segment`);
  }

  return path;
}

function validateOperation(value: unknown, index: number): BlockOperation {
  const label = `operations[${index}]`;
  const operation = requireRecord(value, label);
  const kind = requireString(operation.kind, `${label}.kind`);

  switch (kind) {
    case "file.create":
      rejectUnknownKeys(operation, ["kind", "path", "template"], label);
      return {
        kind,
        path: validateBlockPath(operation.path, `${label}.path`),
        template: validateBlockPath(operation.template, `${label}.template`),
      };
    case "dependency.ensure": {
      rejectUnknownKeys(operation, ["kind", "alias", "specifier"], label);
      const alias = requireString(operation.alias, `${label}.alias`);
      const specifier = requireString(
        operation.specifier,
        `${label}.specifier`,
      );
      if (!/^(?:jsr|npm):/.test(specifier)) {
        throw new BlockFormatError(
          `${label}.specifier must be an explicit jsr: or npm: specifier`,
        );
      }
      // deno-lint-ignore no-control-regex -- aliases reject terminal controls.
      if (/[\u0000-\u001f\u007f]/.test(alias)) {
        throw new BlockFormatError(
          `${label}.alias contains control characters`,
        );
      }
      // deno-lint-ignore no-control-regex -- specifiers reject controls.
      if (/\s|[\u0000-\u001f\u007f]/.test(specifier)) {
        throw new BlockFormatError(
          `${label}.specifier contains whitespace or control characters`,
        );
      }
      return { kind, alias, specifier };
    }
    case "config.exclude.ensure":
      rejectUnknownKeys(operation, ["kind", "pattern"], label);
      return {
        kind,
        pattern: validateBlockPath(operation.pattern, `${label}.pattern`),
      };
    case "env.ensure": {
      rejectUnknownKeys(
        operation,
        ["kind", "path", "name", "placeholder"],
        label,
      );
      const name = requireString(operation.name, `${label}.name`);
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw new BlockFormatError(
          `${label}.name is not a valid environment name`,
        );
      }
      const placeholder = requireString(
        operation.placeholder,
        `${label}.placeholder`,
      );
      // deno-lint-ignore no-control-regex -- env payloads are one safe line.
      if (/[\r\n\u0000]/.test(placeholder)) {
        throw new BlockFormatError(
          `${label}.placeholder must be a single safe line`,
        );
      }
      return {
        kind,
        path: validateBlockPath(operation.path, `${label}.path`),
        name,
        placeholder,
      };
    }
    case "css.ensure": {
      rejectUnknownKeys(operation, ["kind", "path", "statement"], label);
      const statement = requireString(
        operation.statement,
        `${label}.statement`,
      );
      // deno-lint-ignore no-control-regex -- CSS payloads are one safe line.
      if (/[\r\n\u0000]/.test(statement)) {
        throw new BlockFormatError(
          `${label}.statement must be a single safe line`,
        );
      }
      return {
        kind,
        path: validateBlockPath(operation.path, `${label}.path`),
        statement,
      };
    }
    default:
      throw new BlockFormatError(`${label}.kind is not supported: ${kind}`);
  }
}

function validateUpstream(value: unknown, label: string): UpstreamDefinition {
  const upstream = requireRecord(value, label);
  rejectUnknownKeys(
    upstream,
    ["name", "registryItem", "registryDependencies", "files"],
    label,
  );
  const name = requireString(upstream.name, `${label}.name`);
  const registryItem = requireString(
    upstream.registryItem,
    `${label}.registryItem`,
  );
  let registryUrl: URL;
  try {
    registryUrl = new URL(registryItem);
  } catch {
    throw new BlockFormatError(`${label}.registryItem must be an HTTPS URL`);
  }
  if (
    registryUrl.protocol !== "https:" || registryUrl.username ||
    registryUrl.password
  ) {
    throw new BlockFormatError(`${label}.registryItem must be an HTTPS URL`);
  }
  if (!Array.isArray(upstream.files) || upstream.files.length === 0) {
    throw new BlockFormatError(`${label}.files must be a non-empty array`);
  }
  const files = upstream.files.map((value, index) => {
    const fileLabel = `${label}.files[${index}]`;
    const file = requireRecord(value, fileLabel);
    rejectUnknownKeys(file, ["source", "target"], fileLabel);
    return {
      source: validateBlockPath(file.source, `${fileLabel}.source`),
      target: validateBlockPath(file.target, `${fileLabel}.target`),
    };
  });
  if (new Set(files.map((file) => file.source)).size !== files.length) {
    throw new BlockFormatError(`${label}.files contains duplicate sources`);
  }
  if (new Set(files.map((file) => file.target)).size !== files.length) {
    throw new BlockFormatError(`${label}.files contains duplicate targets`);
  }
  const registryDependencies = upstream.registryDependencies === undefined
    ? []
    : requireStringArray(
      upstream.registryDependencies,
      `${label}.registryDependencies`,
    );
  if (new Set(registryDependencies).size !== registryDependencies.length) {
    throw new BlockFormatError(
      `${label}.registryDependencies contains duplicates`,
    );
  }
  return {
    name,
    registryItem: registryUrl.href,
    registryDependencies,
    files,
  };
}

export function validateBlockDefinition(
  value: unknown,
  source = "block",
): BlockDefinition {
  const block = requireRecord(value, source);
  rejectUnknownKeys(
    block,
    [
      "schemaVersion",
      "name",
      "version",
      "description",
      "dependencies",
      "requirements",
      "operations",
      "postInstall",
      "upstream",
    ],
    source,
  );
  if (block.schemaVersion !== 1) {
    throw new BlockFormatError(`${source}.schemaVersion must be 1`);
  }

  const name = requireString(block.name, `${source}.name`);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new BlockFormatError(`${source}.name must use lower kebab-case`);
  }

  const version = requireString(block.version, `${source}.version`);
  if (!isSemanticVersion(version)) {
    throw new BlockFormatError(`${source}.version must be semantic versioning`);
  }

  const dependencies = requireStringArray(
    block.dependencies,
    `${source}.dependencies`,
  );
  for (const dependency of dependencies) {
    if (!/^[a-z][a-z0-9-]*$/.test(dependency)) {
      throw new BlockFormatError(
        `${source}.dependencies contains invalid block name: ${dependency}`,
      );
    }
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new BlockFormatError(`${source}.dependencies contains duplicates`);
  }
  const rawRequirements = requireStringArray(
    block.requirements,
    `${source}.requirements`,
  );
  const requirements = rawRequirements.map((requirement) => {
    if (!CAPABILITIES.includes(requirement as Capability)) {
      throw new BlockFormatError(
        `${source}.requirements contains unknown capability: ${requirement}`,
      );
    }
    return requirement as Capability;
  });
  if (new Set(requirements).size !== requirements.length) {
    throw new BlockFormatError(`${source}.requirements contains duplicates`);
  }

  if (!Array.isArray(block.operations)) {
    throw new BlockFormatError(`${source}.operations must be an array`);
  }

  const operations = block.operations.map(validateOperation);
  const operationKeys = operations.map(blockOperationKey);
  if (new Set(operationKeys).size !== operationKeys.length) {
    throw new BlockFormatError(`${source}.operations contains duplicates`);
  }

  const postInstall = block.postInstall === undefined
    ? []
    : requireStringArray(block.postInstall, `${source}.postInstall`);
  for (const [index, instruction] of postInstall.entries()) {
    if (/\p{Cc}/u.test(instruction)) {
      throw new BlockFormatError(
        `${source}.postInstall[${index}] contains control characters`,
      );
    }
  }

  return {
    schemaVersion: 1,
    name,
    version,
    description: requireString(block.description, `${source}.description`),
    dependencies,
    requirements,
    operations,
    postInstall,
    upstream: block.upstream === undefined
      ? undefined
      : validateUpstream(block.upstream, `${source}.upstream`),
  };
}
