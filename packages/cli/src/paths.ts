import { isAbsolute, join, relative } from "node:path";
import { validateBlockPath } from "./block.ts";

export class PathSecurityError extends Error {
  override name = "PathSecurityError";
}

function isContained(root: string, target: string): boolean {
  const offset = relative(root, target);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

export async function resolveContainedTarget(
  root: string,
  projectPath: string,
): Promise<string> {
  validateBlockPath(projectPath, "operation.path");
  const rootReal = await Deno.realPath(root);
  let current = rootReal;

  for (const segment of projectPath.split("/")) {
    const candidate = join(current, segment);
    let info: Deno.FileInfo;
    try {
      info = await Deno.lstat(candidate);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        current = candidate;
        continue;
      }
      throw error;
    }

    if (info.isSymlink) {
      const resolved = await Deno.realPath(candidate);
      if (!isContained(rootReal, resolved)) {
        throw new PathSecurityError(
          `${projectPath} escapes the project through a symlink`,
        );
      }
      throw new PathSecurityError(
        `${projectPath} traverses a symlink and cannot be modified safely`,
      );
    }
    current = candidate;
  }

  if (!isContained(rootReal, current)) {
    throw new PathSecurityError(`${projectPath} escapes the project root`);
  }
  return current;
}

export async function targetExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
