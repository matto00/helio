## Why

The package-README convention (README.md per meaningful directory, stating what belongs and what
doesn't) is half-built: 6 backend package dirs still lack one, frontend has almost none, and
top-level tooling/doc dirs have none. This is the final leaf of epic HEL-632 and completes the
sweep over the finished repackaged tree.

## What Changes

- Add README.md to the 6 backend package gaps: `email`, `spark`, `ai`, `domain/panels`,
  `domain/shapes`, `domain/steps`.
- Add one README.md per `frontend/src/features/*` dir (14 dirs) documenting the
  `services`/`state`/`types`/`ui` slice convention.
- Rewrite the existing `frontend/src/features/README.md` index, which is stale (lists 2 of 14
  features, aspirational phrasing).
- Add README.md to `frontend/src/hooks`, `utils`, `services`, each clarifying its distinction
  from the feature-local equivalent most features already have. Add README.md to
  `frontend/src/shared` distinguishing its two subdirs (`chrome/` app-shell components vs.
  `ui/` generic primitives) — no feature-local `shared/` exists to distinguish from.
  `frontend/src/{app,config,context,store,test,theme,types}` are out of scope (never named by
  the ticket; `app`/`store` already have accurate READMEs).
- Add README.md to top-level `scripts/`, `schemas/`, `e2e/`, `docs/`.
- Decide and document (in a single `schemas/README.md`) how the 14 new `schemas/*` domain
  subdirectories (added by HEL-636, after this ticket was filed) are covered — one README per
  domain likely duplicates the same four lines fourteen times with no added information; a single
  README documenting the grouping is preferred, stated explicitly with reasoning.
- Verify no existing README references a path the epic removed (`com/helio/security`, `testutil`).
  None currently do (confirmed at Planning); re-confirmed during execution.

## Capabilities

### New Capabilities

(none — documentation-only change, no spec-level behavior)

### Modified Capabilities

(none)

## Impact

Adds `README.md` files under `backend/src/main/scala/com/helio/{email,spark,ai,domain/panels,
domain/shapes,domain/steps}/`, `frontend/src/{features/*,shared,hooks,utils,services}/`,
`scripts/`, `schemas/`, `e2e/`, `docs/`. No code, config, or API changes. No migrations.
