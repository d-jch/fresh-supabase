import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamRoot = join(repositoryRoot, "tests", "fixtures", "upstream");
const mutatedRoot = join(repositoryRoot, "tests", "fixtures", "mutated");
const noTailwind = join(upstreamRoot, "fresh-2.3.3-no-tailwind");
const tailwind = join(upstreamRoot, "fresh-2.3.3-tailwind");
const variants = [
  { directory: "existing-daisyui", source: tailwind },
  { directory: "existing-auth-route", source: tailwind },
  { directory: "commented-deno-jsonc", source: noTailwind },
  { directory: "missing-tailwind-plugin", source: tailwind },
  { directory: "partial-installation", source: noTailwind },
] as const;

async function targetExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  await Deno.mkdir(target);
  const entries = [];
  for await (const entry of Deno.readDir(source)) entries.push(entry);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory) {
      await copyTree(sourcePath, targetPath);
    } else if (entry.isFile) {
      await Deno.copyFile(sourcePath, targetPath);
    } else {
      throw new Error(`unexpected non-file fixture entry: ${sourcePath}`);
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  ).toHex();
}

async function fixtureHashes(
  directory: string,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    const entries = [];
    for await (const entry of Deno.readDir(current)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = join(current, entry.name);
      if (entry.isDirectory) {
        await visit(target);
      } else if (entry.isFile) {
        hashes[relative(directory, target).replaceAll("\\", "/")] =
          await sha256(
            await Deno.readFile(target),
          );
      } else {
        throw new Error(`unexpected non-file fixture entry: ${target}`);
      }
    }
  };
  await visit(directory);
  return hashes;
}

async function writeText(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const target = join(root, ...path.split("/"));
  await Deno.mkdir(dirname(target), { recursive: true });
  await Deno.writeTextFile(target, content);
}

if (Deno.args.length !== 0) {
  throw new Error("mutated fixture generation takes no arguments");
}
for (const source of [noTailwind, tailwind]) {
  if (!(await targetExists(source))) {
    throw new Error(
      `required committed upstream fixture is missing: ${source}`,
    );
  }
}
for (const variant of variants) {
  const target = join(mutatedRoot, variant.directory);
  if (await targetExists(target)) {
    throw new Error(
      `${target} already exists; generation refuses to overwrite committed evidence`,
    );
  }
  await copyTree(variant.source, target);
}

const existingDaisy = join(mutatedRoot, "existing-daisyui");
const daisyConfigPath = join(existingDaisy, "deno.json");
const daisyConfig = JSON.parse(await Deno.readTextFile(daisyConfigPath));
daisyConfig.imports.daisyui = "npm:daisyui@^5.7.16";
await Deno.writeTextFile(
  daisyConfigPath,
  JSON.stringify(daisyConfig, null, 2) + "\n",
);
await Deno.writeTextFile(
  join(existingDaisy, "assets", "styles.css"),
  (await Deno.readTextFile(join(existingDaisy, "assets", "styles.css"))) +
    '@plugin "daisyui";\n',
);

await writeText(
  join(mutatedRoot, "existing-auth-route"),
  "routes/auth/login.tsx",
  `import { define } from "@/utils.ts";

export default define.page(function ExistingLogin() {
  return <p>User-owned login route</p>;
});
`,
);

const commentedRoot = join(mutatedRoot, "commented-deno-jsonc");
const commentedConfig = JSON.parse(
  await Deno.readTextFile(join(commentedRoot, "deno.json")),
);
const commentedJson = JSON.stringify(commentedConfig, null, 2)
  .replace(
    '  "nodeModulesDir": "manual",',
    '  // Keep dependency installation explicit.\n  "nodeModulesDir": "manual",',
  )
  .replace(
    '  "imports": {',
    '  // The installer must preserve comments in this import map.\n  "imports": {',
  )
  .replace(/\n}$/, ",\n}\n");
await Deno.remove(join(commentedRoot, "deno.json"));
await Deno.writeTextFile(join(commentedRoot, "deno.jsonc"), commentedJson);

const missingPluginRoot = join(mutatedRoot, "missing-tailwind-plugin");
const missingPluginConfig = await Deno.readTextFile(
  join(missingPluginRoot, "vite.config.ts"),
);
await Deno.writeTextFile(
  join(missingPluginRoot, "vite.config.ts"),
  missingPluginConfig.replace(
    "plugins: [fresh(), tailwindcss()]",
    "plugins: [fresh()]",
  ),
);

const supabaseClientTemplate = await Deno.readTextFile(
  join(
    repositoryRoot,
    "packages",
    "cli",
    "blocks",
    "client",
    "templates",
    "lib",
    "supabase",
    "client.ts",
  ),
);
await writeText(
  join(mutatedRoot, "partial-installation"),
  "lib/supabase/client.ts",
  supabaseClientTemplate,
);

const files: Record<string, Record<string, string>> = {};
for (const variant of variants) {
  files[variant.directory] = await fixtureHashes(
    join(mutatedRoot, variant.directory),
  );
}
await Deno.writeTextFile(
  join(mutatedRoot, "provenance.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      sources: {
        noTailwind: "../upstream/fresh-2.3.3-no-tailwind",
        tailwind: "../upstream/fresh-2.3.3-tailwind",
      },
      mutations: {
        "existing-daisyui":
          "adds the exact daisyUI dependency and CSS plugin statement",
        "existing-auth-route": "adds a user-owned login route",
        "commented-deno-jsonc":
          "converts deno.json to deno.jsonc with comments and a trailing comma",
        "missing-tailwind-plugin":
          "retains Tailwind imports but removes tailwindcss() from Vite plugins",
        "partial-installation":
          "adds exactly one embedded client template without installer state",
      },
      files,
    },
    null,
    2,
  ) + "\n",
);
