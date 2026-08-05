import { join } from "node:path";

export type CapabilityStatus = "ok" | "missing" | "unsupported" | "unverified";

export interface CapabilityResult {
  status: CapabilityStatus;
  detail: string;
}

export interface ProjectCapabilities {
  fresh2: CapabilityResult;
  vite: CapabilityResult;
  tailwind4: CapabilityResult;
  daisyui: CapabilityResult;
}

export interface ProjectInspection {
  root: string;
  configPath: "deno.json" | "deno.jsonc";
  config: Record<string, unknown>;
  imports: Record<string, string>;
  capabilities: ProjectCapabilities;
}

export class ProjectInspectionError extends Error {
  override name = "ProjectInspectionError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        output += char;
      } else {
        output += " ";
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        output += "  ";
        index++;
      } else {
        output += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      output += "  ";
      index++;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      output += "  ";
      index++;
    } else {
      output += char;
    }
  }

  if (blockComment) {
    throw new ProjectInspectionError(
      "deno.jsonc contains an unterminated comment",
    );
  }
  return output;
}

function stripTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(input[lookahead] ?? "")) lookahead++;
      if (input[lookahead] === "}" || input[lookahead] === "]") {
        output += " ";
        continue;
      }
    }

    output += char;
  }

  return output;
}

export function parseJsonc(text: string): unknown {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(withoutBom)));
  } catch (error) {
    if (error instanceof ProjectInspectionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProjectInspectionError(`could not parse Deno config: ${detail}`);
  }
}

function collectImports(
  config: Record<string, unknown>,
): Record<string, string> {
  if (!isRecord(config.imports)) return {};
  const imports: Record<string, string> = {};
  for (const [alias, specifier] of Object.entries(config.imports)) {
    if (typeof specifier === "string") imports[alias] = specifier;
  }
  return imports;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPackageSpecifier(
  imports: Record<string, string>,
  protocol: "jsr" | "npm",
  packageName: string,
): string | null {
  const pattern = new RegExp(
    `^${protocol}:${escapeRegExp(packageName)}(?:@|$)`,
  );
  return Object.values(imports).find((specifier) => pattern.test(specifier)) ??
    null;
}

function extractMajor(specifier: string, packageName: string): number | null {
  const marker = `${packageName}@`;
  const markerIndex = specifier.indexOf(marker);
  if (markerIndex < 0) return null;
  const range = specifier.slice(markerIndex + marker.length);
  const match = range.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function importedPluginIsRegistered(
  source: string,
  packageName: string,
): boolean {
  const packagePattern = escapeRegExp(packageName);
  const defaultImport = source.match(
    new RegExp(
      `import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["']${packagePattern}["']`,
    ),
  );
  const bindings: string[] = defaultImport ? [defaultImport[1]] : [];

  const namedImport = source.match(
    new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${packagePattern}["']`,
    ),
  );
  if (namedImport) {
    for (const entry of namedImport[1].split(",")) {
      const parts = entry.trim().split(/\s+as\s+/);
      const binding = parts.at(-1);
      if (binding && /^[A-Za-z_$][\w$]*$/.test(binding)) bindings.push(binding);
    }
  }

  const pluginArrays = [...source.matchAll(/\bplugins\s*:\s*\[([^\]]*)\]/gs)]
    .map((match) => match[1]);
  return bindings.some((binding) =>
    pluginArrays.some((plugins) =>
      new RegExp(`\\b${escapeRegExp(binding)}\\s*\\(`).test(plugins)
    )
  );
}

function result(status: CapabilityStatus, detail: string): CapabilityResult {
  return { status, detail };
}

export async function inspectProject(
  root = Deno.cwd(),
): Promise<ProjectInspection> {
  let resolvedRoot: string;
  try {
    resolvedRoot = await Deno.realPath(root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProjectInspectionError(
      `could not resolve project directory: ${detail}`,
    );
  }

  const jsonPath = join(resolvedRoot, "deno.json");
  const jsoncPath = join(resolvedRoot, "deno.jsonc");
  const [hasJson, hasJsonc] = await Promise.all([
    exists(jsonPath),
    exists(jsoncPath),
  ]);

  if (hasJson && hasJsonc) {
    throw new ProjectInspectionError(
      "both deno.json and deno.jsonc exist; project configuration is ambiguous",
    );
  }
  if (!hasJson && !hasJsonc) {
    throw new ProjectInspectionError("no deno.json or deno.jsonc was found");
  }

  const configPath = hasJson ? "deno.json" : "deno.jsonc";
  const rawConfig = await Deno.readTextFile(join(resolvedRoot, configPath));
  const parsed = configPath === "deno.jsonc" ? parseJsonc(rawConfig) : (() => {
    try {
      return JSON.parse(rawConfig) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ProjectInspectionError(`could not parse deno.json: ${detail}`);
    }
  })();

  if (!isRecord(parsed)) {
    throw new ProjectInspectionError("Deno config must contain a JSON object");
  }

  const imports = collectImports(parsed);
  const freshSpecifier = findPackageSpecifier(
    imports,
    "jsr",
    "@fresh/core",
  );
  const freshMajor = freshSpecifier
    ? extractMajor(freshSpecifier, "@fresh/core")
    : null;
  const fresh2 = !freshSpecifier
    ? result("missing", "jsr:@fresh/core is not present in imports")
    : freshMajor === 2
    ? result("ok", freshSpecifier)
    : result(
      "unsupported",
      `expected Fresh 2, found ${freshSpecifier}`,
    );

  const viteSource = await readOptionalText(
    join(resolvedRoot, "vite.config.ts"),
  );
  const freshViteSpecifier = findPackageSpecifier(
    imports,
    "jsr",
    "@fresh/plugin-vite",
  );
  const viteSpecifier = findPackageSpecifier(imports, "npm", "vite");
  const viteEvidence = [
    freshViteSpecifier ? null : "@fresh/plugin-vite import",
    viteSpecifier ? null : "vite import",
    viteSource ? null : "vite.config.ts",
    viteSource && importedPluginIsRegistered(viteSource, "@fresh/plugin-vite")
      ? null
      : "fresh() Vite plugin registration",
  ].filter((entry): entry is string => entry !== null);
  const vite = viteEvidence.length === 0
    ? result("ok", "Fresh Vite plugin is configured")
    : result(
      freshViteSpecifier || viteSpecifier || viteSource
        ? "unverified"
        : "missing",
      `could not verify: ${viteEvidence.join(", ")}`,
    );

  const tailwindSpecifier = findPackageSpecifier(
    imports,
    "npm",
    "tailwindcss",
  );
  const tailwindMajor = tailwindSpecifier
    ? extractMajor(tailwindSpecifier, "tailwindcss")
    : null;
  const tailwindViteSpecifier = findPackageSpecifier(
    imports,
    "npm",
    "@tailwindcss/vite",
  );
  const stylesSource = await readOptionalText(
    join(resolvedRoot, "assets", "styles.css"),
  );
  const clientSource = await readOptionalText(join(resolvedRoot, "client.ts"));
  const hasTailwindCssImport = stylesSource !== null &&
    /@import\s+(?:url\()?['"]tailwindcss['"]\)?\s*;/.test(stylesSource);
  const clientImportsStyles = clientSource !== null &&
    /(?:import|from)\s*['"]\.\/assets\/styles\.css['"]/.test(clientSource);
  const tailwindEvidence = [
    tailwindMajor === 4 ? null : "tailwindcss major version 4",
    tailwindViteSpecifier ? null : "@tailwindcss/vite import",
    viteSource && importedPluginIsRegistered(viteSource, "@tailwindcss/vite")
      ? null
      : "Tailwind Vite plugin registration",
    hasTailwindCssImport ? null : '@import "tailwindcss" in assets/styles.css',
    clientImportsStyles ? null : "client.ts importing assets/styles.css",
  ].filter((entry): entry is string => entry !== null);
  const anyTailwindEvidence = Boolean(
    tailwindSpecifier || tailwindViteSpecifier || hasTailwindCssImport,
  );
  const tailwind4 = tailwindEvidence.length === 0
    ? result("ok", tailwindSpecifier!)
    : result(
      anyTailwindEvidence ? "unverified" : "missing",
      `could not verify: ${tailwindEvidence.join(", ")}`,
    );

  const daisyuiSpecifier = findPackageSpecifier(imports, "npm", "daisyui");
  const hasDaisyPlugin = stylesSource !== null &&
    /@plugin\s+['"]daisyui['"]\s*;/.test(stylesSource);
  const daisyui = daisyuiSpecifier && hasDaisyPlugin
    ? result("ok", daisyuiSpecifier)
    : result(
      daisyuiSpecifier || hasDaisyPlugin ? "unverified" : "missing",
      "daisyui dependency and CSS plugin are not both present",
    );

  return {
    root: resolvedRoot,
    configPath,
    config: parsed,
    imports,
    capabilities: { fresh2, vite, tailwind4, daisyui },
  };
}
