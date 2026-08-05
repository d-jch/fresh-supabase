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

Deno.test("rejects ambiguous Deno config files", async () => {
  await withTestProject({}, async (root) => {
    await Deno.writeTextFile(join(root, "deno.jsonc"), "{}\n");
    await assertRejects(
      () => inspectProject(root),
      "both deno.json and deno.jsonc exist",
    );
  });
});
