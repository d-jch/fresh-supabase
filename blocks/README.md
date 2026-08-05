# Embedded blocks

Validated metadata for `daisyui`, `supabase-client`, and `password-based-auth`
is embedded under `packages/cli/blocks/` so it is included with the published
JSR package. This top-level directory documents block authoring and provenance;
it is not a second runtime registry.

Phase 1 describes template paths but does not include or execute templates.
Template content and installation execution arrive with the block implementation
phases. Blocks never provide executable lifecycle or `postInstall` hooks.
