# Repository instructions

This is a new, independent repository. Do not copy code, fixtures, examples, or
golden outputs from an existing Fresh/Supabase project.

## Current release scope

- Publish one JSR package: `@fresh-supabase/cli`.
- Provide commands: `doctor`, `list`, `view`, `add`, and `add --dry-run`.
- Embed three blocks: `daisyui`, `client`, and `password-based-auth`.
- `password-based-auth` depends on `client` and `daisyui`.
- Use Fresh-native, Preact-native, server-first output: ordinary server forms,
  POST followed by 303 redirects, and islands only when interaction requires
  them.
- daisyUI is the current UI renderer. Generated projects must not depend on the
  CLI at runtime.

Do not add a starter wrapper, shadcn compatibility, a remote registry,
`update`/`remove`, `main.ts` AST edits, automatic upstream sync, or
social-auth/storage/realtime blocks in the current release. The v0.2
`password-based-auth` block's root session middleware is the sole accepted
global authentication policy and is governed by ADR 0002.

The v0.1 baseline remains governed by ADR 0001. All v0.2 evolution—multi-block
installation, managed upgrades, explicit Fresh capabilities, and the
upstream-aligned authentication port—must remain within ADR 0002.

## Installer and security invariants

- Finish every preflight check before the first write.
- A dry run must perform no filesystem or dependency mutation.
- Stop on conflicts by default; do not overwrite user files silently.
- Do not support arbitrary `postInstall` shell scripts.
- Make installer-owned changes recoverable, without claiming atomicity for
  environment-level side effects.
- Do not install or configure Tailwind automatically.
- `client` must work without Tailwind. `daisyui` and `password-based-auth`
  require a verifiable Fresh Tailwind CSS v4 Vite setup.
- Treat paths and block metadata as untrusted input: reject traversal, absolute
  output paths, and writes outside the target project.

## Fixtures and evidence

- Pin official Fresh and Deno versions used to generate upstream fixtures.
- Keep upstream, deliberately mutated, and human-reviewed golden fixtures
  distinct.
- Generate the example with this repository's CLI, then verify it with build,
  structure, and smoke tests. Never use the same generation run as its only
  correctness oracle.
- Ordinary CI must not regenerate fixtures from `latest`.

## Delivery discipline

- Keep each implementation phase within the accepted ADR.
- Run `deno task fmt`, `deno task check`, and `deno task test` before handoff.
- Report any deviation from `docs/adr/0001-v0.1-architecture.md` or
  `docs/adr/0002-v0.2-cli-evolution.md` explicitly.
