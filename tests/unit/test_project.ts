import { join } from "node:path";

export interface TestProjectOptions {
  tailwind?: boolean;
  partialTailwind?: boolean;
  daisyui?: boolean;
  jsonc?: boolean;
  freshVersion?: string;
}

export async function withTestProject<T>(
  options: TestProjectOptions,
  action: (root: string) => Promise<T>,
): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "fresh-supabase-test-" });
  try {
    await writeTestProject(root, options);
    return await action(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeText(root: string, path: string, content: string) {
  const target = join(root, ...path.split("/"));
  await Deno.mkdir(join(target, ".."), { recursive: true });
  await Deno.writeTextFile(target, content);
}

export async function writeTestProject(
  root: string,
  options: TestProjectOptions = {},
): Promise<void> {
  const tailwind = options.tailwind ?? false;
  const partialTailwind = options.partialTailwind ?? false;
  const imports: Record<string, string> = {
    "@/": "./",
    fresh: `jsr:@fresh/core@^${options.freshVersion ?? "2.3.3"}`,
    "@fresh/plugin-vite": "jsr:@fresh/plugin-vite@^1.1.2",
    preact: "npm:preact@^10.29.1",
    vite: "npm:vite@^7.1.3",
  };

  if (tailwind || partialTailwind) {
    imports.tailwindcss = "npm:tailwindcss@^4.1.10";
    imports["@tailwindcss/vite"] = "npm:@tailwindcss/vite@^4.1.12";
  }
  if (options.daisyui) imports.daisyui = "npm:daisyui@^5.7.16";

  const config = {
    compilerOptions: {
      jsx: "precompile",
      jsxImportSource: "preact",
    },
    tasks: { dev: "vite", build: "vite build" },
    imports,
  };
  if (options.jsonc) {
    const importsJson = JSON.stringify(imports, null, 4).replace(/\n/g, "\n  ");
    await writeText(
      root,
      "deno.jsonc",
      `{
  // Fresh project config
  "compilerOptions": {
    "jsx": "precompile",
    "jsxImportSource": "preact",
  },
  "tasks": {
    "dev": "vite",
    "build": "vite build",
  },
  "imports": ${importsJson},
}
`,
    );
  } else {
    await writeText(root, "deno.json", JSON.stringify(config, null, 2) + "\n");
  }

  const tailwindImport = tailwind || partialTailwind
    ? 'import tailwindcss from "@tailwindcss/vite";\n'
    : "";
  const tailwindPlugin = tailwind ? ", tailwindcss()" : "";
  await writeText(
    root,
    "vite.config.ts",
    `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
${tailwindImport}
export default defineConfig({
  plugins: [fresh()${tailwindPlugin}],
});
`,
  );

  const styleLines = tailwind
    ? ['@import "tailwindcss";']
    : ["/* app styles */"];
  if (options.daisyui) styleLines.push('@plugin "daisyui";');
  await writeText(root, "assets/styles.css", styleLines.join("\n") + "\n");
  await writeText(
    root,
    "client.ts",
    'import "./assets/styles.css";\n',
  );
  await writeText(
    root,
    "utils.ts",
    `import { createDefine } from "fresh";

export const define = createDefine<Record<string, unknown>>();
`,
  );
}

export async function snapshotProject(root: string): Promise<string[]> {
  const entries: string[] = [];

  const visit = async (directory: string, prefix = ""): Promise<void> => {
    const children = [];
    for await (const child of Deno.readDir(directory)) children.push(child);
    children.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      const target = join(directory, child.name);
      if (child.isDirectory) {
        entries.push(`dir:${relativePath}`);
        await visit(target, relativePath);
      } else {
        const content = await Deno.readTextFile(target);
        entries.push(`file:${relativePath}:${content}`);
      }
    }
  };

  await visit(root);
  return entries;
}
