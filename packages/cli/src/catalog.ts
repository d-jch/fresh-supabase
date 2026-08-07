import daisyuiJson from "../blocks/daisyui/block.json" with { type: "json" };
import passwordAuthJson from "../blocks/password-based-auth/block.json" with {
  type: "json",
};
import clientJson from "../blocks/client/block.json" with {
  type: "json",
};
import {
  type BlockDefinition,
  BlockFormatError,
  validateBlockDefinition,
} from "./block.ts";

const rawBlocks: ReadonlyArray<[string, unknown]> = [
  ["daisyui", daisyuiJson],
  ["client", clientJson],
  ["password-based-auth", passwordAuthJson],
];

const blockMap = new Map<string, BlockDefinition>();

for (const [expectedName, rawBlock] of rawBlocks) {
  const block = validateBlockDefinition(rawBlock, `blocks/${expectedName}`);
  if (block.name !== expectedName) {
    throw new BlockFormatError(
      `blocks/${expectedName}.name must match its directory name`,
    );
  }
  if (blockMap.has(block.name)) {
    throw new BlockFormatError(`duplicate block name: ${block.name}`);
  }
  blockMap.set(block.name, block);
}

for (const block of blockMap.values()) {
  for (const dependency of block.dependencies) {
    if (!blockMap.has(dependency)) {
      throw new BlockFormatError(
        `${block.name} depends on unknown block: ${dependency}`,
      );
    }
  }
}

export function listBlocks(): BlockDefinition[] {
  return [...blockMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getBlock(name: string): BlockDefinition | undefined {
  return blockMap.get(name);
}

export function resolveBlockOrder(
  requested: string | readonly string[],
): BlockDefinition[] {
  const names = typeof requested === "string" ? [requested] : [...requested];
  if (names.length === 0) {
    throw new BlockFormatError("at least one block is required");
  }
  const ordered: BlockDefinition[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (block: BlockDefinition): void => {
    if (visited.has(block.name)) return;
    if (visiting.has(block.name)) {
      throw new BlockFormatError(`block dependency cycle at ${block.name}`);
    }

    visiting.add(block.name);
    for (const dependencyName of block.dependencies) {
      const dependency = getBlock(dependencyName);
      if (!dependency) {
        throw new BlockFormatError(
          `${block.name} depends on unknown block: ${dependencyName}`,
        );
      }
      visit(dependency);
    }
    visiting.delete(block.name);
    visited.add(block.name);
    ordered.push(block);
  };

  for (const name of names) {
    const root = getBlock(name);
    if (!root) throw new BlockFormatError(`unknown block: ${name}`);
    visit(root);
  }
  return ordered;
}
