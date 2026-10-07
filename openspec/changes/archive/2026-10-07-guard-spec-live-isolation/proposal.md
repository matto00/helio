## Why

HEL-1300 left the two guard specs exposed to the seed-while-`/`-is-live race (HEL-1289 class) because #774 was
rewriting them. #774 has merged: `focus-presence-guard.spec.ts` still creates its dashboard/source/pipeline over the
API while the post-login `/` is live and auto-selecting. HEL-1300 also deferred consolidating the 32 near-identical local
`registerAndLogin` copies and an `e2e/README.md` usage note; with #774 merged that refactor no longer collides.

## What Changes

- `focus-presence-guard.spec.ts`: isolate -> seed -> `goto("/")` -> `evaluate` (theme) -> `goto(route)`.
- `state-surface-contrast-guard.spec.ts`: audited; already seeds before any app page loads (fresh page) and applies
  the theme via `addInitScript`. Isolation is made explicit and documented; no reordering of its seed.
- New shared `e2e/support/auth.ts` (`uniqueEmail`, `registerUser`, `registerAndLogin`) replacing every local copy, each
  call site keeping its current behaviour (isolate or not, shell-ready wait, return value).
- `e2e/README.md`: usage note for `isolateLivePage`/`loginThenIsolate` and the shared auth helper.

## Capabilities

### New Capabilities

None — test-harness only (`skip_specs: true`).

### Modified Capabilities

None.

## Impact

`e2e/**` only. No product code, no `playwright.config.ts`, no CI workflow change.

## Non-goals

- Changing what either guard measures, its thresholds, or its per-view population.
- Fixing any unrelated flake found while running the suite (file a follow-up).
- User/row cleanup of throwaway e2e users.
