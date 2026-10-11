## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 2829f6ecd6e7e171e4a336d02946def2440bf212. The base was resolved live with `resolve-review-base.sh` and gave b3a7efc9639386784c888347770800189662a380. origin/main is now bc8ccac45 (HEL-1482, HEL-1316). `git merge-tree origin/main HEAD` is clean, and no file is touched on both sides.

Evidence dir (already the durable main-checkout location): `/home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/skeptic-final-1/`

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/chart-reference-lines/HEL-1306`.

**MODIFIED delta "Output config writes reject unknown keys per kind".**
- I extracted the requirement block from canonical `openspec/specs/output-routes-api/spec.md` at both b3a7efc96 and origin/main. The two are identical: HEL-1482 and HEL-1316 did not touch it.
- I diffed that block against the delta's block. The only difference is line 5: the chart clause gains `` `referenceLines`, `referenceBands` ``. The other difference is a trailing blank line at the section boundary.
- All scenarios are copied verbatim. The delta exactly matches the current canonical text.
- HEL-1307 has not merged, so the "1307 must re-base its delta" note in files-modified.md still applies.

**AC1: labelled line on bar and line charts.**
- `referenceMarksOption.ts:96-108` builds markLine data on the value axis (`yAxis`, or `xAxis` for a horizontal bar).
- `buildChartOption.ts:269-279` runs the pass after the overlay, tooltip and emphasis passes.
- `echartsCore.ts` registers MarkLine and MarkArea.
- In the running app (my own fixture), the line is drawn on bar, line, horizontal-bar and scatter charts. The label is the configured text, or the formatted value when unset ("25").
- The axis is widened with zero kept: bar `dataMin 0 / dataMax 95`, drawn 0-100.
- Pie draws nothing, and its stored `referenceLines` are preserved: the option has only the pie series.
- AC1 is met in substance, but see CR1 on label legibility.

**AC2: persisted, schema-validated, editable.**
- `ChartReferenceMarks.scala` is wired into `OutputConfigValidation.validate`, which covers every write path including single-call create. `KnownKeys(Chart)` and `KeysDoc` are extended.
- The three request schemas, the helio-mcp doc, `readChartConfig` sanitization and the editor (`ReferenceMarksField`, `useOutputKindState`, `buildOutputConfig`, `configPatch`) are all in place.
- In the running editor, stored marks load, and Warning/Good tones show. A band with From 30 > To 20 shows "From must be less than To." and disables Save (`disabled: true` read from the DOM). Screenshots: `editor-light-1440.png`, `editor-light-1440-invalid.png`. I cancelled without saving.

**AC3: bundle note.** `evidence/bundle-delta.md` records the echartsCore lazy chunk at +22.84 kB raw / +7.01 kB gzip, and main at +6.98 / +1.88 kB. The PR body is not written yet; the orchestrator owns carrying this into it.

**Owner rulings.**
- 1: two top-level chart keys. Met.
- 2: bar, line, scatter and histogram only; the editor hides the field otherwise (`OutputKindFields.tsx` `REFERENCE_MARK_CHART_TYPES`); stored marks are kept. Met.
- 3: static values only. Met.
- 4: value axis only; vertical on a horizontal bar (seen live: "Goal" at x=50); early return on a normalized stack. Met.
- 5: label limit 60 code points, default is the formatted value, tones resolve to hex. Live values: light `#85551a` warning and `#645e56` neutral. Met.
- 6: no runtime coupling. Met.
- 7: caps 5/3, `from < to`, and a 400 that names the key. Covered by the backend seam. Met.

**Seam tests and guards (C2): red-first and mutation-proven, checked on the files themselves.**
- `backend-seam-red.txt`: 22/22 seam cases FAILED on the pre-change code. 19 of them got the generic `Unknown config key`.
- `frontend-seam-guard-red.txt` and `frontend-seam-red-schemas-reverted.txt`: red, with Ajv accepting the reject cases while the schemas were reverted.
- `guard-mutation-{1,2,3}`: the TS constant, a schema `maxItems` and the Scala constant each go red under mutation.
- `mutation-d5-*` and `mutation-e2e-no-blur.txt`: the carrier type, dataMin/dataMax and blur each go red.
- `cycle2-mutation-label-z.txt` and `cycle2-backend-codepoint-red.txt`: both red.
- My own two mutations, run on a scratch copy (the worktree was not modified):
  1. Forcing `labelledBands` regardless of `bandLabels` makes "compact mode hides band labels but keeps line labels" fail.
  2. Passing `true` instead of `!effectiveCompact` in `buildChartOption` makes the same test fail. So the compact wiring is pinned through `buildChartOption`, not only through the helper.
- Targeted jest at HEAD (referenceMarks*, ChartPanel/ChartOutputPanel.referenceMarks, OutputEditorSheet*, buildOutputConfig, chartAppearance): 19 suites / 299 tests passed.

**Gates.** The evaluator's pasted logs in `eval-2/` are unambiguous:
- lint, format, typecheck and build each EXIT=0;
- jest 524 suites / 5661 tests passed;
- sbt testFull 6762 succeeded, 0 failed.

I did not re-run sbt testFull: another lane's testFull was running, and my verdict does not rest on it.

**Visual cohesion: running app, my own fixture, 1440 and 375, light and dark.**
- The fixture had five chart Outputs: a bar with a warning line at 95, a neutral line at 25 and a labelled success band; a line chart with "vs previous" plus a line and a labelled error band; a horizontal bar; a scatter; and a pie.
- Screenshots: `dash-light-1440-b.png`, `dash-dark-1440.png`, `dash-light-375.png`, `dash-dark-375.png`, `bar-light-1440.png`, `line-vs-light-1440.png`, `bar-label-crop-x4.png` (a 4x crop of the live canvas).
- `dash-light-1440.png` is a full-page capture taken mid-animation, so its lines look truncated. The re-shoot `-b` is settled: a single anomalous reading, reproduced and dismissed.
- The live option and display list match the claims:
  - Legend data excludes both carriers: `["value"]`, `["value","vs previous"]`.
  - The tooltip trigger is `item` on the single-series bar and `axis` on the overlay chart.
  - The overlay series stays dashed at z 1.
  - Band labels are at z 5, above the bars at z 2, with a halo.
  - In compact mode (375), no band labels are drawn.
- Console: one `502` on `/api/pipelines/:id/run-events` (an SSE stream through the vite proxy), the existing pipeline `schedule` 404, and ECharts 0-size warnings during resize. None comes from this change.

**Band labels in compact mode: deliberate, but not in the spec.**
- `MobilePanelStack.tsx:184` forwards `compact` unconditionally, so every chart on a phone hides band labels. So does any desktop chart 179 px tall or less (`useChartCompact.ts:17`).
- At 375 the stacked plots measure about 70 px tall, so a label there could only sit on the bars. Hiding them is a defensible call, and the ticket's ACs do not require band labels.
- But the spec delta ("Reference bands render as translucent ranges … with the band's label (if set) inside its top edge") states no exception, and it will archive as canonical. design.md D5 also describes compact as "a ~60px plot" without saying that it covers the whole mobile stack. This is spec drift, not a dropped requirement. See CR2.

**Fixtures and cleanup (C3).**
- Throwaway user `3f0e473b-43e2-4e5a-8117-8d6c0722d0a2`. All other ids are recorded in `skeptic-final-1/fixture-ids.txt`.
- Each was deleted by exact id and logged in `fixture-ids.txt.cleanup.txt`: 5 panels 204, 1 dashboard 204, 5 outputs 200, 1 pipeline 204, 1 data source 204. The user remains because there is no user-delete API.
- I stopped the servers by exact PID (3589343, 3589312, 3588305, 3587768, 3587726), and ports 6738/9645 are free.
- I moved my 14 `.playwright-mcp` files into `skeptic-final-1/playwright-mcp/`.

### Verdict: REFUTE

### Change Requests

1. **Line labels are illegible wherever they overlap a bar, and the default label misreads.**
   - Where: `frontend/src/features/panels/ui/referenceMarksOption.ts:101-106`.
   - Cause: the markLine label is tone-coloured text with no halo, placed `insideEndTop`, which is at the right end of the plot. On a bar chart, whenever the last category's bar reaches past the line (the normal case for a target on a trend), the label is painted directly on the bar fill.
   - Evidence, stable across 4 captures (light/dark × 1440/375):
     - The neutral line at 25 labelled "25" puts the "2" on the blue Fri bar: `#645e56` on the bar blue, a contrast ratio of about 1.4:1. The "5" sits on the background, so the label reads as **"5"**.
     - Files: `bar-light-1440.png`, `bar-label-crop-x4.png`, `dash-dark-1440.png`, `dash-light-375.png`.
     - The same thing happens on the 375 line chart, where "Target" collides with the Fri marker.
   - Why it blocks: this is the same defect class as cycle 1's CR1 for band labels, which cycle 2 fixed only for bands. It undermines AC1's "labelled".
   - Fix: give line labels the same `textBorderColor: tokens.surfaceStrong, textBorderWidth: 3` halo that band labels already use (`referenceMarksOption.ts:130-131`).
   - Test: add a unit test that asserts the markLine label carries the halo. It must go red when the halo is removed.
   - Live check: re-check a bar fixture whose last bar exceeds an unlabelled line, in both themes, at 1440 and 375.
2. **The spec must state the compact band-label exception.**
   - Where: in `specs/chart-reference-lines/spec.md`, in the requirement "Reference bands render as translucent ranges".
   - What: say that band labels are not drawn in compact chart layouts (the mobile panel stack, and charts at or below the compact height), while lines keep their labels.
   - Also: correct design.md D5's "Compact mode (a ~60px plot …)" so it says compact covers every chart in the mobile stack (`MobilePanelStack.tsx:184`) and any chart at or below 179 px (`useChartCompact.ts:17`).
   - Why: the archived spec must not contradict the shipped behaviour.

### Non-blocking notes

- **Neutral line vs overlay colour.** The neutral line and the "vs" overlay are the same colour in **both** themes, not only dark: live light `#645e56` for both. They differ only by solid 1.5px vs dashed 2px. Owner ruling 5 fixes neutral to `--app-text-muted`, so this is acceptable, but it is worth a note in the PR.
- **Editor rows have no visible field labels.** Each row is only placeholders plus aria-labels. Once filled, a band row reads "0 | 20 | Healthy | Good" with nothing saying which number is From. A compact column-header row would help.
- **HTML `maxLength` on the label inputs counts UTF-16 units.** So the editor stops at 30 emoji while the server and schema accept 60 code points. It is harmless (stricter), but inconsistent with the cycle-2 code-point rule.
- **Overlay data in my fixture.** The overlay's "previous" data equalled the current run, so the dashed line was hidden under the solid one. This happens in the existing overlay/history path and is not caused by this change; the series is present (dashed, z 1).
