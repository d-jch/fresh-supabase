import { listBlocks } from "../../packages/cli/src/catalog.ts";
import { listEmbeddedTemplateKeys } from "../../packages/cli/src/embedded_templates.ts";
import {
  BlockTemplateError,
  loadBlockTemplate,
} from "../../packages/cli/src/templates.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

Deno.test("every declared file template is embedded", () => {
  const declared = listBlocks().flatMap((block) =>
    block.operations.flatMap((operation) =>
      operation.kind === "file.create"
        ? [`${block.name}/${operation.template}`]
        : []
    )
  ).sort();

  assertEquals(listEmbeddedTemplateKeys(), declared);
});

Deno.test("embedded templates load without runtime filesystem access", async () => {
  const block = listBlocks().find((block) => block.name === "supabase-client");
  assert(block !== undefined, "missing supabase-client block");

  const template = await loadBlockTemplate(
    block,
    "templates/lib/supabase/env.ts",
  );
  assert(
    template.includes("FRESH_PUBLIC_SUPABASE_URL"),
    "loaded the wrong embedded template",
  );
});

Deno.test("missing embedded templates retain a domain error", async () => {
  const block = listBlocks().find((block) => block.name === "supabase-client");
  assert(block !== undefined, "missing supabase-client block");

  await assertRejects(
    () => loadBlockTemplate(block, "templates/missing.ts"),
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
