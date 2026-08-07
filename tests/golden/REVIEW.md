# Golden review record

The `client` and `password-based-auth` golden projects are human-review
artifacts, not self-proving generated assertions. Regeneration and automated
tests do not constitute approval. A reviewer must compare the candidate commit
with the pinned Fresh fixtures, embedded block definitions, upstream mapping,
and the semantic checklist below, then replace every `Pending` sign-off field.

## v0.2 semantic checklist

- `client` adds the two Supabase dependency aliases, the `supabase/.temp/**`
  Deno exclusion, two environment placeholders, three `lib/supabase` modules,
  and installer-owned audit state.
- `client` retains the no-Tailwind stylesheet and has no daisyUI dependency.
- `password-based-auth` resolves `client` and `daisyui` before its auth files;
  the resolved provenance maps exactly 17 upstream sources to 17 Fresh targets
  and records the `button`, `card`, `input`, and `label` dependencies.
- Password auth installs root middleware, server-rendered forms, POST + 303
  handlers, confirmation/recovery routes, and a protected page. It does not
  generate email-template files because those remain Supabase-managed
  configuration.
- Root middleware applies the upstream global anonymous redirect outside
  `/auth*` and `/login*`, commits pending Supabase response changes, and exposes
  verified claims for the protected route to reuse.
- Sign-out uses `local` scope. Generated forms do not impose a hard-coded
  password length; the Supabase project policy is authoritative.
- Authentication `next` redirects remain inside `ctx.config.basePath`, including
  an exact path-segment boundary (for example, `/portal-other` is outside
  `/portal`).
- Neither golden project imports `@fresh-supabase/cli` at runtime.
- Generated dependency versions, operation kinds, targets, and content hashes
  agree with the embedded block definitions and each
  `.fresh-supabase/manifest.json`.
- Pinned upstream fixtures remain unchanged unless a path is an explicit
  installer target.

## Sign-off

- Candidate branch: `feat/cli-0.2.0`
- Reviewed commit: Pending
- Reviewer: Pending
- Result: Pending
- Reviewed on: Pending
