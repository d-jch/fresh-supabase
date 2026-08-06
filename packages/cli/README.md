# `@fresh-supabase/cli`

Copy Fresh-native Supabase blocks into an existing Deno Fresh 2 application. The
copied source and configuration belong to your project; the generated
application does not import or depend on this CLI at runtime.

> The generic JSR **Add Package** and **Import symbol** examples do not describe
> this installer. Do not use `deno add` or import `@fresh-supabase/cli` into the
> application.

## Add Supabase to an existing Fresh project

First preview every planned change:

```bash
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.1.1 add supabase-client --dry-run
```

Then copy the block files and update the required project configuration:

```bash
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.1.1 add supabase-client
```

`supabase-client` adds request-scoped browser and SSR clients, environment
placeholders, response helpers, and the pinned Supabase dependency aliases. It
works with or without Tailwind.

For a verified Fresh Tailwind CSS v4 Vite project, install the full
server-rendered password authentication flow instead:

```bash
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.1.1 add password-based-auth --dry-run
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.1.1 add password-based-auth
```

That command installs `supabase-client` and `daisyui` first, then copies the
sign-in, sign-up, sign-out, confirmation, password recovery, protected-account,
scoped-CSRF, and Supabase email-template files.

If Deno temporarily blocks a newly published version under its default minimum
dependency-age policy, wait until the release is 24 hours old or add
`--minimum-dependency-age=0` to that invocation.

## Safety

`add --dry-run` completes every preflight check without changing files,
dependencies, lockfiles, or installer state. A normal `add` also completes
preflight before its first write, stops on user-file conflicts, and records
recoverable installer-owned changes under `.fresh-supabase/`.

The CLI never installs or configures Tailwind. `daisyui` and
`password-based-auth` require the official Fresh Vite shape with a verifiable
Tailwind CSS v4 setup.

## Inspect before installing

```bash
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.1.1 --help
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.1.1 list
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.1.1 view supabase-client
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.1.1 doctor
```

The embedded catalog contains `supabase-client`, `daisyui`, and
`password-based-auth`.
