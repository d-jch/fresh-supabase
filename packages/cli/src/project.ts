import { join } from "node:path";
import { duplicateJsoncImportKeys, JsoncEditError } from "./jsonc_edit.ts";

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

interface TypeScriptToken {
  kind: "identifier" | "string" | "punctuation";
  value: string;
}

function tokenizeTypeScript(source: string): TypeScriptToken[] | null {
  const tokens: TypeScriptToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return null;
      index = end + 2;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      let closed = false;
      index++;
      for (; index < source.length; index++) {
        const current = source[index];
        if (current === "\\") {
          index++;
          value += source[index] ?? "";
        } else if (current === quote) {
          index++;
          closed = true;
          break;
        } else if (current === "\r" || current === "\n") {
          return null;
        } else {
          value += current;
        }
      }
      if (!closed) return null;
      tokens.push({ kind: "string", value });
      continue;
    }

    if (char === "`") {
      index++;
      let closed = false;
      for (; index < source.length; index++) {
        if (source[index] === "\\") {
          index++;
        } else if (source[index] === "`") {
          index++;
          closed = true;
          break;
        }
      }
      if (!closed) return null;
      continue;
    }

    // Regex literals are irrelevant to Vite plugin registration. Skipping a
    // slash-delimited expression keeps fake code inside a regex from becoming
    // parser evidence. A lone slash remains punctuation.
    if (char === "/") {
      let end = index + 1;
      let escaped = false;
      let closed = false;
      for (; end < source.length && !/[\r\n]/.test(source[end]); end++) {
        if (escaped) {
          escaped = false;
        } else if (source[end] === "\\") {
          escaped = true;
        } else if (source[end] === "/") {
          end++;
          while (/[A-Za-z]/.test(source[end] ?? "")) end++;
          closed = true;
          break;
        }
      }
      if (closed) {
        index = end;
        continue;
      }
    }

    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (/[A-Za-z0-9_$]/.test(source[end] ?? "")) end++;
      tokens.push({ kind: "identifier", value: source.slice(index, end) });
      index = end;
      continue;
    }

    const punctuation = source.startsWith("...", index) ? "..." : char;
    tokens.push({ kind: "punctuation", value: punctuation });
    index += punctuation.length;
  }

  return tokens;
}

function matchingToken(
  tokens: readonly TypeScriptToken[],
  start: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].value === open) depth++;
    if (tokens[index].value === close) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return null;
}

function importedPluginBindings(
  tokens: readonly TypeScriptToken[],
  packageName: string,
  expectedExport: "default" | string,
): string[] {
  const bindings: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== "import") continue;
    let from = index + 1;
    while (
      from < tokens.length && tokens[from].value !== "from" &&
      tokens[from].value !== ";"
    ) from++;
    if (
      tokens[from]?.value !== "from" ||
      tokens[from + 1]?.kind !== "string" ||
      tokens[from + 1].value !== packageName
    ) continue;

    if (expectedExport === "default") {
      const binding = tokens[index + 1];
      if (binding?.kind === "identifier") bindings.push(binding.value);
      continue;
    }

    const openOffset = tokens.slice(index + 1, from).findIndex((token) =>
      token.value === "{"
    );
    if (openOffset < 0) continue;
    const namedStart = index + 1 + openOffset;
    const namedEnd = matchingToken(tokens, namedStart, "{", "}");
    if (namedEnd === null || namedEnd > from) continue;
    for (let cursor = namedStart + 1; cursor < namedEnd; cursor++) {
      if (tokens[cursor].value !== expectedExport) continue;
      const alias = tokens[cursor + 1]?.value === "as"
        ? tokens[cursor + 2]
        : tokens[cursor];
      if (alias?.kind === "identifier") bindings.push(alias.value);
    }
  }

  return bindings;
}

function exportedPluginArray(
  tokens: readonly TypeScriptToken[],
): readonly TypeScriptToken[] | null {
  const candidates: Array<readonly TypeScriptToken[]> = [];
  const defineConfigBindings = importedPluginBindings(
    tokens,
    "vite",
    "defineConfig",
  );
  let defaultExports = 0;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].value;
    if (
      braces === 0 && brackets === 0 && parentheses === 0 &&
      value === "export" && tokens[index + 1]?.value === "default"
    ) {
      defaultExports++;
      let objectStart: number | null = null;
      if (
        tokens[index + 2]?.kind === "identifier" &&
        defineConfigBindings.includes(tokens[index + 2].value) &&
        tokens[index + 3]?.value === "(" &&
        tokens[index + 4]?.value === "{"
      ) {
        objectStart = index + 4;
      } else if (tokens[index + 2]?.value === "{") {
        objectStart = index + 2;
      }

      if (objectStart !== null) {
        const objectEnd = matchingToken(tokens, objectStart, "{", "}");
        if (objectEnd === null) return null;
        let innerBraces = 0;
        let innerBrackets = 0;
        let innerParentheses = 0;
        for (let cursor = objectStart + 1; cursor < objectEnd; cursor++) {
          const current = tokens[cursor].value;
          if (
            innerBraces === 0 && innerBrackets === 0 &&
            innerParentheses === 0 && current === "plugins" &&
            tokens[cursor + 1]?.value === ":" &&
            tokens[cursor + 2]?.value === "["
          ) {
            const arrayEnd = matchingToken(tokens, cursor + 2, "[", "]");
            if (arrayEnd === null || arrayEnd > objectEnd) return null;
            candidates.push(tokens.slice(cursor + 3, arrayEnd));
          }
          if (current === "{") innerBraces++;
          if (current === "}") innerBraces--;
          if (current === "[") innerBrackets++;
          if (current === "]") innerBrackets--;
          if (current === "(") innerParentheses++;
          if (current === ")") innerParentheses--;
        }
      }
    }

    if (value === "{") braces++;
    if (value === "}") braces--;
    if (value === "[") brackets++;
    if (value === "]") brackets--;
    if (value === "(") parentheses++;
    if (value === ")") parentheses--;
  }

  return defaultExports === 1 && candidates.length === 1 ? candidates[0] : null;
}

function importedPluginIsRegistered(
  source: string,
  packageName: string,
  expectedExport: "default" | string,
): boolean {
  const tokens = tokenizeTypeScript(source);
  if (!tokens) return false;
  const bindings = importedPluginBindings(
    tokens,
    packageName,
    expectedExport,
  );
  const plugins = exportedPluginArray(tokens);
  if (!plugins) return false;

  const elements: TypeScriptToken[][] = [];
  let current: TypeScriptToken[] = [];
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (const token of plugins) {
    if (
      token.value === "," && braces === 0 && brackets === 0 &&
      parentheses === 0
    ) {
      if (current.length > 0) elements.push(current);
      current = [];
      continue;
    }
    current.push(token);
    if (token.value === "{") braces++;
    if (token.value === "}") braces--;
    if (token.value === "[") brackets++;
    if (token.value === "]") brackets--;
    if (token.value === "(") parentheses++;
    if (token.value === ")") parentheses--;
  }
  if (current.length > 0) elements.push(current);

  return bindings.some((binding) =>
    elements.some((element) => {
      if (
        element[0]?.kind !== "identifier" ||
        element[0].value !== binding || element[1]?.value !== "("
      ) return false;
      return matchingToken(element, 1, "(", ")") === element.length - 1;
    })
  );
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
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
      output += source.slice(index, end + 2).replace(/[^\r\n]/g, " ");
      index = end + 1;
      continue;
    }
    output += char;
  }
  return output;
}

function hasCssPackageDirective(
  source: string,
  directive: "import" | "plugin",
  packageName: string,
): boolean {
  const withoutComments = stripCssComments(source);
  if (withoutComments === null) return false;
  const escapedPackage = escapeRegExp(packageName);
  const pattern = directive === "import"
    ? new RegExp(
      `^\\s*@import\\s+(?:url\\()?['"]${escapedPackage}['"]\\)?\\s*;\\s*$`,
    )
    : new RegExp(
      `^\\s*@plugin\\s+['"]${escapedPackage}['"]\\s*;\\s*$`,
    );
  return withoutComments.split(/\r?\n/).some((line) => pattern.test(line));
}

function hasStaticImport(source: string, specifier: string): boolean {
  const tokens = tokenizeTypeScript(source);
  if (!tokens) return false;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== "import") continue;
    if (tokens[index + 1]?.kind === "string") {
      if (tokens[index + 1].value === specifier) return true;
      continue;
    }
    let cursor = index + 1;
    while (
      cursor < tokens.length && tokens[cursor].value !== "from" &&
      tokens[cursor].value !== ";"
    ) cursor++;
    if (
      tokens[cursor]?.value === "from" &&
      tokens[cursor + 1]?.kind === "string" &&
      tokens[cursor + 1].value === specifier
    ) return true;
  }
  return false;
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

  try {
    const duplicates = duplicateJsoncImportKeys(rawConfig);
    if (duplicates.length > 0) {
      throw new ProjectInspectionError(
        `Deno config imports contains duplicate keys: ${duplicates.join(", ")}`,
      );
    }
  } catch (error) {
    if (error instanceof ProjectInspectionError) throw error;
    if (error instanceof JsoncEditError) {
      throw new ProjectInspectionError(
        `could not inspect Deno config imports: ${error.message}`,
      );
    }
    throw error;
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
    viteSource &&
      importedPluginIsRegistered(viteSource, "@fresh/plugin-vite", "fresh")
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
    hasCssPackageDirective(stylesSource, "import", "tailwindcss");
  const clientImportsStyles = clientSource !== null &&
    hasStaticImport(clientSource, "./assets/styles.css");
  const tailwindEvidence = [
    tailwindMajor === 4 ? null : "tailwindcss major version 4",
    tailwindViteSpecifier ? null : "@tailwindcss/vite import",
    viteSource &&
      importedPluginIsRegistered(viteSource, "@tailwindcss/vite", "default")
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
    hasCssPackageDirective(stylesSource, "plugin", "daisyui");
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
