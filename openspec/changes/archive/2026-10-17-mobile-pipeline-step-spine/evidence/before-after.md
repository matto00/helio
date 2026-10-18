# HEL-1582: before / after at 375x812 (same seed: 1 static source, filter + sort + compute, one table Output, run once)

Measured on the running app (real Chromium, DSF 2, touch). Dark and light are identical in geometry. Before:
`.concertino/scratch/HEL-1582/baseline/baseline.md` (main at 3d9e5a6cb). After: `measure.cjs` in
`.concertino/scratch/HEL-1582/after/` plus the live spec's JSON (`e2e-evidence/HEL-1582/*.json`).

| | before (river) | after (phone spine) |
|---|---|---|
| Chrome above the steps (command bar to first row) | 250px (56 + 145 header + 49 tabs) | 156px of page chrome: 56 command bar + 111 header + 45 tabs, with the source card inside the scroller |
| Chrome below the steps (footer region) | 193px, plus 68px under the nav | the floating bar: 40px pills, 8px above the page bottom; nothing below the list but the nav |
| Scrolling steps area | 301px (37% of the screen) | 532px (scroller 212 to 744) |
| Fully visible without scrolling | source, step 1 | source card, all 3 step rows, the Output card (rows at 351 / 415 / 479 to 539; Output card 603 to 685) |
| Bottom clearance | n/a (static footer) | scrolled to the end: last item bottom 679.8 <= pills top 696 - 8; pills bottom 736 <= nav top 744 |
| Controls visible / painted under 44px | 46 / 38 | 28 / 11, all 11 take a 44px hit expander; 0 below 44px by `elementFromPoint` bisection, in every tab and in every step kind's editor in the sheet |
| Horizontal gutters | 16 / 20 | 12 / 12 (page content `--space-3`) |

390x844 (list area 564px, bar top 728, nav top 776) and 768x1024 (list area 767px, nothing scrolls, bar top 908, nav top 956)
hold the same invariants. Re-measure nav clearance once HEL-1583 (#1052, open) lands: the bar's `bottom` offset and the nav
geometry are the only coupling.

## Measured touch targets (hit extent, `e2e/support/touchTargetProbe.ts`)

`e2e-evidence/HEL-1582/touch-floor-{375x812,390x844,768x1024}.json` (controls measured per surface: header + tabs + body +
pills, Preview, Runs, the open sheet) and `touch-floor-sheet-kinds-375x812.json` (every step kind's editor in the sheet): no
control below 43.75px on either axis (the repo's `44 - samplingStep` floor); painted text fields and select triggers are
checked by rendered box with the repo's 0.75px epsilon.

## Measured contrast (rendered pixels, `phone-state-contrast.json`, 12 controls x hover / focus / pressed x 2 themes)

| | dark | light |
|---|---|---|
| hover state surface vs backdrop (floor 1.10) | 1.133 to 1.234 (neutral controls); 8.5 (Run pipeline) | 1.119 to 1.150; 4.1 (Run pipeline) |
| text on its hover surface (floor 4.5:1) | 7.8 to 17.7 | 5.7 to 20.5; Run pipeline pill 3.95 on `--app-accent-strong` (see below) |
| focus ring vs backdrop (non-text floor 3:1) | 4.96 to 5.40 | 3.19 to 3.48 |
| pressed (`:active`) | no style declared anywhere in the app: recorded, not judged | same |

Finding to route (not changed here): the Run pipeline pill's text on its hover fill is 3.95:1 in light. That is the product's
shared accent pair (`--app-accent-ink` on `--app-accent-strong`), identical on the desktop Run button and every primary
button; fixing it is a token decision, not a phone-layout one. The measurement excludes that one pair from the 4.5:1
assertion and records it.

## Re-measured after merging HEL-1583 (glass nav v2, origin/main 29cb0a60f)

Same seed, nav selected as `nav[aria-label=Primary]`, both themes identical. The merge changed no clearance number.

| viewport | pills top / bottom | nav top | last item bottom (scrolled to end) | pills bottom vs nav top | last item vs pills top |
|---|---|---|---|---|---|
| 375x812 | 696 / 736 | 744 | 679.8 | 8px above | 16.2px above |
| 390x844 | 728 / 768 | 776 | 711.8 | 8px above | 16.2px above |
| 768x1024 | 908 / 948 | 956 | 698 (no scroll) | 8px above | 210px above |

375x812 fit unchanged: rows at 351 / 415 / 479, source card 224-315, Output card 603-685, all above the pills' top (696).
Re-run after the merge: `hel1582-mobile-pipeline` (11), `hel813-mobile-touch-target-floor`, all four `hel1583-*`, and the ported
`hel1628`, `hel1277`, `hel910` specs: 110 passed.

## Re-measured after cycles 3 and 4 and merging HEL-1629 (origin/main 544bd79ea, V137)

375x812, dark. The header grew 4px in cycle 3 (the status line's `margin-top`, which keeps the back link at 44px); the fit still holds.

| state | scroller top | source card | row 3 | Output card | pills top |
|---|---|---|---|---|---|
| persisted run, no in-session status | 215.8 | 227.8-318.8 | 482.8-542.8 | 606.8-688.8 | 696 |
| never-run (cycle 3 seed) | 193 | 205-296 | 460-520 | 584-666 | 696 |
| in-session Queued or Succeeded (cycle 4; the stale meta hidden) | 193 | - | - | 584-666 | 696 |

Before the cycle-4 fix, the in-session Succeeded state with a run 3 hours ago and 12,345 rows showed a 60px status line and the Output card bottom at 698, 2px under the bar. After merging HEL-1629 (V137 applied by restarting the backend), `hel1582-mobile-pipeline` (all tests including the nav-clearance ones: pills 8px above the nav at 375, 390 and 768), `hel813-mobile-touch-target-floor` (both), `hel1628-source-sample-label`, `state-surface-contrast-guard` and `hel1579-pipeline-spine-layout`: 77 passed.

## Cycle 5: header wrap sweep (375x812, page open and in-session, both themes; measured, no extra fixes)

Status line height / Output card margin above the bar (bar top 696). No horizontal overflow in any row.

| scenario | open | in-session Queued |
|---|---|---|
| long pipeline name (ellipsized in the name row) | 50.8 / 7.2 | 44 / 14 |
| enabled schedule chip + Partial | 50.8 / 7.2 | 44 / 14 |
| long failed-run error (in-session Failed, 500 with a 200-char message) | 50.8 / 7.2 | Failed: 50.8 / 7.2 |
| Partial + 8-digit count + paused cron chip | 50.8 / 7.2 | 44 / 14 |
| never-run + paused (dark; the light page-open row ran after a dark in-session run, so it reads as a run state) | 28 / 30 | 44 / 14 |

Before this cycle, Partial + 8-digit on page open was 704.8 (8.8px under the bar).
