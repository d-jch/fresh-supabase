# fresh-supabase

`fresh-supabase` is an incremental, local block installer for Deno Fresh 2
projects. Start with the official Fresh initializer, preview the block, then
copy only the Supabase source and configuration the application needs:

```bash
deno run -Ar jsr:@fresh/init my-app
cd my-app
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.1.1 add supabase-client --dry-run
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.1.1 add supabase-client
```

The CLI copies project-owned files and does not become an application runtime
dependency. Do not use `deno add` or import it from generated application code.

Version 0.1.1 is the corrective release candidate for
[`@fresh-supabase/cli`](https://jsr.io/@fresh-supabase/cli). It includes the
frozen planner, stale-plan-resistant executor, recovery journal, audit manifest,
all three embedded blocks, pinned Fresh fixtures, human-reviewed golden
projects, a complete generated example, and remote-package installation
coverage. The v0.1 acceptance and review evidence is recorded in
`docs/v0.1-acceptance-matrix.md`.

## v0.1 surface

- Commands: `doctor`, `list`, `view`, `add`, `add --dry-run`
- Blocks: `daisyui`, `supabase-client`, `password-based-auth`
- Package: `@fresh-supabase/cli`

`password-based-auth` depends on both base blocks. `supabase-client` remains
usable without Tailwind; UI blocks require a verifiable Fresh Tailwind CSS v4
Vite setup.

## Development

Prerequisite: Deno 2.9.3 or a compatible later Deno 2 release.

```bash
deno run packages/cli/main.ts --help
deno run packages/cli/main.ts --version
deno run packages/cli/main.ts list
deno run packages/cli/main.ts view supabase-client
deno run --allow-read packages/cli/main.ts doctor
deno run --allow-read packages/cli/main.ts add supabase-client --dry-run
deno run --allow-read --allow-write packages/cli/main.ts add supabase-client
deno task embed # after editing a block template
deno task fmt
deno task check
deno task test
cd packages/cli
deno publish --dry-run --allow-dirty
```

Architecture and review gates are defined in:

- [`docs/adr/0001-v0.1-architecture.md`](docs/adr/0001-v0.1-architecture.md)
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
