# Golden review record

The two golden projects are review artifacts, not generated assertions. A
reviewer should compare them with the pinned upstream fixtures and the embedded
block definitions, then record the reviewed Git commit below.

## Semantic checklist

- `supabase-client` changes only `deno.json`, `.env.example`, the four
  `lib/supabase` modules, and installer-owned audit state.
- `supabase-client` retains the no-Tailwind stylesheet and has no daisyUI
  dependency.
- `password-based-auth` includes the `supabase-client` and `daisyui`
  dependencies before its auth files.
- Password auth adds only route-scoped middleware, ordinary server forms, POST +
  303 handlers, the protected account page, and the two email templates.
- Neither project imports `@fresh-supabase/cli` at runtime.
- Generated dependency versions and content hashes match the embedded block
  definitions and `.fresh-supabase/manifest.json`.
- No upstream fixture file changes unless it is an explicit installer target.

## Sign-off

- Reviewed commit: pending
- Reviewer: pending
- Result: pending
