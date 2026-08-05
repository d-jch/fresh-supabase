# fresh-supabase

`fresh-supabase` will be an incremental, local block installer for Deno Fresh 2
projects. A user starts with the official Fresh initializer and then adds only
the Supabase capabilities they need:

```bash
deno create jsr:@fresh/init my-app
cd my-app
deno x -RW jsr:@fresh-supabase/cli add supabase-client
```

The repository is currently at **Phase 2**. In addition to the frozen planner,
it contains a stale-plan-resistant executor, recovery journal, audit manifest,
and the `daisyui` and `supabase-client` block payloads. Password authentication
and the generated application example remain later phases.

## Planned v0.1 surface

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
deno task fmt
deno task check
deno task test
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
tests/integration/         installer and generated-project tests (future)
examples/with-supabase/    CLI-generated complete example (future)
docs/adr/                  accepted architecture decisions
```

## License

MIT
