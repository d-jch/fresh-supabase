import { join } from "node:path";
import { inspectProject, parseJsonc } from "../../packages/cli/src/project.ts";
import { assertEquals, assertRejects } from "./assert.ts";
import { withTestProject } from "./test_project.ts";

Deno.test("inspects the pinned Fresh Vite Tailwind capability shape", async () => {
  await withTestProject({ tailwind: true }, async (root) => {
    const project = await inspectProject(root);
    assertEquals(project.configPath, "deno.json");
    assertEquals(project.capabilities.fresh2.status, "ok");
    assertEquals(project.capabilities.vite.status, "ok");
    assertEquals(project.capabilities.tailwind4.status, "ok");
    assertEquals(project.capabilities.daisyui.status, "missing");
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
