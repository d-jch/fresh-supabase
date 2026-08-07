# Embedded blocks

Validated metadata for `daisyui`, `client`, and `password-based-auth` is
embedded under `packages/cli/blocks/` so it is included with the published JSR
package. This top-level directory documents block authoring and provenance; it
is not a second runtime registry.

Version 0.2 embeds the `daisyui`, `client`, and upstream-aligned
`password-based-auth` payloads. Templates are inert file content: blocks never
provide executable lifecycle hooks. A validated `postInstall` string array may
describe manual configuration, but the CLI only prints it and never executes it.

All embedded templates in this repository are original project output authored
for this package; they are not copied from another Fresh/Supabase project.
