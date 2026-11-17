# HEL-1728 running-app timing sweep (D4, task 3.1)

Driver: `hel1728-sweep.spec.ts` (this directory; run per row by `run-sweep.sh`, each row its own throwaway user because ~50 page loads in one session trips the `/api` rate limit and logs the page out). Real app (`/dashboards/:id`, Edit layout, "M-sweep Metric" panel), Playwright `page.mouse` = CDP trusted input, standing in for a physical mouse (Chromium headless). Delay rows: `down`, wait `delay`, then 125 moves at 8 ms intervals (~1 s, +400 px). Pass = `|moved - dx| < 30` (resize `< 40`). 5 reps per row. Control = hel1573:275's exact drag sequence (worst of dx 120/260/420). `diffs` are per-rep |moved - dx| in px.

| Row | 2.2.4 (control build) pass | diffs | 2.3.0 pass | diffs |
|---|---|---|---|---|
| control: hel1573:275 sequence | 5/5 | 0 x5 | **0/5** | 410 x5 |
| drag delay 0 ms | 5/5 | 0 | **0/5** | 397 |
| drag delay 8 ms | 5/5 | 0 | **0/5** | 397 |
| drag delay 16 ms | 5/5 | 0 | **0/5** | 397 |
| drag delay 33 ms | 5/5 | 0 | **0/5** | 397 |
| drag delay 100 ms | 5/5 | 0 | **0/5** | 397 |
| resize delay 0 ms | 5/5 | 0 | **0/5** | 300 |
| resize delay 16 ms | 5/5 | 0 | **0/5** | 300 |

Versions: 2.3.0 column = react-grid-layout 2.3.0 + react-resizable 3.2.0 (npm install). 2.2.4 column = the same install with the built v2.2.4 `dist/` overlaid (versions line `rgl=2.3.0 rr=3.2.0`, served bundle swapped and `.vite` cleared; the 2.2.4 build is byte-identical to the npm tarball modulo chunk hashes). Plus the real 2.2.4 install passes hel1573:275 20/20.

Reading: the sweep is a valid probe (control row fails on 2.3.0 and tracks 5/5 on 2.2.4). The failure is NOT confined to the 0 ms row: every delay up to 100 ms fails, and resizing fails too (the item does not follow the pointer at all). So this is not "the test is too fast for the new drag-start"; real, slower input is affected the same way. D6 "Adapt test" is therefore not allowed. Screenshots of the drag held at 2.3.0, light and dark: `drag-held-light.png`, `drag-held-dark.png`.


External corroboration: upstream issue react-grid-layout#2303 (fixed by #2304, 1468c0f, unreleased) describes the same regression. Mechanism (corrected): on a bare grid the item lags until the pointer crosses the half-step rounding point of a grid cell, then jumps (52 px error, about half the ~99 px column pitch). In our app the dragged Metric panel (x:0 w:3) has a neighbour at x:3 and the grid runs noCompactor + preventCollision, so the drag is collision-blocked: the snapped position never changes and 2.3.0 never re-renders the memoized GridItem, so the item is stuck (about 397 px error). Minimal page with the app-like config (`inline=1&collide=1`, 3 reps): 2.3.0 drag error 349 px (resize 300 px) vs 0 px on 2.2.4 and on 1468c0f; the bare page gives 52 px. The app's 397 px (control row 410 px) is that stuck item, not a lag.
