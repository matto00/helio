## Evaluation Report — Cycle 3 (evaluation-3.md)

- **Commit reviewed:** HEAD `d9effd22d34c3e3cd871e14fe940c6cc28a7a6f9`. This is the skeptic-final-1 fix `da6e81343` plus the
  archive commit `af692e621`, with origin/main `968835477` (HEL-1457) merged in.
- **Review base:** resolved live with `resolve-review-base.sh` as `968835477e67901a21c5d9fd8d22f7918a6558c3`.
- **Spawn guard:** READY.

Evidence paths below are durable copies under `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/`, written
as `EV/`.

### Fresh gate runs (mine, at HEAD, nice 19, 3 jest workers / 2 Playwright workers)

- `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm --prefix frontend run build`: all exit 0.
- `npm test`: exit 0, with 49/49 suites (458 tests) and 578/578 suites (6894 tests).
- **Servers.** I first confirmed nothing was listening on 6876/9783. I then started them with `start-servers.sh`, which
  rebuilt the backend from HEAD. `assert-phase.sh servers` returned PASS. At the end I stopped them with `stop-servers.sh`
  (`STOPPED ports=6876,9783`).
- **The seven e2e specs** (hel1444, hel1398, hel1305, hel1306, hel1311, hel1508, hel1512) on DEV_PORT=6876 and
  BACKEND_PORT=9783: **54 passed (3.1m)**, exit 0. Log: `EV/.concertino/eval-scratch/e2e.log`.
- **HEL-1457 merge.** The e2e seeds still send `PATCH /api/dashboards/:id/update {fields:["layout"]}` with no
  `expectedLayoutVersion`. Against the merged backend they return 200: the `expectedLayoutVersion` field is
  `Option[Long] = None` in `UpdateDashboardRequest`, so an unconditioned write still succeeds.
  - My own probe made the same PATCH and got back `layoutVersion: 4`. That shows V127 ran and the backend really was
    built from HEAD.

### Verifying the executor's claims (da6e81343)

1. **lineHeight-based y-label spacing.**
   - `applyValueAxisSplitCap` now sets `axisLabel.lineHeight = COMPACT_LABEL_LINE_BOX_PX` (12), so `hideOverlap` drops
     labels using a real line box (`valueAxisLabels.ts:39-48`).
   - Measured in my e2e run (`EV/e2e-evidence/HEL-1444/measure-light-1440.json`):
     - hist-one-w2 draws "60" and "0", top-to-top 12px (it was 7.5px with "60/30/0");
     - bar w2 is 17.5px apart and bar w4/w6 15px.
   - The screenshot `e2e-evidence/HEL-1444/card-light-1440-hist-one-w2.png` shows two separate labels with no overprint.
   - The stricter e2e assertion (top-to-top >= ceil(1.2 x fontSize), `hel1444...spec.ts:527-538`) is red in the
     executor's log `EV/red-e2e-hel1444-cycle2.log` on exactly the renders the skeptic found (hist w2 "60/30/0", plus
     bar w2 at a 9.5px pitch). **Verified.**
2. **Label `flex: 0 0 auto; white-space: nowrap`** (`OutputViewerControlBar.css:87-93`).
   - The e2e now seeds a one-**text**-control bar at w2/w4/w6 and asserts `labelClipped === false`. That check is red in
     the red log (`bar-text-w2 ... label text is not truncated`) and green at HEAD.
   - My probe at 1900 measured the label at 44px, not clipped, with a 160px input. **Verified.**
3. **D2 keyed on a config marker.**
   - `PanelCardBody.tsx:245` passes `chartCard={output?.kind === "chart"}`. `OutputViewerControlBar` adds
     `output-viewer-control-bar--chart`, and the unit test covers both the present and absent class.
   - The CSS is no longer scoped to `.panel-grid-card:has(footnote)`. It still sits inside
     `@container panel-card (max-height: 260px)`. `panel-card` is only declared on `.panel-grid-card`
     (`PanelGrid.css:30`), so fullscreen, the detail modal and the public page are unaffected. Those surfaces never pass
     `chartCard` anyway.
   - The new typing e2e (fill "zzzz", the footnotes unmount, the input rect is unchanged) is red in the red log
     (x/y/width moved) and green at HEAD.
   - The keyed e2e (a footnote-less chart goes inline, a table stays stacked) is green.
   - My probe confirmed it: the footnote-less chart's bar carries `--chart` with the label inline. The table bar has no
     `--chart` and its label stays above the input. **Verified.**
4. **Title/footer clamp widened to `.output-viewer-control-bar--chart`** (`PanelContent.css:507-531`).
   - It is still inside `@container panel-card (max-width: 260px) and (max-height: 260px)`, so it applies at w=2 h<=4
     only.
   - **Behaviour:** sound, no regression found.
     - A footnote-less w2 h4 chart with a one-control bar now has a 2-line clamped title (36px; the full title stays
       in the `title` attribute) and a 88px canvas.
     - It keeps the header from reflowing when a filter empties the result (`EV/e2e-evidence/HEL-1444/typing-1440-empty.png`,
       where the title is still clamped).
     - Unchanged: a table card with a bar, and a chart with neither a footnote nor a bar (wrapping 109px title).
     - hel1398 still passes in full.
     - Evidence: `EV/.concertino/eval-scratch/eval-1900-light-keyed.png`.
   - **Spec consistency:** not fully consistent (see Phase 1).
5. **compactChartMetrics.ts leaf module.**
   - The `valueAxisLabels` <-> `buildChartOption` import cycle is gone. `valueAxisLabels.ts` imports only from
     `compactChartMetrics` and `useChartCompact`.
   - `buildChartOption.ts` re-exports the two constants for its existing importers (`heatmapHistogramOptions.ts`,
     `buildChartOption.overlay.test.ts`).
   - The lazy `labelPitchPx` and the local `X_LABEL_BAND_PX` were removed. **Verified.**

### Phase 1: Spec Review — FAIL

**Issue 1 (spec-divergence).** The canonical spec contradicts itself and the implemented behaviour.

- The requirement body of "Footnotes never collapse a narrow chart" still ends
  "Taller cards (h>=5), other panel kinds, **a chart with no footnote**, and the mobile stack (HEL-1438) keep their current
  layout." (`openspec/specs/chart-panel-truncation-notice/spec.md:90-91`, and the same text in the archived delta
  `openspec/changes/archive/2026-10-12-footnoted-chart-card-canvas/specs/chart-panel-truncation-notice/spec.md`).
- At HEAD a footnote-less chart at h=4 with a one text/dropdown control bar does **not** keep its current layout, in two
  ways:
  - its bar goes inline (D2, at any width, as the updated "other cards keep their chrome" scenario at line 111 now says);
  - at w=2 its title is clamped to two lines and its footer is forced to one line (the widened HEL-1398 clamp).
- The widened title/footer clamp has no normative text in the spec. The w=2 bullet (`spec.md:77-78`) is still worded
  under "a chart panel ... that shows one or more footnotes" and says the clamp is "unchanged from HEL-1398". The
  widening appears only in `design.md` (D2, cycle-2 paragraph).
- The "other cards keep their chrome" scenario was narrowed so that it no longer contradicts the clamp, but nothing states
  that a footnote-less chart with a chart control bar is clamped.
- A future reader following line 91 would treat the shipped behaviour as a regression.

Every other Phase 1 item passes:

- All ticket AC items and C1/C2 are still honoured. C1: the hel1398 w=2 controls annotation check was replaced, not
  deleted. C2: the value-axis min/max assertion is in both the unit test and the e2e.
- Tasks match.
- No scope creep beyond what the skeptic CRs required. The clamp widening is a direct consequence of skeptic CR3, since
  the header also unclamped on the empty result.
- No regressions found.

### Phase 2: Code Review — PASS

Issues: none blocking.

- All gates pass (above).
- Token use is unchanged (`--space-1`/`--space-2`).
- No new magic values: 12 and 17 are named in `compactChartMetrics.ts`.
- No dead code, and the DRY leaf module is in place.
- Typed props (`chartCard?: boolean`).
- The tests are meaningful: every new e2e assertion was shown red first in `EV/red-e2e-hel1444-cycle2.log`.
- No CSS line is over 100 characters.

### Phase 3: UI Review — PASS

- **Throwaway user.** I used my own user, `26ddb3a9-728c-436c-bf8b-2e8b9d4dc740`
  (hel1444eval-1791863961198@example.test), confirmed via `/api/auth/me`. After the probe I deleted it, by exact
  id+email, through the e2e `userCleanupCore` SQL, and confirmed 0 users and 0 dashboards remain.
- **Probe at 1900.** A footnote-less chart with a dropdown is inline, with a 2-line title and an 88px canvas. A plain
  chart and a table with a dropdown are unchanged. There were no console errors.
- **1100.** No document overflow, and no element overflows any card. The only overflow is the table card's own
  data-grid, which scrolls internally and is pre-existing.
- **768 (stack).** The chart bar is stacked with its label above the input, and the canvas is 100px.
- **375.** Covered by the phone-stack e2e (canvas 100px, light and dark).
- **Console.** The only console output was 4 ECharts "Can't get DOM width or height" warnings during the
  grid-to-stack remount at 768. These are warnings, not errors, and come from the remount, not from this CSS-only diff.
- **Markup and accessibility.** Control markup and labelling are unchanged.

### Overall: FAIL

### Change Requests

1. **Rewrite the requirement-body sentence and the w=2 bullet in both copies of the spec.** Edit
   `openspec/specs/chart-panel-truncation-notice/spec.md` and the archived delta
   `openspec/changes/archive/2026-10-12-footnoted-chart-card-canvas/specs/chart-panel-truncation-notice/spec.md`
   identically:
   - **(a) Line 90-91.** Change "...other panel kinds, a chart with no footnote, and the mobile stack (HEL-1438) keep their
     current layout." to something like: "...other panel kinds, a chart with no footnote and no viewer-control bar, and
     the mobile stack (HEL-1438) keep their current layout; a footnote-less chart-output card with a one text/dropdown
     control bar gets the inline bar (and, at w=2, the title/footer tightening) described above."
   - **(b) Line 77-78.** Make the w=2 title/footer tightening explicitly cover a chart-output card with a viewer-control
     bar even when no footnote is shown. For example: "at the narrowest width (w=2) only, the truncation note uses its
     short form, and the card title is clamped to two lines and the footer stays on one line, on a chart card that
     shows a footnote or carries a chart-output viewer-control bar (the latter so the header never reflows when a
     filter empties the result)".
   - **(c) Optional but recommended.** Add a THEN clause to the "a filter that empties the result" scenario: "and the card
     title stays clamped".

   This is spec text only; no code change is needed. Re-run nothing but `npm run format:check` and the openspec
   hygiene hook.

### Critical Path (final cycle)

- **Fix needed for a pass:** CR1 alone. It is a documentation fix; the behaviour is correct and fully gated (54/54 e2e,
  all jest/lint/typecheck/format/build green at HEAD `d9effd22d`).
- **Recommendation for the human:**
  - Let the executor make the two-sentence spec edit (or make it yourself) and re-run the evaluator on that commit.
  - Alternatively, accept the PR with the spec fix folded into the owner-review pass. The PR already parks for owner
    review on D2/D3.

### Non-blocking Suggestions

- **Bare value axis at hist w4/w6.** These draw only a "0" y label (plot area 8px, below the 12px pitch). This complies
  with the spec ("at least one drawn"), but it is a bare axis. The skeptic's w4/w6 3-footnote note (hide the annotation
  there too) still stands as an owner call.
- **Uneven bar y labels.** A footnote-less bar now draws "150 / 60 / 0" (hideOverlap drops 30/90/120). The labels are
  correctly placed but unevenly spaced. Cosmetic; that is for the skeptic or owner to judge.
- **Same-size siblings.** A same-size chart with no footnote and no bar still has a 5-line wrapping title and a 38px
  canvas, next to a clamped sibling that has a bar. This is pre-existing and worth a follow-up ticket, as the skeptic
  noted.
