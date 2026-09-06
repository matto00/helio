# Type-check `playwright.regression.config.ts`

## Why

`e2e/tsconfig.json`'s include is `["**/*.ts", "../playwright.config.ts"]`. It reaches up out of `e2e/` to name
`playwright.config.ts` explicitly, but not its sibling `playwright.regression.config.ts`. A repo-wide grep finds no
other tsconfig referencing that file, so it is type-checked by **nothing** — while the file beside it is covered by
`check:e2e-types`, a gate that runs in `.husky/pre-commit` on every commit.

This gap was found while refuting HEL-997's original premise. That premise — that a bare root `tsc` walks
`.claude/worktrees/` — is false: TypeScript's wildcard globs never match dot-prefixed path segments, so
`.claude/` is already structurally unreachable (measured at the real repo root with live worktrees present: 687
files resolved, 0 under `.claude`). The ticket owner ruled `rescope-regression-config-only`. See `ticket.md` for
the full refutation and the measurements.

## What Changes

- Add `"../playwright.regression.config.ts"` to `e2e/tsconfig.json`'s `include`, beside the existing
  `"../playwright.config.ts"` entry. One line.
- Verify the file is now in the project's resolved input set, and that `check:e2e-types` still passes.

## Capabilities

### New Capabilities

None — this is build-tooling configuration with no product behaviour change (`skip_specs: true`).

### Modified Capabilities

None.

## Non-goals

- **Any change to root `tsconfig.json`.** Its lack of an `include` is latent and harmless; the hazard originally
  attributed to it does not exist.
- **Any guard script, selftest, or new pre-commit gate.** The mutation the original ticket demanded cannot go red,
  and building a guard whose red arm cannot fire is the exact HEL-880 failure this ticket set out to avoid.
- **Filing the 687-file root walk as a follow-up ticket.** Explicitly ruled out by the owner; it is recorded in
  HEL-997's closing comment instead.
- Editing `.github/workflows/ci.yml` (HEL-996 is live there), or any database, backend, or deploy activity
  (HEL-974 holds the dev Postgres).

## Impact

- `e2e/tsconfig.json` — one line added to `include`.
- Widens what `check:e2e-types` covers by exactly one file. No other gate's scope or result changes.
- No frontend, backend, schema, or API surface is touched.
