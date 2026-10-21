## Why

`hel516-palette-quick-create.spec.ts:239` (section order across 5 fresh boots) times out on CI. The CI trace shows
the palette opens on the first key press every iteration; the test simply spends ~6 s per iteration on API
register + UI login (landing on `/home` since HEL-1578) + a second navigation to `/dashboards`, so 5 iterations
need ~30 s against Playwright's 30 s per-test budget. It has run at 22-28 s on main CI for weeks, and it fails
whenever the runner is slow. See ticket.md, "Premise validation".

## What Changes

- Restructure that one test so each of its 5 iterations is still an independent fresh boot, but costs one page
  load instead of three: a fresh user registered over the API, a brand-new browser context (empty storage) carrying
  only that user's session cookie, a direct navigation to `/dashboards`, the same shell-ready wait, then the
  palette. The UI login form and the `/home` landing are dropped from the loop.
- The assertion is unchanged: every boot's group labels equal `["Navigation", "General", "Create"]`.
- No timeout, retry or poll budget is raised; `openPalette` is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change; no spec-level behavior changes (`skip_specs: true`).

## Impact

- `e2e/hel516-palette-quick-create.spec.ts` only. No app code, no support-helper change.

## Non-goals

- Speeding up `registerAndLogin({ waitForShell })` for the rest of the suite (it pays the same extra `/home` load
  everywhere). That is a follow-up candidate, not this ticket.
- The other flaky specs seen in the cited runs (hel1656 :221, hel1631 :177, hel1632 :259).
