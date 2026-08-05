# `@fresh-supabase/cli`

Incrementally add Fresh-native Supabase blocks to an existing Deno Fresh 2
application. Generated applications do not depend on this package at runtime.

## Commands

```bash
deno run jsr:@fresh-supabase/cli --help
deno run jsr:@fresh-supabase/cli list
deno run jsr:@fresh-supabase/cli view supabase-client
deno run --allow-read jsr:@fresh-supabase/cli doctor
deno run --allow-read jsr:@fresh-supabase/cli add supabase-client --dry-run
deno run --allow-read --allow-write jsr:@fresh-supabase/cli add supabase-client
```

The v0.1 catalog contains:

- `supabase-client`: request-scoped SSR and browser clients; Tailwind is not
  required;
- `daisyui`: daisyUI 5 for a verified Fresh Tailwind CSS v4 Vite project;
- `password-based-auth`: server-rendered password authentication, protected
  account routes, scoped CSRF, and Supabase email templates. It installs both
  base blocks first.

`add --dry-run` completes every preflight check without changing files,
dependencies, lockfiles, or installer state. A normal `add` also completes
preflight before its first write, stops on user-file conflicts, and records
recoverable installer-owned changes under `.fresh-supabase/`.

The CLI never installs or configures Tailwind. UI blocks require the official
Fresh Vite shape with a verifiable Tailwind CSS v4 setup.
