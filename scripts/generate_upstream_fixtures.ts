import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DENO_VERSION = "2.9.3";
const FRESH_VERSION = "2.3.3";
const INIT_VERSION = "2.3.3";
const INIT_COMMIT = "39b5f06f8a7d7fa02dd2e2950f2291d04ef9fea7";
const INIT_MODULE = `https://jsr.io/@fresh/init/${INIT_VERSION}/src/init.ts`;
const INIT_MODULE_SHA256 =
  "38b132e97fb71953d1304f975a21d9ca14436926513585e5e403f4c723dc2848";
const FAVICON_SOURCE =
  `https://raw.githubusercontent.com/denoland/fresh/${INIT_VERSION}/packages/init/src/assets/favicon.ico`;
const FAVICON_SHA256 =
  "ceefc31bd51194e03c78f9d35f9ca4d8b474b01280f83cd1490fb96a87c0dd12";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repositoryRoot, "tests", "fixtures", "upstream");
const variants = [
  { directory: "fresh-2.3.3-no-tailwind", tailwind: false },
  { directory: "fresh-2.3.3-tailwind", tailwind: true },
] as const;

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  ).toHex();
}

async function fetchPinnedBytes(
  url: string,
  expectedHash: string,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not fetch pinned source ${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualHash = await sha256(bytes);
  if (actualHash !== expectedHash) {
    throw new Error(
      `pinned source hash mismatch for ${url}: expected ${expectedHash}, got ${actualHash}`,
    );
  }
  return bytes;
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
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

if (Deno.version.deno !== DENO_VERSION) {
  throw new Error(
    `fixture generation requires Deno ${DENO_VERSION}; found ${Deno.version.deno}`,
  );
}
if (Deno.args.length !== 0) {
  throw new Error("fixture generation takes no arguments");
}
for (const variant of variants) {
  const target = join(fixtureRoot, variant.directory);
  if (await targetExists(target)) {
    throw new Error(
      `${target} already exists; generation refuses to overwrite committed evidence`,
    );
  }
}

const initSource = await fetchPinnedBytes(INIT_MODULE, INIT_MODULE_SHA256);
const favicon = await fetchPinnedBytes(FAVICON_SOURCE, FAVICON_SHA256);
if (
  new TextDecoder().decode(initSource).includes(
    `const FRESH_VERSION = "${FRESH_VERSION}";`,
  ) === false
) {
  throw new Error(`pinned initializer does not embed Fresh ${FRESH_VERSION}`);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === "https://fresh.deno.dev/favicon.ico") {
    return Promise.resolve(new Response(favicon.slice(), { status: 200 }));
  }
  return originalFetch(input, init);
};
(globalThis as Record<string, unknown>).INIT_TEST = true;

try {
  const { initProject } = await import(INIT_MODULE);
  for (const variant of variants) {
    await initProject(fixtureRoot, [variant.directory], {
      builder: false,
      docker: false,
      force: false,
      skipInstall: true,
      tailwind: variant.tailwind,
      vscode: false,
    });
  }
} finally {
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<string, unknown>).INIT_TEST;
}

const files: Record<string, Record<string, string>> = {};
for (const variant of variants) {
  files[variant.directory] = await fixtureHashes(
    join(fixtureRoot, variant.directory),
  );
}

await Deno.writeTextFile(
  join(fixtureRoot, "provenance.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      denoVersion: DENO_VERSION,
      freshVersion: FRESH_VERSION,
      initializer: {
        package: `@fresh/init@${INIT_VERSION}`,
        commit: INIT_COMMIT,
        module: INIT_MODULE,
        moduleSha256: INIT_MODULE_SHA256,
      },
      pinnedFavicon: {
        source: FAVICON_SOURCE,
        sha256: FAVICON_SHA256,
      },
      generation: {
        command:
          "deno run --no-config --no-lock --allow-env --allow-net=jsr.io,raw.githubusercontent.com --allow-read --allow-write scripts/generate_upstream_fixtures.ts",
        dependencyInstallSkipped: true,
        latestResolutionDisabled: true,
      },
      files,
    },
    null,
    2,
  ) + "\n",
);
