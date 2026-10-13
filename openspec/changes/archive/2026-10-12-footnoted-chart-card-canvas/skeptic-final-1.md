## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `037a06bc71601c5fdaf0dac4979fa4d79b61719b` on `bug/footnoted-chart-card-canvas/HEL-1444`.
The diff base was resolved live with `resolve-review-base.sh`: `34c6c623662f1e58fecad4914e5d401d8fc50d3b` (origin/main).
Evidence refs below are durable paths under `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/` (`EV/`).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned READY on the branch.
- **Gates, run fresh at HEAD** (nice 19, 3 jest workers, 2 Playwright workers):
  - `npm run lint`, `npm run typecheck` and `npm run format:check`: exit 0.
  - `npm test`: exit 0, 49/49 suites (458 tests) and 575/575 suites (6869 tests).
  - No PanelContent.css or OutputViewerControlBar.css line is over 100 characters (awk check, no output).
- **The seven required e2e specs** (hel1444, hel1398, hel1305, hel1306, hel1311, hel1508, hel1512) on DEV_PORT 6876 and
  BACKEND_PORT 9783: **51 passed (3.1m)**, exit 0. Log: `EV/.concertino/skeptic-scratch/e2e.log`.
- **Servers.** I started them with `start-servers.sh`, `assert-phase.sh servers` returned PASS, and I stopped them with
  `stop-servers.sh` (STOPPED ports=6876,9783).
- **My own probes.** I used a scratch spec with throwaway users, each id read from `/api/auth/me`:
  - `9dad5b79-e1f5-489e-b1ce-72fb15156bab` and `8d159b86-387b-4482-80e6-a5decd835e5e` (visual pass, light and dark);
  - `f1205991-4d0c-41d8-bd41-33dbe7416c80` (typing pass).

  Global teardown deleted all of them. The panels covered: one text control and one dropdown control; bar (2 footnotes)
  and histogram (3 footnotes); w2/w4/w6 at h4; a chart with no footnote; and a card with no control bar. Each was
  checked at 1900, 1440 and 375 in light and dark. Specs: `EV/.concertino/skeptic-scratch/skeptic1444-visual.spec.ts.done`
  and `EV/.concertino/skeptic-scratch/spec/skeptic1444typing.spec.ts`.
- **AC traces that hold:**
  - Item 2: `title={panel.title}` is on the desktop h3 (`PanelCardHeader.tsx:85`), and the e2e `titleAttr` equals the full title.
  - Item 3: the w4/w6 floors are met. For example, `bar-one-w4` has a 66px canvas against a 60px floor.
  - Item 4: comments are rewrapped, and `footerOverrunPx` is 0.
  - D3: the annotation is sr-only at w2 when a bar is present, and hel1398 C1 is replaced, not deleted.
  - The phone stack's canvas stays at 100px.
  - The canvas floors in `specs/` are met in all four theme/viewport JSONs.

### Verdict: REFUTE

### Change Requests

1. **AC item 1 / echarts-chart-panel spec "no two value-axis labels overlap" is violated on the w2 h4 histogram with a
   control bar, and the e2e guard cannot see it.**
   - **What I saw.** In the running app the y labels "60 / 30 / 0" are drawn at a 7.5px pitch (zrender tops 8, 15.5,
     23; plotHeight 15). With 10px glyphs about 7px tall, "60" and "30" touch and overprint: the "6" sits over the "3".
   - **Ink scan.** A row scan of the label column finds one unbroken 14-row run of ink for "60" plus "30". For
     comparison, the bar w2 labels are separate 7-row runs with 2-3 blank rows between them.
   - **Reproduced in three independent renders:**
     - mine at 1900 light: `EV/.concertino/skeptic-scratch/out/card-light-1900-Duration_hist_dropdown_w2.png`, zoom
       `.../zoom-card-light-1900-Duration_hist_dropdown_w2.png`;
     - the e2e run at 1440 dark: `EV/e2e-evidence/HEL-1444/card-dark-1440-hist-one-w2.png`, zoom
       `EV/.concertino/skeptic-scratch/out/zoom-e2e-dark-1440-hist-one-w2.png`;
     - the executor's own `EV/after/card-light-1440-hist-one-w2.png`, which shows the same unbroken ink run.
   - **Why the e2e passes.** The check in `e2e/hel1444-footnoted-chart-canvas.spec.ts:478-481` compares
     `el.getBoundingClientRect()`-style zrender rects that come out **6px tall** for 10px text (data in
     `EV/e2e-evidence/HEL-1444/measure-light-1440.json`, `hist-one-w2.y.drawn`). So it passes labels whose glyphs
     overlap on screen. This is evidence-shaped non-evidence.
   - **What to fix.**
     - Make `valueAxisSplitCap`/`applyValueAxisSplitCap` (`valueAxisLabels.ts:22-45`) guarantee at least one label
       line box (about 12px) between drawn labels. For example, when the cap is 1 or the plot is under 2 pitches, draw
       only min and max by setting an explicit `interval` of (max - min) or by hiding the middle label; ECharts'
       `hideOverlap` evidently uses the same undersized rect.
     - Fix the e2e overlap assertion so it fails on this exact render. Use the font line box (or a pixel/ink probe)
       instead of the zrender rect height, and show it red on the current HEAD first.
   - The bar w2 axis (5 labels, 9.5px pitch, 2-3px clear) passes the ink test but is visibly dense, because a
     splitNumber of 3 still rounds to 5 ticks. A correct fix will likely thin it too.

2. **D2 truncates the text control's visible label to "RE…" or "REG…".**
   - **Where.** On a footnoted w2 h4 chart with one **text** control, the inline label shrinks to 25px at 1440 ("RE…")
     and 32px at 1900 ("REG…"). The input keeps 141-172px for a "Search…" placeholder.
   - **Evidence.** `EV/.concertino/skeptic-scratch/out/typing-1440-0-before.png`,
     `EV/.concertino/skeptic-scratch/out/full-dark-1440.png` (first card) and
     `EV/.concertino/skeptic-scratch/out/typing-results.json` (`labelW` 25.2 and 32.1). A dropdown in the same slot
     shows "REGION" in full.
   - **Why it matters.** design.md D2 rejected hiding the label because it "loses the visible name of the control".
     A two-letter ellipsis loses it in practice.
   - **Cause.** In `OutputViewerControlBar.css` (HEL-1444 block, about L80-100) both the label (`flex: 0 1 auto`) and the
     input (`flex: 1 1 auto`, intrinsic text-input width) shrink from their content size, so the label gives way first.
   - **Fix.** Make the label `flex-shrink: 0` (or give the input `flex-basis: 0`). At w2 "REGION" needs about 44px,
     which leaves the input about 120px, the same as the dropdown case. Add an e2e assertion for a one-**text**-control
     bar: today `controlsFor` only seeds a dropdown, so the spec's "(or one text) control" case has no test.
3. **D2 moves the focused text input on the first keystroke.**
   - **What happens.** At 1440 and 1900 I typed "E" into the inline text control on a footnoted w2 chart. The filter
     matched no rows, the chart went to "No data available", and the footnotes unmounted. With them gone the
     `:has(.chart-panel__annotation, .chart-panel__truncation-note)` scope stopped matching, and the bar restacked
     while the input had focus:
     - the input jumped 33px left and 17px down (318,141 -> 285,158 at 1440);
     - its width changed from 141 to 160px;
     - the header also unclamped.
   - **Evidence.** `EV/.concertino/skeptic-scratch/out/typing-1440-0-before.png`, `.../typing-1440-1-E.png`,
     `.../typing-1900-1-E.png` and `.../typing-results.json`.
   - **Why it matters.** design.md accepts a load-time shift ("nothing drawn moves"). It does not cover moving the
     control the user is typing into, and that happens on ordinary use of every text control in this scope, at every
     width. On main the bar never changed layout during interaction.
   - **Fix.** Key the D2 inline layout on something that survives an empty or errored filter result. For example, a
     class or `data-` attribute on the card derived from the panel's config (an annotation is set, or the chart is
     footnote-capable), so the layout is stable through loading, empty and error states. Or the owner explicitly
     accepts the shift. Add an e2e that types into the control and asserts the input's rect does not move.

### For the owner (D2 / D3 judgement, to see before approving)

- **D3** (annotation sr-only at w2 when a bar is present) is sound on merit. The data-honesty notes stay, the
  annotation is the author's static subtitle and stays in the a11y tree and on fullscreen. I'd approve it.
- **D2** is the right direction for a dropdown: "REGION" plus the select fit one row and look tidy in both themes. For
  a text control it currently has CR 2 and CR 3. Also see `EV/.concertino/skeptic-scratch/out/full-light-1900.png`,
  top row: a footnoted chart's bar sits inline next to a footnote-less chart whose bar is stacked. Same-size siblings
  get different control layouts, which is a visible inconsistency the owner should accept knowingly.
- **w4/w6 histogram with a bar and 3 footnotes.** These pass the 48px canvas floor, but the plot area is only 11px (a
  thin strip; `full-light-1900.png`, "Duration hist" w4/w6). The design rejected also hiding the annotation at w4/w6,
  which would give about 66px. The owner may prefer that option for 3-footnote cards.
- The footnote-less w2 h4 chart with a one-control bar has an essentially empty canvas (the "Plain chart dropdown w2"
  card in `full-dark-1440.png`). This is pre-existing and out of scope, but it is the most visibly broken card on the
  page, so a follow-up is worth considering.

### Non-blocking notes

- Import cycle `buildChartOption.ts` <-> `valueAxisLabels.ts`. I agree with the evaluator: move
  `COMPACT_AXIS_LABEL_FONT_SIZE` and `COMPACT_GRID_INSET_PX` into a leaf module and drop the lazy `labelPitchPx`.
  Fixing CR 1 touches this code anyway.
- `X_LABEL_BAND_PX = 17` is a hard-coded measurement. It is fine for compact charts, but it should live with the other
  compact metrics.
- Pre-existing, not introduced here:
  - The w2 title breaks mid-word ("Reven/ue…", from HEL-1398's two-line clamp).
  - The histogram's last x label is clipped at the canvas edge at w2 ("45.2 to 5…", visible on main in
    `EV/repro/hist-dark-1440-w2-plain.png`).
  - The phone stack's annotation shows a partial third line under its two-line clamp (HEL-1438; `full-dark-375.png`).
- No gate defect: no report I relied on rests on mtime ordering.
