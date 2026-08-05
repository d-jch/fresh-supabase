import {
  BlockFormatError,
  validateBlockDefinition,
} from "../../packages/cli/src/block.ts";
import {
  getBlock,
  listBlocks,
  resolveBlockOrder,
} from "../../packages/cli/src/catalog.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("catalog exposes the three frozen v0.1 blocks", () => {
  assertEquals(
    listBlocks().map((block) => block.name),
    ["daisyui", "password-based-auth", "supabase-client"],
  );
});

Deno.test("password auth resolves dependencies before the requested block", () => {
  assertEquals(
    resolveBlockOrder("password-based-auth").map((block) => block.name),
    ["supabase-client", "daisyui", "password-based-auth"],
  );
});

Deno.test("catalog includes deterministic operations", () => {
  const block = getBlock("supabase-client");
  assert(block !== undefined, "supabase-client is missing");
  assert(block.operations.length > 0, "supabase-client has no operations");
  assert(
    block.operations.some((operation) => operation.kind === "file.create"),
    "supabase-client has no file operation",
  );
});

Deno.test("block validation rejects path traversal", () => {
  const invalid = {
    schemaVersion: 1,
    name: "unsafe",
    version: "0.1.0",
    description: "unsafe test block",
    dependencies: [],
    requirements: ["fresh-2"],
    operations: [{
      kind: "file.create",
      path: "../outside.ts",
      template: "templates/outside.ts",
    }],
  };

  try {
    validateBlockDefinition(invalid);
  } catch (error) {
    assert(error instanceof BlockFormatError, "expected BlockFormatError");
    assert(error.message.includes("unsafe path segment"), error.message);
    return;
  }
  throw new Error("expected unsafe block path to be rejected");
});

Deno.test("block validation rejects Windows absolute paths", () => {
  const invalid = {
    schemaVersion: 1,
    name: "unsafe",
    version: "0.1.0",
    description: "unsafe test block",
    dependencies: [],
    requirements: ["fresh-2"],
    operations: [{
      kind: "css.ensure",
      path: "C:/outside.css",
      statement: '@plugin "daisyui";',
    }],
  };

  try {
    validateBlockDefinition(invalid);
  } catch (error) {
    assert(error instanceof BlockFormatError, "expected BlockFormatError");
    assert(error.message.includes("portable relative path"), error.message);
    return;
  }
  throw new Error("expected absolute block path to be rejected");
});

Deno.test("block validation rejects unknown metadata fields", () => {
  const invalid = {
    schemaVersion: 1,
    name: "unsafe",
    version: "0.1.0",
    description: "unsafe test block",
    dependencies: [],
    requirements: ["fresh-2"],
    operations: [],
    postInstall: "deno run setup.ts",
  };

  try {
    validateBlockDefinition(invalid);
  } catch (error) {
    assert(error instanceof BlockFormatError, "expected BlockFormatError");
    assert(
      error.message.includes("unsupported field: postInstall"),
      error.message,
    );
    return;
  }
  throw new Error("expected unknown block field to be rejected");
});

Deno.test("block validation rejects multiline env and CSS payloads", () => {
  for (
    const operation of [{
      kind: "env.ensure",
      path: ".env.example",
      name: "SAFE_NAME",
      placeholder: "safe\nINJECTED=value",
    }, {
      kind: "css.ensure",
      path: "assets/styles.css",
      statement: '@plugin "daisyui";\n@import "unexpected";',
    }]
  ) {
    const invalid = {
      schemaVersion: 1,
      name: "unsafe",
      version: "0.1.0",
      description: "unsafe test block",
      dependencies: [],
      requirements: ["fresh-2"],
      operations: [operation],
    };
    try {
      validateBlockDefinition(invalid);
    } catch (error) {
      assert(error instanceof BlockFormatError, "expected BlockFormatError");
      assert(error.message.includes("single safe line"), error.message);
      continue;
    }
    throw new Error("expected multiline block payload to be rejected");
  }
});
