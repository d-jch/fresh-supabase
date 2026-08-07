import {
  BlockFormatError,
  compareSemanticVersions,
  validateBlockDefinition,
} from "../../packages/cli/src/block.ts";
import {
  getBlock,
  listBlocks,
  resolveBlockOrder,
} from "../../packages/cli/src/catalog.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("catalog exposes the three 0.2 blocks", () => {
  assertEquals(
    listBlocks().map((block) => block.name),
    ["client", "daisyui", "password-based-auth"],
  );
});

Deno.test("multiple requested blocks resolve once in deterministic order", () => {
  assertEquals(
    resolveBlockOrder(["client", "password-based-auth"]).map(
      (block) => block.name,
    ),
    ["client", "daisyui", "password-based-auth"],
  );
});

Deno.test("password auth maps exactly to the upstream 17-file manifest", () => {
  const requested = getBlock("password-based-auth");
  assert(requested?.upstream !== undefined, "missing upstream mapping");
  assertEquals(requested.upstream.name, "password-based-auth-nextjs");
  assertEquals(
    requested.upstream.registryItem,
    "https://supabase.com/ui/r/password-based-auth-nextjs.json",
  );
  assertEquals(requested.upstream.files.length, 17);
  assertEquals(requested.upstream.registryDependencies, [
    "button",
    "card",
    "input",
    "label",
  ]);

  const mappedTargets = requested.upstream.files.map((file) => file.target)
    .sort();
  const installedTargets = resolveBlockOrder(requested.name).flatMap((block) =>
    block.operations.flatMap((operation) =>
      operation.kind === "file.create" ? [operation.path] : []
    )
  ).sort();
  assertEquals(installedTargets, mappedTargets);
  assertEquals(
    requested.upstream.files.map((file) => file.source),
    [
      "registry/default/blocks/password-based-auth-nextjs/app/auth/login/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/error/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/protected/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/confirm/route.ts",
      "registry/default/blocks/password-based-auth-nextjs/components/login-form.tsx",
      "registry/default/blocks/password-based-auth-nextjs/middleware.ts",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/sign-up/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/sign-up-success/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/components/sign-up-form.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/forgot-password/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/app/auth/update-password/page.tsx",
      "registry/default/blocks/password-based-auth-nextjs/components/forgot-password-form.tsx",
      "registry/default/blocks/password-based-auth-nextjs/components/update-password-form.tsx",
      "registry/default/blocks/password-based-auth-nextjs/components/logout-button.tsx",
      "registry/default/clients/nextjs/lib/supabase/client.ts",
      "registry/default/clients/nextjs/lib/supabase/middleware.ts",
      "registry/default/clients/nextjs/lib/supabase/server.ts",
    ],
  );
});

Deno.test("semantic versions compare release and prerelease precedence", () => {
  assertEquals(compareSemanticVersions("0.2.0", "0.1.1"), 1);
  assertEquals(compareSemanticVersions("0.2.0-rc.1", "0.2.0"), -1);
  assertEquals(compareSemanticVersions("0.2.0-rc.2", "0.2.0-rc.1"), 1);
});

Deno.test("password auth resolves dependencies before the requested block", () => {
  assertEquals(
    resolveBlockOrder("password-based-auth").map((block) => block.name),
    ["client", "daisyui", "password-based-auth"],
  );
});

Deno.test("catalog includes deterministic operations", () => {
  const block = getBlock("client");
  assert(block !== undefined, "client is missing");
  assert(block.operations.length > 0, "client has no operations");
  assert(
    block.operations.some((operation) => operation.kind === "file.create"),
    "client has no file operation",
  );
  assert(
    block.operations.some((operation) =>
      operation.kind === "config.exclude.ensure" &&
      operation.pattern === "supabase/.temp/**"
    ),
    "client does not exclude Supabase CLI temp sources from Deno checks",
  );
  assert(
    block.postInstall.some((instruction) =>
      instruction.includes("commitSupabaseResponse(response, pending)")
    ),
    "client does not explain its server cookie commit contract",
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

Deno.test("block validation rejects executable post-install payloads", () => {
  const invalid = {
    schemaVersion: 1,
    name: "unsafe",
    version: "0.1.0",
    description: "unsafe test block",
    dependencies: [],
    requirements: ["fresh-2"],
    operations: [],
    postInstall: ["deno run setup.ts\u001b[2J"],
  };

  try {
    validateBlockDefinition(invalid);
  } catch (error) {
    assert(error instanceof BlockFormatError, "expected BlockFormatError");
    assert(
      error.message.includes("contains control characters"),
      error.message,
    );
    return;
  }
  throw new Error("expected unsafe post-install guidance to be rejected");
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
