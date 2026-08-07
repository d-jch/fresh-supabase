import { join } from "node:path";
import { duplicateJsoncImportKeys, JsoncEditError } from "./jsonc_edit.ts";

export type CapabilityStatus = "ok" | "missing" | "unsupported" | "unverified";

export interface CapabilityResult {
  status: CapabilityStatus;
  detail: string;
}

export interface ProjectCapabilities {
  envFileIgnored: CapabilityResult;
  fresh2: CapabilityResult;
  freshFileRoutes: CapabilityResult;
  freshDefaultRoutes: CapabilityResult;
  freshDefineHelper: CapabilityResult;
  freshRootAlias: CapabilityResult;
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
      if (
        binding?.kind === "identifier" && binding.value !== "type" &&
        binding.value !== "from"
      ) bindings.push(binding.value);
      continue;
    }

    const openOffset = tokens.slice(index + 1, from).findIndex((token) =>
      token.value === "{"
    );
    if (openOffset < 0) continue;
    const namedStart = index + 1 + openOffset;
    const namedEnd = matchingToken(tokens, namedStart, "{", "}");
    if (namedEnd === null || namedEnd > from) continue;
    for (
      const specifier of topLevelElements(
        tokens.slice(namedStart + 1, namedEnd),
      )
    ) {
      if (specifier[0]?.value === "type") continue;
      const imported = specifier[0];
      if (
        imported?.kind !== "identifier" ||
        imported.value !== expectedExport
      ) continue;
      const binding = specifier[1]?.value === "as" ? specifier[2] : imported;
      if (binding?.kind === "identifier") bindings.push(binding.value);
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

function topLevelElements(
  tokens: readonly TypeScriptToken[],
): TypeScriptToken[][] {
  const elements: TypeScriptToken[][] = [];
  let current: TypeScriptToken[] = [];
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (const token of tokens) {
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
  return elements;
}

function inspectFreshRouteDirectory(source: string): CapabilityResult {
  const tokens = tokenizeTypeScript(source);
  if (!tokens) {
    return result("unverified", "could not parse vite.config.ts");
  }
  const bindings = importedPluginBindings(
    tokens,
    "@fresh/plugin-vite",
    "fresh",
  );
  const plugins = exportedPluginArray(tokens);
  if (!plugins) {
    return result("unverified", "could not identify the Vite plugins array");
  }
  const calls = topLevelElements(plugins).filter((element) =>
    element[0]?.kind === "identifier" &&
    bindings.includes(element[0].value) && element[1]?.value === "(" &&
    matchingToken(element, 1, "(", ")") === element.length - 1
  );
  if (calls.length !== 1) {
    return result(
      "unverified",
      "expected exactly one direct fresh() Vite plugin call",
    );
  }

  const args = calls[0].slice(2, -1);
  if (args.length === 0) return result("ok", "default ./routes directory");
  if (
    args[0]?.value !== "{" ||
    matchingToken(args, 0, "{", "}") !== args.length - 1
  ) {
    return result(
      "unverified",
      "fresh() options are not a static object literal",
    );
  }

  const routeDirectories: string[] = [];
  for (const property of topLevelElements(args.slice(1, -1))) {
    if (property[0]?.value === "...") {
      return result(
        "unverified",
        "fresh() options use a spread that may override routeDir",
      );
    }

    let key: TypeScriptToken | undefined;
    let colonIndex = 1;
    if (property[0]?.value === "[") {
      const computedEnd = matchingToken(property, 0, "[", "]");
      if (
        computedEnd === null || computedEnd !== 2 ||
        property[1]?.kind !== "string"
      ) {
        return result(
          "unverified",
          "fresh() options use a dynamic computed property that may override routeDir",
        );
      }
      key = property[1];
      colonIndex = computedEnd + 1;
    } else {
      key = property[0];
      if (
        ["get", "set", "async"].includes(key?.value ?? "") &&
        property[1]?.value === "routeDir"
      ) {
        return result(
          "unverified",
          "routeDir is not a static string property",
        );
      }
    }

    if (
      key?.value !== "routeDir" ||
      (key.kind !== "identifier" && key.kind !== "string")
    ) continue;
    if (property[colonIndex]?.value !== ":") {
      return result("unverified", "routeDir is not a static string property");
    }
    const value = property[colonIndex + 1];
    if (
      value?.kind !== "string" || property.length !== colonIndex + 2
    ) {
      return result("unverified", "routeDir is not a static string property");
    }
    routeDirectories.push(value.value);
  }

  if (routeDirectories.length > 1) {
    return result(
      "unverified",
      "fresh() options contain duplicate routeDir properties",
    );
  }
  const routeDirectory = routeDirectories[0];
  if (routeDirectory === undefined) {
    return result("ok", "default ./routes directory");
  }
  return routeDirectory === "routes" || routeDirectory === "./routes"
    ? result(
      "ok",
      `default-compatible routeDir ${JSON.stringify(routeDirectory)}`,
    )
    : result(
      "unsupported",
      `block targets require ./routes, found routeDir ${
        JSON.stringify(routeDirectory)
      }`,
    );
}

function inspectFreshFileRoutes(source: string): CapabilityResult {
  const tokens = tokenizeTypeScript(source);
  if (!tokens) return result("unverified", "could not parse main.ts");

  const appBindings = importedPluginBindings(tokens, "fresh", "App");
  const staticBindings = importedPluginBindings(
    tokens,
    "fresh",
    "staticFiles",
  );
  const appInstances = new Set<string>();
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const topLevel = braces === 0 && brackets === 0 && parentheses === 0;
    let constructorCall = index + 5;
    if (tokens[constructorCall]?.value === "<") {
      const typeArgumentsEnd = matchingToken(
        tokens,
        constructorCall,
        "<",
        ">",
      );
      constructorCall = typeArgumentsEnd === null ? -1 : typeArgumentsEnd + 1;
    }
    if (
      topLevel && token.value === "const" &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 2]?.value === "=" &&
      tokens[index + 3]?.value === "new" &&
      appBindings.includes(tokens[index + 4]?.value) &&
      tokens[constructorCall]?.value === "(" &&
      matchingToken(tokens, constructorCall, "(", ")") !== null
    ) {
      appInstances.add(tokens[index + 1].value);
    }
    if (token.value === "{") braces++;
    if (token.value === "}") braces--;
    if (token.value === "[") brackets++;
    if (token.value === "]") brackets--;
    if (token.value === "(") parentheses++;
    if (token.value === ")") parentheses--;
  }

  const registrations = new Map<
    string,
    { staticFiles: boolean; fileRoutes: boolean }
  >(
    [...appInstances].map((name) => [
      name,
      { staticFiles: false, fileRoutes: false },
    ]),
  );
  braces = 0;
  brackets = 0;
  parentheses = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const topLevel = braces === 0 && brackets === 0 && parentheses === 0;
    const registration = topLevel && token.kind === "identifier"
      ? registrations.get(token.value)
      : undefined;
    if (
      registration && tokens[index + 1]?.value === "." &&
      tokens[index + 2]?.value === "use" &&
      tokens[index + 3]?.value === "("
    ) {
      const callEnd = matchingToken(tokens, index + 3, "(", ")");
      if (callEnd !== null) {
        const argumentsList = topLevelElements(
          tokens.slice(index + 4, callEnd),
        );
        registration.staticFiles ||= argumentsList.some((argument) =>
          argument[0]?.kind === "identifier" &&
          staticBindings.includes(argument[0].value) &&
          argument[1]?.value === "(" &&
          matchingToken(argument, 1, "(", ")") === argument.length - 1
        );
      }
    }
    if (
      registration && tokens[index + 1]?.value === "." &&
      tokens[index + 2]?.value === "fsRoutes" &&
      tokens[index + 3]?.value === "(" &&
      matchingToken(tokens, index + 3, "(", ")") !== null
    ) registration.fileRoutes = true;

    if (token.value === "{") braces++;
    if (token.value === "}") braces--;
    if (token.value === "[") brackets++;
    if (token.value === "]") brackets--;
    if (token.value === "(") parentheses++;
    if (token.value === ")") parentheses--;
  }

  const hasApp = appInstances.size > 0;
  const hasStaticFiles = [...registrations.values()].some((entry) =>
    entry.staticFiles
  );
  const hasFileRoutes = [...registrations.values()].some((entry) =>
    entry.fileRoutes
  );
  const hasCompleteApp = [...registrations.values()].some((entry) =>
    entry.staticFiles && entry.fileRoutes
  );
  if (hasCompleteApp) {
    return result("ok", "main.ts registers static and file-system routes");
  }
  if (hasApp && hasStaticFiles && hasFileRoutes) {
    return result(
      "unsupported",
      "main.ts must register staticFiles() and .fsRoutes() on the same App instance",
    );
  }
  const missing = [
    hasApp ? null : "new App()",
    hasStaticFiles ? null : "staticFiles()",
    hasFileRoutes ? null : ".fsRoutes()",
  ].filter((entry): entry is string => entry !== null);

  return result("unsupported", `main.ts is missing ${missing.join(", ")}`);
}

function exportsDefineHelper(source: string): boolean | null {
  const tokens = tokenizeTypeScript(source);
  if (!tokens) return null;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const topLevel = braces === 0 && brackets === 0 && parentheses === 0;
    if (topLevel && token.value === "export") {
      if (
        ["const", "let", "var", "function", "class"].includes(
          tokens[index + 1]?.value,
        ) &&
        tokens[index + 2]?.value === "define"
      ) return true;
      if (tokens[index + 1]?.value === "{") {
        const end = matchingToken(tokens, index + 1, "{", "}");
        if (end === null) return null;
        for (
          const specifier of topLevelElements(tokens.slice(index + 2, end))
        ) {
          if (specifier[0]?.value === "type") continue;
          const exported = specifier[1]?.value === "as"
            ? specifier[2]
            : specifier[0];
          if (
            (exported?.kind === "identifier" || exported?.kind === "string") &&
            exported.value === "define"
          ) return true;
        }
      }
    }
    if (token.value === "{") braces++;
    if (token.value === "}") braces--;
    if (token.value === "[") brackets++;
    if (token.value === "]") brackets--;
    if (token.value === "(") parentheses++;
    if (token.value === ")") parentheses--;
  }
  return false;
}

function explicitlyIgnoresRootEnv(source: string): boolean {
  let ignored = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === ".env" || line === "/.env") ignored = true;
    if (line === "!.env" || line === "!/.env") ignored = false;
  }
  return ignored;
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
  const gitignoreSource = await readOptionalText(
    join(resolvedRoot, ".gitignore"),
  );
  const envFileIgnored = gitignoreSource === null
    ? result("missing", ".gitignore must explicitly ignore the root .env file")
    : explicitlyIgnoresRootEnv(gitignoreSource)
    ? result("ok", ".gitignore explicitly ignores .env")
    : result(
      "unsupported",
      ".gitignore must contain an explicit .env or /.env rule",
    );
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

  const mainSource = await readOptionalText(join(resolvedRoot, "main.ts"));
  const freshFileRoutes = mainSource === null
    ? result("missing", "main.ts is required")
    : inspectFreshFileRoutes(mainSource);

  const rootAlias = imports["@/"];
  const freshRootAlias = rootAlias === "./"
    ? result("ok", '"@/": "./"')
    : rootAlias === undefined
    ? result("missing", 'imports must contain "@/": "./"')
    : result(
      "unsupported",
      `expected "@/": "./", found ${JSON.stringify(rootAlias)}`,
    );

  const viteSource = await readOptionalText(
    join(resolvedRoot, "vite.config.ts"),
  );
  const freshDefaultRoutes = viteSource === null
    ? result("missing", "vite.config.ts is required")
    : inspectFreshRouteDirectory(viteSource);

  const defineSource = await readOptionalText(join(resolvedRoot, "utils.ts"));
  const defineExport = defineSource === null
    ? false
    : exportsDefineHelper(defineSource);
  const freshDefineHelper = defineSource === null
    ? result("missing", "utils.ts is required by generated @/utils.ts imports")
    : defineExport === null
    ? result("unverified", "could not parse utils.ts")
    : defineExport
    ? result("ok", "utils.ts exports define")
    : result("unsupported", "utils.ts does not export define");

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
    capabilities: {
      envFileIgnored,
      fresh2,
      freshFileRoutes,
      freshDefaultRoutes,
      freshDefineHelper,
      freshRootAlias,
      vite,
      tailwind4,
      daisyui,
    },
  };
}
