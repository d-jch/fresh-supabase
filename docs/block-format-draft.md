# Embedded block format draft

- Status: Accepted for the Phase 2 executor
- Schema version: 1

The Phase 1 parser contract is implemented by `packages/cli/src/block.ts` and
the definitions embedded under `packages/cli/blocks/`.

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
    "fresh-2"
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

The field names and operation families are the committed schema-version-1
contract. Definitions with unknown fields, capabilities, or operation kinds are
rejected.

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
5. produce a deterministic ordered plan;
6. hand the same plan to dry-run output or, in Phase 2, to the executor.

The Phase 2 executor compiles the planner result into unique target-file
mutations. Each mutation records an absent-or-SHA-256 precondition and a SHA-256
result. All preconditions are rechecked before the recovery journal is created
and again immediately before each target write. A changed precondition rejects
the stale plan.

The executor must reject a stale plan if a precondition hash has changed.

## Installation manifest

`.fresh-supabase/manifest.json` records schema version 1, the CLI version, a
sorted list of installed block names and versions, and sorted operation records.
Each operation record contains the block, stable operation key, kind, target,
and SHA-256 of the complete resulting target file. It is audit state, not
permission to overwrite later user edits. Unknown fields, duplicate records,
unsafe targets, and malformed hashes are rejected during preflight.

`.fresh-supabase/install-journal.json` is temporary recovery state. It records
validated project-relative targets, exact preimages, preimage hashes, expected
result hashes, and installer-created directories. The executor writes it before
changing planned targets. A later write failure restores preimages in reverse
order; a later non-dry-run `add` validates and replays a journal left by process
interruption before beginning a new preflight. Dry-run reports the journal as a
conflict and never replays it.

## Phase 1 decisions

- Schema validation uses a dependency-free runtime validator.
- Metadata is package-local under `packages/cli/blocks/<name>/block.json`.
- Project inspection accepts exactly one of `deno.json` and `deno.jsonc` and
  parses JSONC comments and trailing commas without rewriting the file.
- Dry-run output and issue ordering are deterministic and human-readable.
- Every operation is classified as `pending`, `satisfied`, or `conflict`; mixed
  existing/pending state is reported as a partial installation.
- Rollback journal and manifest filenames were deferred to Phase 2.

## Phase 2 decisions

- Dependency aliases are inserted directly into the existing `imports` object;
  comments, trailing commas, and unrelated formatting in `deno.jsonc` remain.
- Duplicate `imports` objects or alias keys are ambiguous and rejected.
- Environment placeholders and CSS statements are single-line data; existing
  environment values are never replaced.
- Existing `file.create` targets are idempotent only when their bytes exactly
  match the embedded template. Other content is a conflict regardless of the
  manifest.
- Writes are recoverable at the project-file level. The CLI does not claim
  atomicity for process, network, cache, or other environment-level effects.
