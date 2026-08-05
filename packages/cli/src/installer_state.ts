import { type BlockOperation, validateBlockPath } from "./block.ts";

export const MANIFEST_PATH = ".fresh-supabase/manifest.json";
export const JOURNAL_PATH = ".fresh-supabase/install-journal.json";

export interface ManifestBlock {
  name: string;
  version: string;
}

export interface ManifestOperation {
  block: string;
  key: string;
  kind: BlockOperation["kind"];
  target: string;
  contentHash: string;
}

export interface InstallerManifest {
  schemaVersion: 1;
  cliVersion: string;
  blocks: ManifestBlock[];
  operations: ManifestOperation[];
}

export class InstallerStateError extends Error {
  override name = "InstallerStateError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateInstallerManifest(value: unknown): InstallerManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new InstallerStateError("installer manifest schemaVersion must be 1");
  }
  if (
    Object.keys(value).some((key) =>
      !["schemaVersion", "cliVersion", "blocks", "operations"].includes(key)
    )
  ) {
    throw new InstallerStateError("installer manifest contains unknown fields");
  }
  if (
    typeof value.cliVersion !== "string" || !Array.isArray(value.blocks) ||
    !Array.isArray(value.operations)
  ) {
    throw new InstallerStateError("installer manifest has an invalid shape");
  }

  const blocks = value.blocks.map((entry, index): ManifestBlock => {
    if (
      !isRecord(entry) || typeof entry.name !== "string" ||
      typeof entry.version !== "string" ||
      Object.keys(entry).some((key) => !["name", "version"].includes(key))
    ) {
      throw new InstallerStateError(
        `installer manifest blocks[${index}] is invalid`,
      );
    }
    return { name: entry.name, version: entry.version };
  });
  const validKinds = new Set([
    "file.create",
    "dependency.ensure",
    "env.ensure",
    "css.ensure",
  ]);
  const operations = value.operations.map(
    (entry, index): ManifestOperation => {
      if (
        !isRecord(entry) || typeof entry.block !== "string" ||
        typeof entry.key !== "string" || typeof entry.kind !== "string" ||
        !validKinds.has(entry.kind) || typeof entry.target !== "string" ||
        typeof entry.contentHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(entry.contentHash) ||
        Object.keys(entry).some((key) =>
          !["block", "key", "kind", "target", "contentHash"].includes(key)
        )
      ) {
        throw new InstallerStateError(
          `installer manifest operations[${index}] is invalid`,
        );
      }
      try {
        validateBlockPath(entry.target, `manifest.operations[${index}].target`);
      } catch {
        throw new InstallerStateError(
          `installer manifest operations[${index}] has an unsafe target`,
        );
      }
      return {
        block: entry.block,
        key: entry.key,
        kind: entry.kind as BlockOperation["kind"],
        target: entry.target,
        contentHash: entry.contentHash,
      };
    },
  );
  if (new Set(blocks.map((block) => block.name)).size !== blocks.length) {
    throw new InstallerStateError(
      "installer manifest contains duplicate blocks",
    );
  }
  const operationIds = operations.map((entry) =>
    `${entry.block}\0${entry.key}`
  );
  if (new Set(operationIds).size !== operationIds.length) {
    throw new InstallerStateError(
      "installer manifest contains duplicate operations",
    );
  }
  return {
    schemaVersion: 1,
    cliVersion: value.cliVersion,
    blocks,
    operations,
  };
}
