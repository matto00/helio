# HEL-1728: react-grid-layout 2.3.0 breaks panel drag: the dragged item stops following the pointer after 10px

## Description

Dependabot PR #926 bumps `react-grid-layout` from 2.2.4 to 2.3.0. With that bump, dragging a panel on the desktop
grid breaks. The held item moves 10px on the first small pointer move and then stops following the pointer.

Measured on 2026-11-16 with `e2e/hel1573-motion-grid-chart.spec.ts:275` ("grid: a real drag and a real resize
track..."), `--repeat-each 20`:

| Tree | react-grid-layout | Result |
| -- | -- | -- |
| origin/main a06746986 | 2.2.4 | 20/20 pass |
| origin/main with only the 2.3.0 lockfile bump | 2.3.0 | 20/20 fail |

The failure is `item tracks the pointer at dx=120`: received 110, expected < 30 (spec :329). With a debug log
added, the item had moved only 10px at dx=120, 260 and 420. Its `transition` stayed `none`. CI on #926 failed the
same way twice (run 43963094133).

## Possible causes in 2.3.0 (not bisected)

- Edge auto-scroll that runs on a requestAnimationFrame loop (#2232).
- "End drag when mouseup arrives before drag start renders" (#2291 / #2292), which now checks the saved drag item
  instead of `activeDrag` state.
- GridItem memoization (#2240).
- react-resizable ^3.2.0 (#2233).

The app's grid config is in `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` (around :196):
`dragConfig={{ enabled, handle: ".panel-grid-card__handle" }}`.

## Acceptance criteria

- [ ] Bisect to find the 2.3.0 change that causes it.
- [ ] Either adapt the app (or the test, if the test is what's wrong) so drag works on 2.3.x, or pin
  react-grid-layout below 2.3 with a dependabot ignore rule and a reason, with an upstream issue linked if it is a
  library regression.
- [ ] hel1573:275 passes 20/20 on whichever version ships.

PR #926 is held until this is resolved.

## Driver constraints (binding for this run)

- Re-measure the red yourself before bisecting. Consider that the TEST may be wrong (a synthetic pointer sequence
  that 2.3.0's new drag-start / mouseup handling treats differently from a real drag); check drag in the running app
  on desktop before deciding which one is broken.
- Do NOT merge, close, rebase or comment on #926. If the app adapts to 2.3.x, this PR does the version bump itself.
  If pinning below 2.3, add a dependabot ignore rule with a reason in .github/dependabot.yml next to the HEL-1725
  rules.
- Do NOT file anything on the react-grid-layout GitHub repo. If it is a library regression, write a ready-to-post
  issue draft (title, minimal repro, bisected commit) into the run's evidence directory.
- hel1573:275 passes 20/20 at 2 workers on the version that ships; red first. Desktop drag and resize checked in the
  running app in light and dark.
