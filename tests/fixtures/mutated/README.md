# Mutated fixtures

These are deliberate, committed modifications of the pinned upstream fixtures:

- `existing-daisyui`: the dependency and CSS plugin already exist;
- `existing-auth-route`: a user-owned sign-in route must conflict safely;
- `commented-deno-jsonc`: comments and trailing commas must survive edits;
- `missing-tailwind-plugin`: Tailwind dependencies exist but Vite registration
  is absent;
- `partial-installation`: exactly one `client` template already exists.

`provenance.json` records each mutation and every committed file hash. The
manual generator copies only this repository's pinned upstream fixtures and
refuses to overwrite existing evidence:

```bash
deno run --no-config --no-lock --allow-read --allow-write scripts/generate_mutated_fixtures.ts
```
