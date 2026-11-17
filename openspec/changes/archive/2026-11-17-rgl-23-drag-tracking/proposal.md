## Why

`react-grid-layout` 2.3.0 (Dependabot #926) breaks desktop panel drag in our e2e evidence: the held item moves 10px
and stops following the pointer (hel1573:275, 20/20 fail). The bump is held until we know whether the library, our
grid config, or the test's pointer sequence is at fault.

## What Changes

- Re-measure the red, then bisect the 2.2.4 -> 2.3.0 upstream range to the commit that changes our drag behavior.
- Establish, in the running app on desktop, whether a human-paced drag is broken on 2.3.0 or only the test's
  pointer sequence.
- Ship exactly one of:
  - **Adapt (app)**: bump `react-grid-layout` to 2.3.x in `frontend/package.json` + lockfile and change our grid
    config/usage so drag tracks the pointer.
  - **Adapt (test)**: bump to 2.3.x and correct hel1573:275's pointer sequence, only if the bisect and running-app
    check show 2.3.0 drags correctly for a real pointer and the old sequence relied on a 2.2.x artifact.
  - **Pin**: keep 2.2.x, add a dependabot ignore rule (`react-grid-layout`, `>=2.3.0`) with a reason next to the
    HEL-1725 rules, and write an upstream issue draft into the run's evidence directory.
- hel1573:275 passes 20/20 at 2 workers on the version that ships.

## Non-goals

- Filing anything upstream, or touching PR #926.
- Other react-grid-layout behavior changes (resize, mobile grid) beyond what the chosen fix requires.
- Refactoring the desktop grid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Panel drag must keep tracking the pointer (existing `panel-drag-perf` / `motion-primitives` behavior); no
requirement changes, so `skip_specs: true`.

## Impact

- `frontend/package.json`, `frontend/package-lock.json` (adapt paths), or `.github/dependabot.yml` (pin path).
- Possibly `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` / `useGridLayoutInteraction.ts`, or
  `e2e/hel1573-motion-grid-chart.spec.ts`.
- Evidence: bisect log, running-app drag check, and (pin path) an upstream issue draft.
