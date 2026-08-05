# Embedded block format draft

- Status: Draft for Phase 1
- Schema version: not yet assigned

This document constrains the first block schema without freezing field names too
early. Phase 0 intentionally contains no installable block definitions.

## Goals

- Keep blocks inspectable, deterministic, and embedded in the CLI package.
- Separate declarative metadata from file templates.
- Resolve requirements and conflicts before any mutation.
- Make a dry-run plan structurally identical to an execution plan.
- Avoid executing block-provided code or shell commands.

## Conceptual shape

```jsonc
{
  "schemaVersion": 1,
  "name": "example-block",
  "version": "0.1.0",
  "description": "Human-readable catalog description",
  "dependencies": ["another-block"],
  "requirements": [
    { "capability": "fresh", "range": ">=2 <3" }
  ],
  "operations": [
    {
      "kind": "file.create",
      "path": "lib/example.ts",
      "template": "lib/example.ts"
    }
  ]
}
```

The example is illustrative, not a committed parser contract.

## Allowed v0.1 operation families

### `file.create`

Create a new file from an embedded template. The target must be project-relative
and absent unless the operation declares and verifies an exact idempotent match.
Silent overwrite is forbidden.

### `dependency.ensure`

Ensure a pinned or policy-approved JSR/npm dependency exists. Planning must
account for both `deno.json` and commented `deno.jsonc`. Dependency and lockfile
mutations occur only after the full preflight succeeds and must participate in
installer recovery.

### `env.ensure`

Document or add a non-secret environment-variable placeholder without reading,
printing, or generating credentials. Existing values are never overwritten.

### `css.ensure`

Ensure an exact, idempotent CSS directive in a preflight-verified application
stylesheet. This is not permission to discover and rewrite arbitrary CSS files.

No operation may run arbitrary shell, JavaScript, TypeScript, lifecycle, or
`postInstall` code supplied by a block.

## Requirements and capability detection

Requirements describe observable project capabilities rather than assuming one
initializer file layout. Planned capabilities include:

- Fresh major version 2 and Vite project integration;
- Tailwind CSS major version 4;
- `@tailwindcss/vite` dependency and plugin registration;
- an application stylesheet importing `tailwindcss`;
- the Fresh client entry importing that stylesheet;
- existing daisyUI setup.

When a custom layout cannot be verified, planning reports that the capability
could not be verified and performs no writes.

`supabase-client` requires Fresh and Supabase dependencies, not Tailwind.
`daisyui` requires verified Tailwind v4. `password-based-auth` depends on both
blocks and inherits the daisyUI requirement.

## Planning and conflict rules

The planner must:

1. validate block metadata and dependency cycles;
2. canonicalize and contain every target path within the project root;
3. inspect all required files without mutation;
4. report every requirement failure and conflict deterministically;
5. produce an ordered plan with expected before/after hashes;
6. hand the same plan to dry-run output or to the executor.

The executor must reject a stale plan if a precondition hash has changed.

## Installation manifest

The eventual project-local manifest records the schema version, CLI version,
installed block versions, operation results, and content hashes. It is audit
state, not permission to overwrite later user edits. The manifest path and JSON
shape will be decided in Phase 1.

## Open Phase 1 questions

- exact schema validation strategy without adding an unnecessary framework;
- package-relative location for embedded metadata and templates;
- representation of alternatives such as `deno.json` versus `deno.jsonc`;
- stable dry-run serialization and diagnostics format;
- exact rollback journal and manifest filename.
