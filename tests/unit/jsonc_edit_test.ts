import {
  ensureJsoncImports,
  ensureJsoncStringArrayEntry,
} from "../../packages/cli/src/jsonc_edit.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("JSONC import editing preserves comments and trailing commas", () => {
  const source = `{
  // Keep this task comment.
  "tasks": { "dev": "vite" },
  "imports": {
    // Keep this dependency comment.
    "fresh": "jsr:@fresh/core@^2.3.3",
  },
}
`;
  const edited = ensureJsoncImports(source, [
    { alias: "@supabase/ssr", specifier: "npm:@supabase/ssr@^0.12.4" },
    {
      alias: "@supabase/supabase-js",
      specifier: "npm:@supabase/supabase-js@^2.112.0",
    },
  ]);

  assert(edited.includes("Keep this task comment"), "task comment was lost");
  assert(
    edited.includes("Keep this dependency comment"),
    "dependency comment was lost",
  );
  assert(edited.includes('"@supabase/ssr":'), "missing SSR import");
  assert(edited.includes('"@supabase/supabase-js":'), "missing JS import");
  const parsed = JSON.parse(
    edited.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"),
  );
  assertEquals(parsed.imports["@supabase/ssr"], "npm:@supabase/ssr@^0.12.4");
});

Deno.test("JSONC import editing handles an empty inline imports object", () => {
  const edited = ensureJsoncImports('{"imports": {}}\n', [
    { alias: "daisyui", specifier: "npm:daisyui@^5.7.16" },
  ]);
  assertEquals(JSON.parse(edited).imports.daisyui, "npm:daisyui@^5.7.16");
});

Deno.test("JSON import editing keeps the comma on the previous member", () => {
  const edited = ensureJsoncImports(
    `{
  "imports": {
    "fresh": "jsr:@fresh/core@^2.3.3"
  }
}
`,
    [{ alias: "daisyui", specifier: "npm:daisyui@^5.7.16" }],
  );
  assert(!edited.includes("\n,"), `comma moved to its own line:\n${edited}`);
  assertEquals(JSON.parse(edited).imports.daisyui, "npm:daisyui@^5.7.16");
});

Deno.test("JSONC structure ignores punctuation inside strings", () => {
  const edited = ensureJsoncImports(
    '{"note": "{", "imports": {"brace": "}"}}\n',
    [{ alias: "daisyui", specifier: "npm:daisyui@^5.7.16" }],
  );
  assertEquals(JSON.parse(edited).imports.daisyui, "npm:daisyui@^5.7.16");
});

Deno.test("JSONC array editing preserves comments and trailing commas", () => {
  const source = `{
  // Keep the generated output policy.
  "exclude": [
    "**/_fresh/*",
  ],
  "imports": {},
}
`;
  const edited = ensureJsoncStringArrayEntry(
    source,
    "exclude",
    "supabase/.temp/**",
  );

  assert(edited.includes("generated output policy"), "comment was lost");
  const parsed = JSON.parse(
    edited.replace(/\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1"),
  );
  assertEquals(parsed.exclude, ["**/_fresh/*", "supabase/.temp/**"]);
});

Deno.test("JSONC array editing creates a missing root property", () => {
  const edited = ensureJsoncStringArrayEntry(
    '{"imports": {}}\n',
    "exclude",
    "supabase/.temp/**",
  );
  assertEquals(JSON.parse(edited).exclude, ["supabase/.temp/**"]);
});

Deno.test("JSONC array editing is idempotent", () => {
  const source = '{"exclude": ["supabase/.temp/**"]}\n';
  assertEquals(
    ensureJsoncStringArrayEntry(source, "exclude", "supabase/.temp/**"),
    source,
  );
});
