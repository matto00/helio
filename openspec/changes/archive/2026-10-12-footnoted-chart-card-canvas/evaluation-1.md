## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `2f6841028e06ee88be9ca668cc269011049819ea` on `bug/footnoted-chart-card-canvas/HEL-1444`. Diff base was
resolved live with `resolve-review-base.sh`: `a369a9cb84a0966adb3c8c9d515838ebfbf6bb15`.

### Phase 1: Spec Review — PASS
Issues: none.

- Item 1 (control-bar case): every floor in `specs/chart-panel-truncation-notice` is met in the running app, identical
  in light and dark at 1440 and 1900 (my own run of the hel1444 e2e):
  - one-control bar: bar w2 70.8 (floor 60), bar w4/w6 66.4 (60), hist (3 footnotes) w2 54.0 (48), w4/w6 49.6 (48);
  - no bar: bar w2 102 (96), w4/w6 114.4 (96), hist w2 85.2 (84), w4/w6 97.6 (84).
  - Repro baselines were 33 / 25.4 / 16.2 / 0.6 / 94.4 / 69.6.
  - The one-control bar went from 57px to 36px. The two-control and lone-range bars stay at 57px (no taller than main).
  - Nothing overlaps (containment soft-asserts are green). Footer overrun is 0 everywhere.
- Item 2: `PanelCardHeader.tsx:85` adds `title={panel.title}`. The accessible name is pinned by the unit test and the
  e2e. The mobile stack h3 is untouched, as D5 intends (my 375 probe shows no `title` there).
- Item 3: covered by D1. The w4/w6 numbers are above.
- Item 4: the PanelContent.css comments were rewrapped (awk shows no line over 100 in PanelContent.css or
  OutputViewerControlBar.css). The footer overrun was re-measured at 0 and left unchanged, as the AC says.
- Mobile stack: unchanged. The e2e pins the phone canvas at 100px, and my 375 screenshots in both themes match the
  stacked layout.
- Tasks 1.1–3.2 are all done and match the diff. There is no scope creep, and no schema, API or backend change.
- CONSTRAINTS:
  - **C1 honored.** The only edit to an existing e2e is hel1398 L345. Its "annotation stays visible" check is kept for
    `controls=false`, and for `controls=true` (the seed is `seed(request, 2, 4, controls)`, i.e. w=2) it is replaced
    by "height <= 2 + `getByText(...)` count 1", citing D3. No other existing test file is modified, and no assertion
    was deleted.
  - **C2 honored at the evaluator's level.** The min/max promise is tested in units
    (`showMinLabel`/`showMaxLabel`/`hideOverlap`/`splitNumber`, bar + histogram + time-axis) and in the e2e (drawn
    zrender labels: no overlap, min and max labelled). Before screenshots (`evidence/repro/`, 79 files) and after
    screenshots (`evidence/after/`, 78 files), light and dark, exist for the PR's OWNER REVIEW section. Putting them in
    the PR body is a Delivery-phase step and is not yet checkable.

### Phase 2: Code Review — PASS
Gates (my own fresh run in WORKTREE_PATH):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | clean |
| `npm run typecheck` | clean |
| `npm test` | root 48/48 suites, 454 tests; frontend 574/574 suites, 6860 tests, 19/19 snapshots (includes the unchanged-path guard) |
| `npm --prefix frontend run build` | OK |
| backend | N/A (no `backend/**` change) |

- No new `eslint-disable`, `ts-ignore`, `ts-expect-error` or `any` in the diff (grep of the diff returned nothing).
- DESIGN.md [mechanical] rules:
  - The new CSS uses only `--space-1` and `--space-2` for padding and gap.
  - There is no hex/rgb, no font-size, and no new control height.
  - The D3 hide re-declares the sanctioned `.sr-only` recipe (1px / -1px), exactly as HEL-1398 does, with a keep-in-sync
    note.
- D4 root cause is probe-confirmed (`evidence/yaxis-root-cause.md`): five 10px labels in a 12px plot. That probe also
  explains why `splitNumber` alone was not enough (nice-number rounding, and `hideOverlap` dropping min/max). The fix
  matches.
- The tall/unchanged path is genuinely exercised:
  - `valueAxisSplitCap` returns `undefined` for a measured height above 179 (`CHART_COMPACT_HEIGHT_PX`) and for an
    unmeasured canvas.
  - `buildChartOption` only touches `yAxis` when a cap is defined.
  - The HEL-1305 unchanged-path snapshot guard still passes.
  - ChartPanel tests at 120, 180 and 400px assert that `splitNumber` stays undefined.
  - Live, at a 288.6px canvas (bar and time-axis, w6 h8), the option has no `hideOverlap` and keeps the default split
    count. The rendered tall card shows 0–1000 in steps of 200 (screenshot below).
- The red-first evidence is real:
  - `red-unit-hel1444.log` fails on `splitNumber` undefined.
  - `red-e2e-hel1444.log` fails on the floors, title tooltip, one-line clamp, inline label, and y-label overprint
    (150/100/50 drawn 0.5px apart).

### Phase 3: UI Review — PASS
Servers started with `start-servers.sh` and `assert-phase.sh servers` (PASS) on 6876/9783. Both processes' cwd was
WORKTREE_PATH. I stopped both afterwards with `ss -ltnp` + kill <pid>, including the sbt launcher JVM.

E2E (`DEV_PORT=6876 BACKEND_PORT=9783`, my own run):

| Spec | Result |
|---|---|
| `hel1444-footnoted-chart-canvas.spec.ts` | 6/6 passed |
| hel1398, hel1305, hel1306, hel1311, hel1508, hel1512 | 45/45 passed |

My own live probe used my own throwaway users, identity verified with `/api/auth/me` before any probe, never
matt@helio.dev:
- `eval1444-1791801952976-22487@example.test`, id `a77468c3-69f0-496d-af9a-f1d889ea1b08`
- `eval1444b-1791802544167-88660@example.test`, id `9ab8386d-99c0-41a2-b117-00afba714262`

Both users were deleted by the run-registry teardown, and their dashboards, pipelines and sources were deleted
explicitly. What the probe found:

- **D4 on a time-axis chart** (the e2e covers bar and histogram only), line chart on a `timestamp` x:
  - w2 + one control, 70.8px canvas: split 3; labels 900/600/300/0 drawn 12.7px apart in 6px bands, so no overlap; min
    and max both drawn.
  - w4: split 2; labels 1000/500/0, min and max drawn.
  - w6 with no bar (114.4px): cap not applied, default 0..1000 in steps of 200, no overlap.
- **Histogram** (from the e2e JSON):
  - w2: split 1, drawn 60/30/0.
  - w4/w6 (11px plot): drawn 60 and 0 only. The middle label was hidden by `hideOverlap`; min and max are kept.
- **D2 with a text control:**
  - w2/w4 inline: label on the input's row, input fills the remaining bar width, canvas 70.8 / 66.4.
  - Keyboard: `click` + typing into the inline textbox works (value "Ea", focus kept). The dropdown resolves by role and
    name ("Region").
- **Unchanged cases:**
  - A footnote-less chart with one control at w2 h4 keeps its label above the input (scenario "other cards keep their
    chrome").
  - 375 (phone stack, both themes): every card is stacked, canvas 100px, default axis, no title attribute. Unchanged.
- **Console errors:** none (`eval-probe2.json` `errors: []`, 1440 + 375, dark).
- **Visual check** (running app, light and dark at 1440, and 375): no overprint, nothing clipped, and the footnote
  ellipsis is legible. Subjective cohesion is left to the skeptic.

Evidence (persisted, durable refs):
- `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/measure-light-1440.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/measure-dark-1900.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/eval-scratch/eval-probe.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1444/evidence/e2e-evidence/HEL-1444/eval-scratch/eval-probe2.json`
- `.../eval-scratch/card-light-1440-EVAL_time-one-w2.png`, `card-dark-1440-EVAL_time-one-w4.png`,
  `card-light-1440-EVAL_bar-tall-w6h8.png`, `card-light-1440-EVAL_plain-one-w2.png`,
  `typed-dark-1440-EVAL2_short.png`, `dash-dark-375.png`, `dash-light-375.png` (same evidence prefix)

Every claim above rests on content (geometry JSON, drawn-label coordinates, screenshots). None depends on mtime
ordering.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- **The e2e min/max check is conditional on what was drawn, not on what fits.** At
  `e2e/hel1444-footnoted-chart-canvas.spec.ts` ~L484, min/max are asserted only `if (drawn.length >= 2)`, so a
  regression that leaves a single label where two fit would pass. The spec's own comment says "when two fit (a plot area
  of at least one label pitch)". Conditioning on `probe.plotHeight >= 12` (the label pitch) would match the spec. In
  every measured case today two or more labels are drawn, so the check did fire.
- **A unit test name overclaims.** `buildChartOption.valueAxisCap.test.ts` "a cap of 1 keeps the axis min and max (two
  labels)" asserts only `splitNumber === 1`. Either assert `showMinLabel`/`showMaxLabel` there too or rename it.
- **`buildChartOption.ts` grew past the soft budget.** It was 420 lines on base and is 447 now, past CONTRIBUTING's
  ~400-line "propose a split rather than adding to it" budget. The yAxis-cap block (L423-444) is a pure transform and
  could live in `valueAxisLabels.ts` as `applyValueAxisCap(option, cap)`. Also, the new comment at L424 is 120
  characters long, the same hygiene item 4 fixed in PanelContent.css.
- **The inline bar flips back to stacked when a filter empties the chart.** I reproduced this by typing "Ea" into the
  inline text control at w2: the result is "No data available", the footnotes disappear, the label jumps above, and the
  focused input moves down and widens mid-typing (`typed-dark-1440-EVAL2_short.png`). design.md's "load-time shift
  (accepted)" covers only first paint. This interaction case should be named in the PR's OWNER REVIEW section next to
  D2.
- **Out of scope, worth a follow-up ticket.** A footnote-less chart with a one-control bar at w2 h4 has a 5.2px canvas,
  and its single y label is drawn at -4.1px, outside the canvas (`card-light-1440-EVAL_plain-one-w2.png`). This is the
  same starvation the ticket fixes, minus the footnotes. None of the new selectors match it, so it is pre-existing and
  not a regression.
- **For the skeptic (judgment):** at w2 the inline text control's label "Region search" is ellipsised to "Regio…" (the
  accessible name is intact), and at w4 the inline select stretches to the full bar width (~300px).

### Process notes (evaluator hygiene)
- My first probe timed out on its fourth pass (dark 375) because the page landed on the login screen mid-run. I did not
  attribute this to the change: the hel1444 phone tests and probe2's dark 375 pass were green. Its user was still
  deleted by the teardown.
- I wrote two small summariser scripts to the session scratchpad before noticing the brief excludes it. Both are
  removed. `sum.py` may have overwritten a same-named file from another session there.
- A stray `cat` I started blocked on stdin; I killed it by exact PID.
