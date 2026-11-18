# Red evidence

Commands run from the worktree root with `DEV_PORT=7188 BACKEND_PORT=10095 npx playwright test <spec> --workers=2`.
Raw outputs: `.concertino/scratch/HEL-1756/red*.txt`.

## 1. Geometry e2e on the unfixed provenance popover (source files stashed, tests kept)

`git stash push -- frontend/src` then the spec: 6 failed, 3 passed.

```
FAILED  e2e/hel1756-popover-viewport-fit.spec.ts  provenance popover: last section reachable
        (desktop short 1280x400, light|dark)        Error: trigger 3: popover inside the viewport and its last section hit-testable
        (desktop very short 1280x320, light|dark)   Error: trigger 3: ... Expected: true  Received: false
        (phone short 390x400, light|dark)           Error: trigger 0: ... Expected: true  Received: false
```
The unfixed popover stayed outside the viewport (probes.md numbers). With the fix: 9 passed.

## 2. Tests that pass on the unfixed code, each shown red against a recorded mutation of the fixed code

| test | mutation | result |
| --- | --- | --- |
| focus lands inside the panel after a keyboard open (a cache-hit reopen, content present at mount) | `ProvenancePopover.tsx`: delete `if (!placed) return;` and `placed` from the focus effect deps (the pre-change effect) | red: `Expected: true Received: false` (`red-m1.txt`) |
| a cache-miss open re-fits once its content arrives | `ProvenancePopover.tsx`: `observer.observe(inner);` replaced by a comment | red: `Expected: true Received: false` (`red-m2.txt`) |
| its height never exceeds the 70vh design cap | `ProvenanceTrigger.tsx`: delete the `cap:` line of `placeProvenance` | red: `Expected: <= 280.5 Received: 315` (`red-m3.txt`) |

Each mutation was reverted afterwards (green re-run recorded: focus+cap 2 passed, 9/9 spec).

## 3. Appearance editor (cycle 2)

Source stashed (`git stash push -- frontend/src/features/dashboards/ui`), spec kept; the tests select the form by
`form.popover__panel`, which exists on both builds, so the red is geometric (`red-editor.txt`).

- Save and a save error after the contrast warning (1280x400 and 1280x320, light and dark): 4 failed, each
  `Error: form inside the viewport and Save hit-testable  Expected: true  Received: false`.
- A save error alone, no warning (1280x320, light and dark): 2 failed. The red is at the Save click
  (`locator.click: Test timeout of 120000ms exceeded`, Save not actionable in the unfixed layout), so on the unfixed code the test
  does not reach its error-text assertion; with the fix it does and passes.
- The tabbing/colour-input keep-open test passes on both builds (it is a regression guard for D3/D12, not a fix proof); the
  unit tests cover the re-fit on the warning and on the save error.
- With the fix: 7 passed.

### 3b. Keyboard open of the appearance editor (cycle 3)

Run against the cycle-2 source (d4969e8d9, no focus-on-open): `appearance editor: a keyboard open puts focus in the form and
Tab keeps it open (light|dark)` failed in both themes at the first focus assertion (`Expected: true  Received: false`,
`red-editor-kbd.txt`). With the D14 focus effect: green in both themes.

## 4. Rail guard, last row with the page scrolled to its end

Mutation: remove `position: relative;` from `.dashboard-list` in `DashboardList.css` (the HEL-1750 D10 fix).

Cycle 2 reordered the test so the row-shift and scroll-height measurements are taken as soon as the trigger is revealed, before
the rail's transitions are awaited (`railSettled` now runs last). With the mutation the row-shift assertion itself now fires
in BOTH themes: `{"beforeBox":{"y":214},"afterBox":{"y":248}}  Expected <= 1  Received 34` (`red-rail4.txt`). Restored: green.
Earlier (cycle 1) forms of this test were red at the settle poll or, in one theme, at the scroll-height assertion; see
`red-rail2.txt`, `red-rail3.txt`.
