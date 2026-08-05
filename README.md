# fresh-supabase

`fresh-supabase` will be an incremental, local block installer for Deno Fresh 2
projects. A user starts with the official Fresh initializer and then adds only
the Supabase capabilities they need:

```bash
deno create jsr:@fresh/init my-app
cd my-app
deno x -A jsr:@fresh-supabase/cli add password-based-auth
```

The repository is currently at **Phase 0**. It contains the frozen v0.1
architecture, acceptance criteria, repository skeleton, and a minimal CLI that
supports only `--help` and `--version`. Block installation and the application
example are intentionally not implemented yet.

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
packages/cli/              JSR CLI package
blocks/                    embedded block definitions and templates (future)
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
