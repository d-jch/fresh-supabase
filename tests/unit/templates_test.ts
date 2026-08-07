import { listBlocks } from "../../packages/cli/src/catalog.ts";
import { listEmbeddedTemplateKeys } from "../../packages/cli/src/embedded_templates.ts";
import {
  BlockTemplateError,
  loadBlockTemplate,
} from "../../packages/cli/src/templates.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

Deno.test("every declared file template is embedded", async () => {
  const declared = listBlocks().flatMap((block) =>
    block.operations.flatMap((operation) =>
      operation.kind === "file.create"
        ? [`${block.name}/${operation.template}`]
        : []
    )
  ).sort();

  assertEquals(listEmbeddedTemplateKeys(), declared);
  for (const block of listBlocks()) {
    for (const operation of block.operations) {
      if (operation.kind !== "file.create") continue;
      const source = await Deno.readTextFile(
        new URL(
          `../../packages/cli/blocks/${block.name}/${operation.template}`,
          import.meta.url,
        ),
      );
      assertEquals(
        await loadBlockTemplate(block, operation.template),
        source,
        `${block.name}/${operation.template} differs from its source template`,
      );
    }
  }
});

Deno.test("embedded templates load without runtime filesystem access", async () => {
  const block = listBlocks().find((block) => block.name === "client");
  assert(block !== undefined, "missing client block");

  const template = await loadBlockTemplate(
    block,
    "templates/lib/supabase/server.ts",
  );
  assert(
    template.includes("FRESH_PUBLIC_SUPABASE_URL"),
    "loaded the wrong embedded template",
  );

  const client = await loadBlockTemplate(
    block,
    "templates/lib/supabase/client.ts",
  );
  for (
    const name of [
      "FRESH_PUBLIC_SUPABASE_URL",
      "FRESH_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]
  ) {
    assert(
      client.includes(`Deno.env.get("${name}")`),
      `${name} must remain a literal Fresh build-time lookup`,
    );
  }
  assert(
    !client.includes("Deno.env.get(name)"),
    "dynamic environment names cannot be inlined into Fresh islands",
  );
});

Deno.test("block templates use the Fresh root alias for project imports", async () => {
  for (const block of listBlocks()) {
    for (const operation of block.operations) {
      if (operation.kind !== "file.create") continue;
      const source = await loadBlockTemplate(block, operation.template);
      assert(
        !/\bfrom\s+["']\.\.?\//.test(source) &&
          !/\bimport\s+["']\.\.?\//.test(source),
        `${block.name}/${operation.template} contains a relative project import`,
      );
    }
  }
});

Deno.test("missing embedded templates retain a domain error", async () => {
  const block = listBlocks().find((block) => block.name === "client");
  assert(block !== undefined, "missing client block");

  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        loadBlockTemplate(block, "templates/missing.ts")
      ),
    "is missing embedded template templates/missing.ts",
  );
  try {
    await loadBlockTemplate(block, "templates/missing.ts");
  } catch (error) {
    assert(
      error instanceof BlockTemplateError,
      "missing template did not throw BlockTemplateError",
    );
  }
});
