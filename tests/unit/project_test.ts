import { join } from "node:path";
import { inspectProject, parseJsonc } from "../../packages/cli/src/project.ts";
import { assertEquals, assertRejects } from "./assert.ts";
import { withTestProject } from "./test_project.ts";

Deno.test("inspects the pinned Fresh Vite Tailwind capability shape", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.configPath, "deno.json");
    assertEquals(project.capabilities.envFileIgnored.status, "ok");
    assertEquals(project.capabilities.fresh2.status, "ok");
    assertEquals(project.capabilities.freshFileRoutes.status, "ok");
    assertEquals(project.capabilities.freshDefaultRoutes.status, "ok");
    assertEquals(project.capabilities.freshDefineHelper.status, "ok");
    assertEquals(project.capabilities.freshRootAlias.status, "ok");
    assertEquals(project.capabilities.vite.status, "ok");
    assertEquals(project.capabilities.tailwind4.status, "ok");
    assertEquals(project.capabilities.daisyui.status, "missing");
  });
});

Deno.test("requires the Fresh file-routing app setup used by block routes", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const app = new App();
app.use(staticFiles());
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "unsupported");
  });
});

Deno.test("requires static and file routes on the same Fresh App instance", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const staticApp = new App();
export const routeApp = new App();
staticApp.use(staticFiles());
routeApp.fsRoutes();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "unsupported");
  });
});

Deno.test("requires file routes on the exported Fresh app", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
const decoy = new App();
decoy.use(staticFiles());
decoy.fsRoutes();

export const app = new App();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "unsupported");
  });
});

Deno.test("requires static files before Fresh file routes", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const app = new App();
app.fsRoutes();
app.use(staticFiles());
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "unsupported");
  });
});

Deno.test("accepts the official chained Fresh file-routing setup", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const app = new App()
  .use(staticFiles())
  .fsRoutes();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "ok");
  });
});

Deno.test("accepts the official stepwise Fresh file-routing setup", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
export const app = new App();
app.use(staticFiles());
app.fsRoutes();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "ok");
  });
});

Deno.test("accepts routing on an official generic Fresh App instance", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { App, staticFiles } from "fresh";
interface State { shared: string }
export const app = new App<State>();
app.use(staticFiles());
app.fsRoutes();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "ok");
  });
});

Deno.test("does not confuse an import alias with the Fresh App export", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "main.ts"),
      `import { Other as App, staticFiles } from "fresh";
export const app = new App();
app.use(staticFiles());
app.fsRoutes();
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshFileRoutes.status, "unsupported");
  });
});

Deno.test("requires the local Supabase .env file to be ignored", async () => {
  await withTestProject({ envIgnored: false }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.envFileIgnored.status, "missing");
  });
});

Deno.test("honors a later explicit .env negation", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(join(root, ".gitignore"), ".env\n!.env\n");
    const project = await inspectProject(root);
    assertEquals(project.capabilities.envFileIgnored.status, "unsupported");
  });
});

Deno.test("rejects a custom Fresh route directory", async () => {
  await withTestProject({ routeDir: "./src/routes" }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefaultRoutes.status, "unsupported");
  });
});

Deno.test("accepts an explicit default Fresh route directory", async () => {
  await withTestProject({ routeDir: "./routes" }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefaultRoutes.status, "ok");
  });
});

Deno.test("rejects a custom Fresh server entry", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [fresh({ serverEntry: "./server.ts" }), tailwindcss()],
});
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefaultRoutes.status, "unsupported");
  });
});

Deno.test("rejects a computed custom Fresh route directory", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [fresh({ ["routeDir"]: "custom-routes" }), tailwindcss()],
});
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefaultRoutes.status, "unsupported");
  });
});

Deno.test("requires the Fresh define helper used by block templates", async () => {
  await withTestProject({ defineHelper: false }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefineHelper.status, "missing");
  });
});

Deno.test("does not treat a renamed define export as exporting define", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(
      join(root, "utils.ts"),
      `import { createDefine } from "fresh";
const define = createDefine<Record<string, unknown>>();
export { define as other };
`,
    );
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshDefineHelper.status, "unsupported");
  });
});

Deno.test("requires Fresh's root path alias for generated block imports", async () => {
  await withTestProject({ rootAlias: false }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshRootAlias.status, "missing");
  });
});

Deno.test("rejects a root alias that points below the project root", async () => {
  await withTestProject({}, async (root) => {
    const configPath = join(root, "deno.json");
    const config = JSON.parse(await Deno.readTextFile(configPath));
    config.imports["@/"] = "./src/";
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(config, null, 2) + "\n",
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.freshRootAlias.status, "unsupported");
  });
});

Deno.test("parses comments and trailing commas in deno.jsonc", async () => {
  await withTestProject({ tailwind: true, jsonc: true }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.configPath, "deno.jsonc");
    assertEquals(project.capabilities.fresh2.status, "ok");
    assertEquals(project.capabilities.tailwind4.status, "ok");
  });
});

Deno.test("JSONC parser preserves comment markers inside strings", () => {
  assertEquals(
    parseJsonc('{"url":"https://example.test/a/*b*/",}'),
    { url: "https://example.test/a/*b*/" },
  );
});

Deno.test("reports a missing Tailwind setup without rejecting Fresh", async () => {
  await withTestProject({}, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.fresh2.status, "ok");
    assertEquals(project.capabilities.vite.status, "ok");
    assertEquals(project.capabilities.tailwind4.status, "missing");
  });
});

Deno.test("reports a partial Tailwind setup as unverified", async () => {
  await withTestProject({ partialTailwind: true }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.capabilities.tailwind4.status, "unverified");
  });
});

Deno.test("does not accept plugin calls outside the Vite plugins array", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
const unusedFresh = fresh();
const unusedTailwind = tailwindcss();
export default defineConfig({ plugins: [] });
`,
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.vite.status, "unverified");
    assertEquals(project.capabilities.tailwind4.status, "unverified");
  });
});

Deno.test("does not accept a decoy plugins array", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
const decoy = { plugins: [fresh(), tailwindcss()] };
export default defineConfig({ plugins: [] });
`,
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.vite.status, "unverified");
    assertEquals(project.capabilities.tailwind4.status, "unverified");
  });
});

Deno.test("requires defineConfig to come from Vite", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
const defineConfig = (value: unknown) => value;
export default defineConfig({ plugins: [fresh(), tailwindcss()] });
`,
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.vite.status, "unverified");
    assertEquals(project.capabilities.tailwind4.status, "unverified");
  });
});

Deno.test("requires plugins to be direct array elements", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [false && fresh(), false && tailwindcss()],
});
`,
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.vite.status, "unverified");
    assertEquals(project.capabilities.tailwind4.status, "unverified");
  });
});

Deno.test("does not accept plugin or CSS evidence in comments", async () => {
  await withTestProject({ tailwind: true, daisyui: true }, async (root) => {
    await Deno.writeTextFile(
      join(root, "vite.config.ts"),
      `import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";
// const decoy = { plugins: [fresh(), tailwindcss()] };
export default defineConfig({ plugins: [] });
`,
    );
    await Deno.writeTextFile(
      join(root, "assets", "styles.css"),
      `/* @import "tailwindcss"; */
/* @plugin "daisyui"; */
`,
    );
    await Deno.writeTextFile(
      join(root, "client.ts"),
      '// import "./assets/styles.css";\n',
    );

    const project = await inspectProject(root);
    assertEquals(project.capabilities.vite.status, "unverified");
    assertEquals(project.capabilities.tailwind4.status, "unverified");
    assertEquals(project.capabilities.daisyui.status, "unverified");
  });
});

Deno.test("rejects ambiguous Deno config files", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(join(root, "deno.jsonc"), "{}\n");
    await assertRejects(
      () => inspectProject(root),
      "both deno.json and deno.jsonc exist",
    );
  });
});

Deno.test("rejects duplicate import-map keys before planning", async () => {
  await withTestProject({ jsonc: true }, async (root) => {
    const path = join(root, "deno.jsonc");
    const source = await Deno.readTextFile(path);
    await Deno.writeTextFile(
      path,
      source.replace(
        '"fresh": "jsr:@fresh/core@^2.3.3",',
        '"fresh": "jsr:@fresh/core@^2.3.3",\n    "fresh": "jsr:@fresh/core@^2.0.0",',
      ),
    );
    await assertRejects(
      () => inspectProject(root),
      "imports contains duplicate keys: fresh",
    );
  });
});

Deno.test("rejects duplicate root imports properties even with mixed values", async () => {
  await withTestProject({}, async (root) => {
    const path = join(root, "deno.json");
    const source = await Deno.readTextFile(path);
    await Deno.writeTextFile(
      path,
      source.replace(
        '"imports": {',
        '"imports": "decoy",\n  "imports": {',
      ),
    );
    await assertRejects(
      () => inspectProject(root),
      "duplicate imports objects",
    );
  });
});
