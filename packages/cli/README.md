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
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.2.0 add client --dry-run
```

Then copy the block files and update the required project configuration:

```bash
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.2.0 add client
```

`client` adds request-scoped browser and SSR clients, environment placeholders,
response helpers, and the pinned Supabase dependency aliases. It also excludes
Supabase CLI's generated `supabase/.temp/**` sources from project-wide Deno
checks. It works with or without Tailwind.

### Server cookie contract

The Fresh adapter cannot mutate an outgoing response implicitly. A server route
that may refresh or change an auth session must use
`getSupabaseServerContext(ctx.state, ctx.req)` and return
`commitSupabaseResponse(response, pending)` from the same context. Installing
`client` alone does not wire middleware or commit pending cookies. The
`password-based-auth` block installs root middleware that performs this commit
after downstream handlers.

For a verified Fresh Tailwind CSS v4 Vite project, install the full
server-rendered password authentication flow instead:

```bash
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.2.0 add password-based-auth --dry-run
deno run --no-config --no-lock --allow-read --allow-write jsr:@fresh-supabase/cli@0.2.0 add password-based-auth
```

That command installs `client` and `daisyui` first, then installs the
Fresh-native counterparts of all 17 upstream source files: login, signup,
confirmation, password recovery, protected-account, scoped-CSRF, and Supabase
client/session code. Supabase email templates remain Dashboard-managed upstream
configuration and are printed as post-install guidance, not copied as source.
Password values are checked for presence and matching confirmation locally; the
Supabase project's configured password policy remains authoritative.

Like the upstream block, the installed root middleware redirects every
unauthenticated request outside `/auth*` and `/login*` to `/auth/login`. Static
files bypass filesystem-route middleware, but application pages, APIs, and
webhooks do not. Customize `lib/supabase/middleware.ts` after installation if
the host application needs additional public paths.

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
Tailwind CSS v4 setup. Route-writing blocks also require the root `@/` alias,
default `routes/`, the `utils.ts` define helper, and active `staticFiles()` plus
`.fsRoutes()` registration in `main.ts`.

## Inspect before installing

```bash
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.2.0 --help
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.2.0 list
deno run --no-config --no-lock jsr:@fresh-supabase/cli@0.2.0 view client
deno run --no-config --no-lock --allow-read jsr:@fresh-supabase/cli@0.2.0 doctor
```

The embedded catalog contains `client`, `daisyui`, and `password-based-auth`.
