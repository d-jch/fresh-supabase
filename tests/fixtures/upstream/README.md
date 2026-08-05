# Upstream fixtures

This directory contains committed output from the official Fresh initializer:

- `fresh-2.3.3-no-tailwind`: Fresh 2.3.3 without Tailwind;
- `fresh-2.3.3-tailwind`: Fresh 2.3.3 with Tailwind CSS v4 and Vite.

Both variants were generated with Deno 2.9.3 and `@fresh/init@2.3.3`.
`provenance.json` records the exact upstream commit, source hashes, flags, and
hash of every generated file. The initializer's own test hook disables its
otherwise dynamic Fresh-version lookup, and the favicon response is supplied
from the pinned 2.3.3 source tree.

Do not copy an existing application here and do not regenerate from `latest`
during ordinary tests. The manual generator refuses to overwrite existing
evidence:

```bash
deno run --no-config --no-lock --allow-env --allow-net=jsr.io,raw.githubusercontent.com --allow-read --allow-write scripts/generate_upstream_fixtures.ts
```

Normal CI never runs that command. It verifies the committed file hashes
instead.
