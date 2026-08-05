interface JsoncToken {
  kind: "string" | "punctuation" | "value";
  value: string;
  start: number;
  end: number;
}

export class JsoncEditError extends Error {
  override name = "JsoncEditError";
}

function scanJsonc(source: string): JsoncToken[] {
  const tokens: JsoncToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) throw new JsoncEditError("unterminated JSONC comment");
      index = end + 2;
      continue;
    }
    if (char === '"') {
      const start = index++;
      let escaped = false;
      while (index < source.length) {
        const current = source[index++];
        if (escaped) {
          escaped = false;
        } else if (current === "\\") {
          escaped = true;
        } else if (current === '"') {
          break;
        }
      }
      if (source[index - 1] !== '"') {
        throw new JsoncEditError("unterminated JSON string");
      }
      const raw = source.slice(start, index);
      let value: string;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new JsoncEditError("invalid JSON string");
      }
      tokens.push({ kind: "string", value, start, end: index });
      continue;
    }
    if ("{}[]:,".includes(char)) {
      tokens.push({
        kind: "punctuation",
        value: char,
        start: index,
        end: ++index,
      });
      continue;
    }

    const start = index;
    while (
      index < source.length &&
      !/\s/.test(source[index]) &&
      !"{}[]:,".includes(source[index]) &&
      !(source[index] === "/" &&
        (source[index + 1] === "/" || source[index + 1] === "*"))
    ) {
      index++;
    }
    tokens.push({
      kind: "value",
      value: source.slice(start, index),
      start,
      end: index,
    });
  }

  return tokens;
}

function matchingBrace(tokens: JsoncToken[], openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index++) {
    if (tokens[index].kind === "punctuation" && tokens[index].value === "{") {
      depth++;
    }
    if (tokens[index].kind === "punctuation" && tokens[index].value === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findImportsObject(tokens: JsoncToken[]): [number, number] {
  if (tokens[0]?.kind !== "punctuation" || tokens[0].value !== "{") {
    throw new JsoncEditError("Deno config root must be an object");
  }
  const rootClose = matchingBrace(tokens, 0);
  if (rootClose < 0) throw new JsoncEditError("Deno config object is unclosed");

  let depth = 0;
  const matches: Array<[number, number]> = [];
  let importsProperties = 0;
  for (let index = 1; index < rootClose; index++) {
    const token = tokens[index];
    if (
      token.kind === "punctuation" &&
      (token.value === "{" || token.value === "[")
    ) depth++;
    if (
      token.kind === "punctuation" &&
      (token.value === "}" || token.value === "]")
    ) depth--;
    if (
      depth === 0 && token.kind === "string" && token.value === "imports" &&
      tokens[index + 1]?.kind === "punctuation" &&
      tokens[index + 1].value === ":"
    ) {
      importsProperties++;
      if (
        tokens[index + 2]?.kind !== "punctuation" ||
        tokens[index + 2].value !== "{"
      ) continue;
      const close = matchingBrace(tokens, index + 2);
      if (close < 0 || close > rootClose) {
        throw new JsoncEditError("imports object is unclosed");
      }
      matches.push([index + 2, close]);
    }
  }
  if (importsProperties > 1) {
    throw new JsoncEditError("Deno config contains duplicate imports objects");
  }
  if (matches.length === 1) return matches[0];
  throw new JsoncEditError("Deno config imports must be an object");
}

export function duplicateJsoncImportKeys(source: string): string[] {
  const tokens = scanJsonc(source);
  const [openIndex, closeIndex] = findImportsObject(tokens);
  const counts = new Map<string, number>();
  let depth = 0;
  for (let index = openIndex + 1; index < closeIndex; index++) {
    const token = tokens[index];
    if (
      token.kind === "punctuation" &&
      (token.value === "{" || token.value === "[")
    ) depth++;
    if (
      token.kind === "punctuation" &&
      (token.value === "}" || token.value === "]")
    ) depth--;
    if (
      depth === 0 && token.kind === "string" &&
      tokens[index + 1]?.kind === "punctuation" &&
      tokens[index + 1].value === ":"
    ) counts.set(token.value, (counts.get(token.value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) =>
    key
  )
    .sort();
}

function lineStart(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", offset - 1);
  return newline < 0 ? 0 : newline + 1;
}

function indentationAt(source: string, offset: number): string {
  const start = lineStart(source, offset);
  const prefix = source.slice(start, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

export function ensureJsoncImports(
  source: string,
  entries: readonly { alias: string; specifier: string }[],
): string {
  if (entries.length === 0) return source;
  const tokens = scanJsonc(source);
  const [openIndex, closeIndex] = findImportsObject(tokens);
  const open = tokens[openIndex];
  const close = tokens[closeIndex];
  const members = tokens.slice(openIndex + 1, closeIndex);
  const last = members.at(-1);
  const closeIndent = indentationAt(source, close.start);
  const indentUnit = closeIndent.includes("\t") ? "\t" : "  ";
  const childIndent = closeIndent + indentUnit;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const trailingComma = last?.kind === "punctuation" && last.value === ",";
  const empty = members.length === 0;
  const rendered = entries.map(({ alias, specifier }, index) => {
    const comma = trailingComma || index < entries.length - 1 ? "," : "";
    return `${childIndent}${JSON.stringify(alias)}: ${
      JSON.stringify(specifier)
    }${comma}`;
  }).join(eol);

  let insertion = close.start;
  const closeLineStart = lineStart(source, close.start);
  if (/^[ \t]*$/.test(source.slice(closeLineStart, close.start))) {
    insertion = closeLineStart;
  }

  let prefix: string;
  if (empty) {
    prefix = insertion === close.start
      ? `${eol}${rendered}${eol}${closeIndent}`
      : `${rendered}${eol}`;
  } else if (trailingComma) {
    prefix = insertion === close.start
      ? `${eol}${rendered}${eol}${closeIndent}`
      : `${rendered}${eol}`;
  } else {
    const renderedInsertion = insertion === close.start
      ? `${eol}${rendered}${eol}${closeIndent}`
      : `${rendered}${eol}`;
    return source.slice(0, last!.end) + "," +
      source.slice(last!.end, insertion) + renderedInsertion +
      source.slice(insertion);
  }

  return source.slice(0, insertion) + prefix + source.slice(insertion);
}
