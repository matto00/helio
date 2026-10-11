## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `16b526f41818cde26474763aac981cf7c9eb8f9f`. The review base was resolved live with `resolve-review-base.sh`, giving origin/main `5986340c5fbe17cc6ea64618d53fcce2b9fad6ae`. The spawn-cwd guard returned `READY`.

Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1308/evidence/skeptic-final-2/`. Everything there was captured directly in the durable run evidence dir, outside the worktree.

### What I verified (with evidence)

**Acceptance criteria**

- **AC1 (330 -> "5m 30s"; 0, sub-minute and hour+ values; unit tests).** `formatDuration.ts` is a single pure helper. It rounds once, half-up on the magnitude.
  - The tests passed fresh: 5 suites and 53 tests (`jest-duration.log`). The suites are `formatDuration.test.ts`, `MetricRenderer.duration.test.tsx`, `TableRenderer.duration.test.tsx`, `OutputEditorSheet.duration.test.tsx` and `durationFormat.seam.test.ts`.
  - The running app showed the same results on live data:
    - 330 -> `5m 30s`
    - 45.6 -> `46s`
    - 3725 -> `1h 2m`
    - 700 -> `11m 40s`
    - 0.25 s (250 ms) -> `250ms`
    - 1500 ms -> `2s`
- **AC2 (selectable in the editor for metric and table columns; accepted by the backend and the JSON schema).**
  - Live editor, metric Format options: Number, Integer, Currency ($), Percent (%), Duration, Duration (ms). Screenshot: `editor-metric-format-open-light.png`.
  - Live editor, table column Format options: None, Number, Currency ($), Date, Text, Duration (s), Duration (ms). Screenshot: `editor-table-format-open-dark.png`.
  - Reopening shows the stored selections: `Format secs=Duration (s)` and `Format ms=Duration (ms)`.
  - The backend stored `format: "duration"`/`"durationMs"`, `unit`, and `columnFormats {secs:{type:duration}, ms:{type:duration,unit:ms}}` unchanged (`outs.json`).
  - `DurationFormatSeamSpec`, `LegacyOutputFormatSpec` and `OutputConfigValidationSpec`: 36 tests succeeded, 0 failed (`sbt.log`, run fresh). This includes exact equality between the three schema descriptions and the KeysDoc text.
  - The helio-mcp `durationFormatSeam.test.ts` passed (`jest.log`).
- **AC3 (null and non-numeric values fall back like other formats).**
  - Live: a null table cell renders `—` in both duration columns.
  - Live: a null collection item renders `--` / `NO DATA`. This is the same `|| "--"` path every format uses.
  - The table and metric fallback tests are in the passing suites.

**Owner ruling (P6: hide the unit suffix for duration/durationMs)**

- The ruling is recorded in `events.jsonl` line 38: `escalation.answered`, `approve-hide-duration-unit-suffix`, `answer_source: human`.
- I enumerated every unit sink in `frontend/src` myself. There is one unit `<span>`, at `MetricRenderer.tsx:170`, now guarded by `!isDurationFormat(format)`. There is one baseline-text builder, `metricBaselineText`, used by `MetricOutputPanel.tsx:117` and shown in `ProvenanceContent.tsx:97`.
  - `CollectionRenderer` items render through `MetricRenderer` with `format`. This covers both the `metricOptions.unit` path and the `fieldMapping.unit` path.
  - `OutputPreviewPane` (the editor preview) renders through `MetricRenderer` with `format`.
  - `ComparisonLine`'s aria-label is direction, magnitude and words, with no unit.
  - `HistorySummary` never reads `unit`.
- Live DOM check on a dashboard with a duration metric (unit `s`), a number metric (unit `s`), a durationMs metric (unit `ms`), a duration collection (unit column `u`=`s`) and a duration table:
  - `.panel-content__metric-unit` count is 1, and the one element is the number metric's `s`.
  - The editor preview for the duration metric has 0 unit elements and reads `1h 2m | slow | MAX JOB`.
- Live provenance baseline text:
  - duration metric: `Compared with … · 1h 2m` (no unit)
  - number metric: `… · 3725 s`
- The stored config is unchanged. The API read-back has `unit: "s"` and `unit: "ms"`, and the editor's Unit field still shows `s`.
- The red-first evidence holds up. `red-cycle3-unit-suffix.log` shows 5 behavioural failures that match the current test names. For example, it received `<span class="panel-content__metric-unit">s</span>`, and `metricBaselineText` returned `"5m 30s s"`. Those tests now pass.

**Merge (b92f447c1) and HEL-1441**

- `LegacyOutputFormat.normalise` rewrites only an object-valued `format`.
- `LegacyOutputConfigKeys` never touches `columnFormats`.
- The new guard "leave the duration string formats and a unit unchanged (HEL-1308)" passes in my run. It covers `normalise` and `normaliseRestored`.

**Gates (all run fresh, nice 19; MemAvailable was 54 GB)**

- lint=0, typecheck tc=0, format fmt=0 (`lint.log`, `tc.log`, `fmt.log`).
- Root `npm test`, exit 0:
  - helio-mcp: 47 suites / 450 tests
  - frontend: 531 suites / 5723 tests

  Output is in `jest.log`.

**DESIGN.md, judged on the running app**

- Servers came from `start-servers.sh` on 6740/9647 and `assert-phase servers` returned PASS. Both listening PIDs had their cwd in this worktree and were started at the gate's own time, so this was not a reused server.
- The diff has no CSS or token changes. The editor options use the shared `ui-select`.
- Screenshots:
  - 1440 dark: `dash-1440-initial.png`
  - 1440 light: `dash-1440-light-settled.png`
  - 375 light: `dash-375-light-reloaded.png`
  - 375 dark (table): `dash-375-dark-table.png` and `-scrolled.png`
  - provenance: `provenance-duration-dark.png`
- Duration composes with conditional formats on the same Output:
  - The metric shows the warning glyph and tone on `1h 2m`.
  - The collection shows the error tone on `1h 2m` and `11m 40s`.
  - The table shows a cell-target warning on `secs` and a row-target "Good" on the `ms < 1000` row (`250ms`).
- Tones read correctly in both themes. Duration cells are right-aligned like the other numeric formats. There is no page-level horizontal overflow at 375 (`scrollWidth` 375).
- One anomalous reading was not a defect. The first light screenshot (`dash-1440-light.png`) was taken before the history fetch settled, so the comparison line was missing. A re-measure after 3 s showed it on all compare Outputs. The 375 overlap in `dash-375-light.png` was the desktop grid caught mid live-resize. After a reload, the mobile stacked layout is clean.
- Console errors on this run's pages were only `auth/me` 401 before login and `schedule` 404 for a pipeline with no schedule. The other entries are from a previous session's pipeline id.

**Cleanup**

- Dashboard `8f12c294-…`, pipeline `18317e89-…` and source `508a8bf0-…` were deleted (204). All list endpoints are now empty.
- User `261db1f0-d42f-4487-85ee-836c7488a553` (`skeptic-hel1308-f2-1791745979@example.test`) was deleted by exact id through HEL-1301's builder. Remaining rows: 0 (`cleanup.log`).
- The servers were stopped by exact PID, and ports 6740 and 9647 are free.
- My 19 Playwright files were moved to `playwright-mcp/`.

### Verdict: REFUTE

The code and specs are sound and match the owner ruling. The one artifact the owner reads to review the product calls does not.

### Change Requests

1. **PR #940's body says the opposite of what ships for P6.** The live body (`gh pr view 940`, line 10) reads: "**P6 Metric `unit` suffix:** still appended if the author set one, so `unit: "s"` plus duration gives `5m 30s s`. Suppressing it is an easy follow-up." The evidence copy `evidence/pr-body.md` says the same.

   The owner ruled the opposite (`approve-hide-duration-unit-suffix`). HEAD `16b526f41` implements the hide, and `design.md` P6 and both spec copies record it.

   Change needed: rewrite P6 in the PR body (and in `evidence/pr-body.md`) to state the ruling, with the same meaning as design.md P6: "OWNER RULING 2026-10-11: the metric/collection `unit` suffix is hidden for `duration`/`durationMs` on the value, collection items, baseline text and editor preview; the stored `unit` is untouched." Also mark P1-P5 and P7 as approved. If it applies, add the unit-suffix tests to the Tests section.

   No code change is needed. Re-verify by reading the updated body with `gh pr view 940 --json body`.

### Non-blocking notes

- In the editor, the metric "Unit" field still accepts and shows text while Format is Duration, with no hint that it will not be displayed (`editor-metric-duration-light.png`). A short helper line under Unit, such as "Not shown for duration formats", would explain it. This is polish; the ruling chose to leave the config untouched.
- The labels differ between surfaces: the metric select says "Duration" and the table select says "Duration (s)". This is deliberate per design D4, but a reader may expect the same label on both.
- I agree with evaluator cycle 3: the "keeps the unit for a non-duration format" guard should name its mutation (hide the unit unconditionally).
- Dev-DB residue from earlier rounds (`953d45b0-…` and `cf788e23-…` on `test.local`) is still for the driver to remove; I did not touch it.
- No mtime-ordering evidence was relied on. Every claim above rests on content: test output, DOM measurements, API read-backs and line citations.
