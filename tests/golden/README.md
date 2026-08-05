# Golden outputs

Golden outputs are full expected projects produced from distinct pinned inputs:

- `supabase-client` starts from the no-Tailwind Fresh 2.3.3 fixture;
- `password-based-auth` starts from the Tailwind Fresh 2.3.3 fixture.

`provenance.json` records every committed file hash. `REVIEW.md` defines the
manual semantic review separate from the generator. Normal tests copy the
upstream inputs to temporary directories, run the CLI, and compare those fresh
results with these already committed outputs; they never rewrite the golden
directories.

The manual generator refuses to overwrite existing evidence:

```bash
deno run --no-config --no-lock --allow-read --allow-write --allow-run=deno scripts/generate_golden_and_example.ts
```
