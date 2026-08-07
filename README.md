# fresh-supabase

`fresh-supabase` is an incremental, local block installer for Deno Fresh 2
projects. Start with the official Fresh initializer, preview the block, then
copy only the Supabase source and configuration the application needs:

```bash
deno run -Ar jsr:@fresh/init my-app
cd my-app
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.2.0 add client --dry-run
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.2.0 add client
```

The CLI copies project-owned files and does not become an application runtime
dependency. Do not use `deno add` or import it from generated application code.

Version 0.2 evolves the existing package rather than adding a second installer.
It keeps the stale-plan-resistant executor, recovery journal, and audit
manifest, then adds multi-block requests, hash-guarded managed-file upgrades,
explicit Fresh scaffold capabilities, and an upstream-aligned 17-file password
auth port. The password block also preserves upstream's global anonymous
redirect outside `/auth*` and `/login*`; `client` alone does not wire that
policy. The v0.1 release evidence remains recorded in
`docs/v0.1-acceptance-matrix.md`.

## v0.2 surface

- Commands: `doctor`, `list`, `view`, multi-block `add`, `add --dry-run`
- Blocks: `daisyui`, `client`, `password-based-auth`
- Package: `@fresh-supabase/cli`

`password-based-auth` depends on both base blocks. `client` remains usable
without Tailwind; UI blocks require a verifiable Fresh Tailwind CSS v4 Vite
setup. Generated block imports use Fresh's root `@/` alias, and preflight also
verifies active `main.ts` file routing, the default `routes/` directory, and the
`utils.ts` define helper.

When `client` is installed alone, server routes that may refresh or mutate auth
must commit the returned pending cookie and cache-header changes with
`commitSupabaseResponse()`. The password block wires this response commit in its
root middleware, reuses the middleware-verified claims on its protected page,
and intentionally signs out only the current session. `client` also keeps
Supabase CLI's generated `supabase/.temp/**` sources out of project-wide Deno
checks.

## Development

Prerequisite: Deno 2.9.3 or a compatible later Deno 2 release.

```bash
deno run packages/cli/main.ts --help
deno run packages/cli/main.ts --version
deno run packages/cli/main.ts list
deno run packages/cli/main.ts view client
deno run --allow-read packages/cli/main.ts doctor
deno run --allow-read packages/cli/main.ts add client --dry-run
deno run --allow-read --allow-write packages/cli/main.ts add client
deno task embed # after editing a block template
deno task fmt
deno task lint
deno task check
deno task test
cd packages/cli
deno publish --dry-run --allow-dirty
```

Architecture and review gates are defined in:

- [`docs/adr/0001-v0.1-architecture.md`](docs/adr/0001-v0.1-architecture.md)
- [`docs/adr/0002-v0.2-cli-evolution.md`](docs/adr/0002-v0.2-cli-evolution.md)
- [`docs/v0.2-plan-alignment.md`](docs/v0.2-plan-alignment.md)
- [`docs/v0.2-real-supabase-validation.md`](docs/v0.2-real-supabase-validation.md)
- [`docs/v0.1-acceptance-matrix.md`](docs/v0.1-acceptance-matrix.md)
- [`docs/block-format-draft.md`](docs/block-format-draft.md)

## Repository layout

```text
packages/cli/              JSR CLI package, planner, and recoverable executor
packages/cli/blocks/       package-local embedded definitions and templates
blocks/                    block authoring and provenance documentation
tests/fixtures/upstream/   pinned official Fresh initializer outputs
tests/fixtures/mutated/    deliberate existing-project edge cases
tests/golden/              human-reviewed expected installation outputs
tests/unit/                fast unit and CLI contract tests
tests/integration/         installer, fixture, build, and auth smoke tests
examples/with-supabase/    CLI-generated complete password-auth example
scripts/                   pinned, overwrite-refusing evidence generators
docs/adr/                  accepted architecture decisions
```

## License

MIT
