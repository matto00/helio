# HEL-1728 minimal-page repro (D5, task 3.2)

Page: `min/hel1728-min.tsx` + `min/hel1728-min.html` (copied into `frontend/` only while running by `min/run-min.sh`, then removed): a bare `Responsive` grid, three 3x3 items, `dragConfig={{ handle: ".h" }}`, no app code, no login. Driver `min/hel1728-min.spec.ts`: same rows as the app sweep (control, delays 0/8/16/33/100, resize 0/16), 5 reps. The upstream builds from the bisect (`builds/<sha>/dist`) are overlaid on the 2.3.0 install; `.vite` cleared and server restarted each time (versions rgl=2.3.0 rr=3.2.0 for all).

| Upstream build | control | drag 0/8/16/33/100 ms | resize 0/16 ms |
|---|---|---|---|
| v2.2.4 (6ec45c62) | 5/5 | 5/5 each | 5/5 each |
| b5fbb95e (parent of the bad commit) | 5/5 | 5/5 each | 5/5 each |
| **eb35b82c (#2291/#2292)** | **0/5** (diff 67) | **0/5** each (diff 52) | **0/5** each (diff 50) |
| 2.3.0 (9b01a614) | **0/5** (diff 67) | **0/5** each (diff 52) | **0/5** each (diff 50) |

Minimal page reproduces at the bisected commit and is green on its parent: **library regression** (D6: Pin + upstream draft).

App-style toggles on 2.3.0 (3 reps; all still red, none helps): `stable=1` (memoized `dragConfig`/`resizeConfig`, the skeptic's suspect): 0/3 on every row; `inline=1&collide=1&pos=1` (app-style inline config, `noCompactor` + `preventCollision`, scaled `positionStrategy`): 0/3 on every row; `stable=1&collide=1&pos=1`: 0/3. No app-side difference is needed to reproduce and none avoids it, so there is no app-side trigger and no small local change to adapt to.


External corroboration: upstream reported this as react-grid-layout#2303 (closed 2026-10-31; fix PR #2304, commit 1468c0f, unreleased). Mechanism (corrected): on a bare grid the item lags until the pointer crosses the half-step rounding point of a grid cell, then jumps (52 px error, about half the ~99 px column pitch). In our app the dragged Metric panel (x:0 w:3) has a neighbour at x:3 and the grid runs noCompactor + preventCollision, so the drag is collision-blocked: the snapped position never changes and 2.3.0 never re-renders the memoized GridItem, so the item is stuck (about 397 px error). Minimal page with the app-like config (`inline=1&collide=1`, 3 reps): 2.3.0 drag error 349 px (resize 300 px) vs 0 px on 2.2.4 and on 1468c0f; the bare page gives 52 px.

Upstream fix check (commit 1468c0fcfa7fbf0f8e39f369051326bcf81cc6bc overlaid by the same serial D3 procedure, `.vite` cleared; on the 2.2.4 install, so react-resizable 3.1.3, not 3.2.0). Bare page: control 5/5, drag 0/8/16/33/100 ms 5/5 each, resize 0/16 ms 5/5 each.

App-like config (`inline=1&collide=1`, collision-blocked like our app), 3 reps, all rows (control, drag 0/8/16/33/100, resize 0/16):

| Build | result |
|---|---|
| 2.2.4 (6ec45c62) | 3/3 every row, diff 0 |
| 2.3.0 (9b01a614) | 0/3 every row (drag 349 px, control 367 px, resize 300 px) |
| 1468c0f | 3/3 every row, diff 0 |

So the upstream fix restores tracking in the collision-blocked configuration too, on the minimal page. Caveat: the `pos=1` variant (`createScaledStrategy(1.5)` on an unscaled page) is NOT a valid pass/fail row: it shifts the item by about 400 x (1 - 1/1.5) = 133 px even on 2.2.4 (`inline=1&collide=1&pos=1`: 2.2.4 drag 131 px, 1468c0f 137 px, 2.3.0 349 px; i.e. 1468c0f is at parity with 2.2.4, within 6 px). The earlier 2.3.0 `...&pos=1` numbers (349 px) are therefore stuck-item evidence, not a clean tracking error. This is a minimal-page result only; the removal gate stays hel1573:275 20/20 on the actual release in the real app.
