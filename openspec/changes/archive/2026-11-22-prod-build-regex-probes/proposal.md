## Why

The three main-thread probes in `e2e/hel1683-regex-main-thread.spec.ts` (HEL-1683, HEL-1697, HEL-1807) assert a 100 ms long-task bound but run against the Vite dev build, where HEL-1808 attributed most of the measured task time to React development-mode rendering in the Pattern input handler. Their headroom depends on overhead users never pay, so a slow CI host can turn them red with no regex regression. HEL-1691 already built a production-build e2e lane for exactly this kind of latency test; these probes never joined it.

## What Changes

- Tag the three probes in `e2e/hel1683-regex-main-thread.spec.ts` with `@prod-build`, so CI runs them in the existing `e2e-prod-build` job (production `dist/` served by `vite preview`) instead of a `dev` shard leg. No new Playwright config, project, web server or CI job.
- Keep the 100 ms bound, the control/probe/overrun structure and HEL-1808's Long Animation Frame attribution logging. Comments in the spec that describe dev-build costs are updated to describe the build they now run on.
- The dev-build copy stops running (a tagged test is excluded from the `dev` project by design); nothing is duplicated.
- Docs that enumerate `@prod-build` users (e2e/README.md, CONTRIBUTING.md) name the new users. `e2e/shard-weights.tsv` is not hand-edited; its `hel1683` row becomes stale (ignored by `e2e-shard.mjs`) until the next regeneration from CI artifacts.
- Evidence: measured production-build task times and margin, each probe red under its mutation on the production build, the CI cost of the `e2e-prod-build` job before/after, and the shard plan before/after.

## Capabilities

### New Capabilities

### Modified Capabilities

None: this is e2e test placement and CI tooling only; no spec-level requirement changes (`skip_specs: true`).

## Impact

- `e2e/hel1683-regex-main-thread.spec.ts` (tags + comments), `e2e/README.md`, `CONTRIBUTING.md` (prose), change evidence.
- CI: the `e2e-prod-build` job runs three more tests; the 8 `e2e` shard legs lose one file (weight 14 s).
- No app code, no backend, no workflow file change expected (the job's `timeout-minutes` is revisited only if measurement says so).
