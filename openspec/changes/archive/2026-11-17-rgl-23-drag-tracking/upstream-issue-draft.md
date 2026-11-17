# DO NOT FILE: duplicate of react-grid-layout#2303

Upstream already has this: https://github.com/react-grid-layout/react-grid-layout/issues/2303 (closed 2026-10-31), fixed by PR #2304, merge commit 1468c0fcfa7fbf0f8e39f369051326bcf81cc6bc, unreleased as of 2026-11-17 (2.3.0 is still the latest). This file is kept only as a record of our bisect and sweep data; if anything is ever posted it should be a short comment on #2303 pointing at eb35b82c's interaction with f13dbbc and asking for a release. Nothing was posted.

Symptom correction: Mechanism (corrected): on a bare grid the item lags until the pointer crosses the half-step rounding point of a grid cell, then jumps (52 px error, about half the ~99 px column pitch). In our app the dragged Metric panel (x:0 w:3) has a neighbour at x:3 and the grid runs noCompactor + preventCollision, so the drag is collision-blocked: the snapped position never changes and 2.3.0 never re-renders the memoized GridItem, so the item is stuck (about 397 px error). Minimal page with the app-like config (`inline=1&collide=1`, 3 reps): 2.3.0 drag error 349 px (resize 300 px) vs 0 px on 2.2.4 and on 1468c0f; the bare page gives 52 px.

# DRAFT (not filed) - react-grid-layout 2.3.0: dragged and resized item follows the pointer only in grid steps

**Title:** 2.3.0 regression: drag and resize no longer track the pointer (first bad commit eb35b82, #2291/#2292)

**Environment:** react-grid-layout 2.3.0 (react-resizable 3.2.0), React 19, Chromium (Playwright, trusted CDP mouse input), v2 `Responsive` API.

**Repro (no app code):** a `Responsive` grid, `width=1200`, three 3x3 items, `dragConfig={{ handle: ".h" }}` (also with `resizeConfig`, `noCompactor` + `preventCollision`, `positionStrategy`; no difference). Press on a handle, move the pointer 400 px right in 8 ms steps (a 125 Hz mouse), measure the item's `getBoundingClientRect().left` before release.
- 2.2.4: item follows the pointer (error 0 px, 5/5).
- 2.3.0: item lags then jumps in grid steps (error 52 px on a bare grid, up to ~397 px in a real app, 0/5). Resizing and drags follow the same stepwise pattern. Delaying the first move after `down` by 8, 16, 33 or 100 ms does not help. Resizing via the SE handle fails the same way (0/5).

**Bisect** (45 commits between v2.2.4 and 2.3.0, every step proven by the served bundle's sha256, 3 runs each): 0b71e080 good, 8258a56a good, a44fb5fa good, **eb35b82c bad**, b5fbb95e (its parent) good. The commit is "fix: end drag when mouseup arrives before the drag start renders (#2291) (#2292)": `onDragStop` now guards on `oldDragItemRef.current` and `activeDrag` is dropped from its dependency list, so `onDragStop`'s identity no longer changes when a drag starts. Together with the `React.memo` GridItem (f13dbbc, #2240; its comparator includes `onDragStop`) the live re-render is skipped between snapped steps; #2303/#2304 confirm this mechanism.

**Sweep table** (5 reps each; pass = within 30 px; resize 40 px):

| Row | 2.2.4 | 2.3.0 |
|---|---|---|
| hel1573 sequence (down, 4-step move, 6-step moves with 60 ms waits) | 5/5 | 0/5 |
| drag, first move 0 / 8 / 16 / 33 / 100 ms after down | 5/5 each | 0/5 each |
| resize, first move 0 / 16 ms after down | 5/5 each | 0/5 each |

Files: `min/hel1728-min.tsx`, `min/hel1728-min.spec.ts`, `bisect-log.md`.
