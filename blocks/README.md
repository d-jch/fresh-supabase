# Embedded blocks

Validated metadata for `daisyui`, `supabase-client`, and `password-based-auth`
is embedded under `packages/cli/blocks/` so it is included with the published
JSR package. This top-level directory documents block authoring and provenance;
it is not a second runtime registry.

Phase 2 embeds the `daisyui` and `supabase-client` payloads. Authentication
templates arrive in Phase 3. Templates are inert file content: blocks never
provide executable lifecycle or `postInstall` hooks.

All embedded templates in this repository are original project output authored
for this package; they are not copied from another Fresh/Supabase project.
