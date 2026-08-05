import type { BlockDefinition } from "./block.ts";
import { validateBlockPath } from "./block.ts";

export class BlockTemplateError extends Error {
  override name = "BlockTemplateError";
}

export async function loadBlockTemplate(
  block: BlockDefinition,
  templatePath: string,
): Promise<string> {
  validateBlockPath(templatePath, `${block.name}.template`);
  const base = new URL(`../blocks/${block.name}/`, import.meta.url);
  const target = new URL(templatePath, base);
  if (!target.href.startsWith(base.href)) {
    throw new BlockTemplateError(
      `${block.name} template escapes its embedded block directory`,
    );
  }

  try {
    return await Deno.readTextFile(target);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new BlockTemplateError(
        `${block.name} is missing embedded template ${templatePath}`,
      );
    }
    throw error;
  }
}
