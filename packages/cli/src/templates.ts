import type { BlockDefinition } from "./block.ts";
import { validateBlockPath } from "./block.ts";
import { getEmbeddedTemplate } from "./embedded_templates.ts";

export class BlockTemplateError extends Error {
  override name = "BlockTemplateError";
}

export function loadBlockTemplate(
  block: BlockDefinition,
  templatePath: string,
): string {
  validateBlockPath(templatePath, `${block.name}.template`);
  const template = getEmbeddedTemplate(block.name, templatePath);
  if (template === undefined) {
    throw new BlockTemplateError(
      `${block.name} is missing embedded template ${templatePath}`,
    );
  }
  return template;
}
