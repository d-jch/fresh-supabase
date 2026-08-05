import { posix, win32 } from "node:path";

export const CAPABILITIES = [
  "fresh-2",
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
  | EnvEnsureOperation
  | CssEnsureOperation;

export interface BlockDefinition {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  requirements: Capability[];
  operations: BlockOperation[];
}

export class BlockFormatError extends Error {
  override name = "BlockFormatError";
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
      return { kind, alias, specifier };
    }
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
      return {
        kind,
        path: validateBlockPath(operation.path, `${label}.path`),
        name,
        placeholder: requireString(
          operation.placeholder,
          `${label}.placeholder`,
        ),
      };
    }
    case "css.ensure":
      rejectUnknownKeys(operation, ["kind", "path", "statement"], label);
      return {
        kind,
        path: validateBlockPath(operation.path, `${label}.path`),
        statement: requireString(operation.statement, `${label}.statement`),
      };
    default:
      throw new BlockFormatError(`${label}.kind is not supported: ${kind}`);
  }
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
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
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

  return {
    schemaVersion: 1,
    name,
    version,
    description: requireString(block.description, `${source}.description`),
    dependencies,
    requirements,
    operations: block.operations.map(validateOperation),
  };
}
