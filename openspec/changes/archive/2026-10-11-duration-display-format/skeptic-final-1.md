## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `eb1b8a069a6ab1c5fd11b6cf8f2b35b7c0dbc2e7` against the live review base `bcb0e891923094c1a1e85ecc053f30a73ee6d70f` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/duration-format-type/HEL-1308`.

Evidence dir for this gate: `/home/matt/Development/helio/.concertino/runs/HEL-1308/evidence/skeptic-final-1/`. It sits in the durable run dir, outside the worktree, so it survives `cleanup.sh --phase4`.

### What I verified (with evidence)

**Diff scope.** `git diff --stat bcb0e8919...HEAD` shows 34 files.
- `conditionalFormatting.ts` is NOT in the diff, so C2 holds.
- No backend value validator was added. The only backend main-source changes are `OutputFormatVocabulary.scala` (new, documentation only) and one appended `+ OutputFormatVocabulary.Doc` in `OutputConfigValidation.KeysDoc`, so C3 holds.

**AC1 (330 renders "5m 30s"; 0, sub-minute and hour+ values are sensible).** `formatDuration.ts` follows D2 line by line:
- It rounds the magnitude half-up.
- The first rounding only picks the units.
- The total is rounded once, from the original magnitude, and then re-decomposed.
- The sign is applied once, and there is no `-0s`.
- It prints digits through `Intl.NumberFormat("en-US", {useGrouping:false})`.

I ran my own probe: the file copied to the evidence dir, executed with node 22 (`probe.ts` in the evidence dir). Results:
- Spec examples: 330 `5m 30s`, 0 `0s`, -0 `0s`, 45 `45s`, 45.6 `46s`, 0.25 `250ms`, 3600 `1h`, 3725 `1h 2m`, 3755 `1h 3m`, 90061 `1d 1h`, 59.6 `1m`, 3599.7 `1h`, 3629.5 `1h`, 88199.5 `1d`, 86399 `1d`, -330 `-5m 30s`.
- My own edge cases:
  - Negative fractional: -0.25 `-250ms`, -45.6 `-46s`, -0.5 `-500ms`.
  - Values that round to zero: -0.0004 `0s` (no `-0s`).
  - Values around one second: 0.9995 `1s`, -0.9995 `-1s`, 0.9994 `999ms`, 0.0005 `1ms`.
  - Rounding boundaries: 59.5 `1m`, 59.4 `59s`, 3599.5 `1h`, 3599.4 `59m 59s`.
  - Large values: 400 d `400d`, 1e9 `11574d 2h`, 1e15 `11574074074d 2h`.
  - Exact halves round away from zero: 2.5 `3s`, -2.5 `-3s`.
  - Absurd magnitudes: 1e300 prints a long plain digit string with no exponent, as D2 requires.
- One float-precision artefact at absurd magnitudes: 1e20 gives `...d 9h` where exact arithmetic would give 10h. That is double precision beyond 2^53 and is not a real-world concern.
- ms variant, through `formatMetricValue(…, "durationMs")` and `unit: "ms"`: 330000 `5m 30s`, 3629500 `1h`, 1500 `2s`, 0.4 ms `0s`.

**AC2 (selectable in the editor; accepted by backend validation and the JSON schema).**
- `METRIC_FORMAT_OPTIONS` gains `Duration` / `Duration (ms)`. `COLUMN_FORMAT_OPTIONS` gains `Duration (s)` / `Duration (ms)`, and `isColumnFormatSelection` accepts both.
- `useOutputColumnFormats` maps `durationMs` to and from `{type:"duration", unit:"ms"}` and strips a stale `unit` on every other selection.
- Live check in the running app: I reopened a stored `{ms:{type:duration,unit:ms}}` column and it showed `Duration (ms)`. I switched it to Number and then to Duration (s), and saved. A GET on the Output returned `columnFormats: {ms:{type:"duration"}, secs:{type:"duration"}}`: no stale unit, and both conditional rules were preserved.
- The metric editor reopened showing `Duration`, and the select lists all 6 options.
- Backend: `DurationFormatSeamSpec` creates and PATCHes duration configs through the real `OutputRoutes` and asserts exact read-back. The three request schemas carry the vocabulary in their `format` / `columnFormats` descriptions, and the seam spec pins them by exact equality.

**AC3 (null and non-numeric values fall back).**
- Metric: the `formatMetricValue` early returns run before the switch.
- Table: the `duration` case returns `formatCell(value)` when `toFiniteNumber` fails.
- Seen live in the `ms` column: null renders `—` and `"n/a"` renders `n/a`.

**HEL-1307 composition (rules on the raw value, text formatted).** This held on the running app at 1440 in dark and light, and at 375 in dark and light:
- Metric `max(secs)` = 90061 renders `1d 1h` with the warning tone (rule `gt 600`).
- Collection items 3725, 90061 and 700 render with the error tone, as `1h 2m`, `1d 1h` and `11m 40s`. Items 330, 45.6 and 0 render untoned.
- Table, cell rule `gt 600` on `secs`: warning cells show `1h 2m`, `1d 1h` and `11m 40s`.
- Table, row rule `gt 80000`: only the `e2e` row is red.
- In every case the tone comes from the raw seconds, and the text is the duration.
- The avg metric computes 94861.6/6 = 15810.27 s and renders `4h 24m`. The author `unit` suffix "per job" is still appended, which matches P6.
- Duration columns and their headers are right-aligned (`getComputedStyle(...).textAlign = right`).
- Document horizontal overflow at 375 is 0. The table scrolls horizontally inside its own grid, which is pre-existing behaviour.

Screenshots (durable):
- `dash-1440-initial.png` (dark), `dash-1440-light.png`
- `dash-375-dark.png`, `dash-375-light.png`, `table-375-light.png`, `table-375-light-scrolled.png`
- `metric-editor-1440-light.png`, `metric-format-open-1440-light.png`, `table-format-open-1440-light.png`

**Seam (`shared-test-fixtures/duration-format-seam.json`).** Every check is exact equality, never a substring:
- Frontend: arrays `toEqual` the lists; near-miss values are rejected; the formatters must produce each fixture case's text exactly.
- Backend: `Vector ==` on the lists; `Doc shouldBe` the sentence; each of the three schema descriptions `shouldBe` the fixture string.
- helio-mcp: arrays `toEqual` the lists; `FORMAT_VOCABULARY_DOC toBe` the sentence.

These checks can fail, and the logs show them failing:
- `red-backend-vocab-mutation.log:219-241`: 2 tests FAILED.
- `red-mcp-seam-mutation.log`: 3 tests red.

**Red-first / guard evidence (C1).**
- `red-frontend.log`: 9 failed / 1 passed in the editor suite. The new suites fail to compile because the modules do not exist yet.
- Each pre-passing guard is labelled with its mutation, and the red logs exist: `red-guard-metric-fallback.log` (Received "NaN"), `red-guard-table-fallback.log`, `red-guard-editor-unit.log` (Received `{type:"number", unit:"ms"}`) and `red-guard-backend-roundtrip-mutation.log`.

**Gates, re-run fresh.** I ran `nice -n 19 npm test` with `HELIO_JEST_MAX_WORKERS=2`. The repo script ran both projects in full:
- helio-mcp: `Test Suites: 46 passed, 46 total` / `Tests: 446 passed, 446 total`
- frontend: `Test Suites: 529 passed, 529 total` / `Tests: 5713 passed, 5713 total`
- `EXIT 0`

For sbt I relied on the evaluator's pasted `eval2-sbt.log` (24 succeeded, 0 failed). It is unambiguous, and no source changed after it.

**DESIGN.md.**
- No CSS or token changes are in the diff.
- The new options reuse the shared `Select` through the existing option arrays.
- Duration text reuses the existing metric/collection figure (JetBrains Mono) and the table cell styling.
- Tone glyphs and colours are HEL-1307's, unchanged.
- Light and dark parity is confirmed visually.
- Console: no errors from this feature. The only errors were the pre-existing `GET /api/pipelines/:id/schedule` 404, plus my own pre-login 401s and one 403 from a fetch that omitted the CSRF header.

**Mtime-ordering dependence.** None. No claim in this report rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- Label asymmetry: the metric/collection select says `Duration`, while the table select says `Duration (s)`. This was deliberate in D4, but a consistent `Duration (s)` on both would read better. The owner can flag it at PR review.
- In the monospace metric figure, `1d 1h` reads slightly wide because a monospace space is a full glyph width. This is consistent with other mono figures; it is cosmetic only.
- The conditional-format rule's Value input takes raw seconds (or ms) with no unit hint when the format is duration. The existing helper text ("compare the raw value") covers it.
- The table editor's Preview shows raw values for every column format. This is pre-existing (`OutputPreviewPane` applies only the metric format) and not introduced here.
- Dev-DB residue: the user row `cf788e23-3e5e-48fa-9b5d-976d29b43955` (`skeptic-hel1308-1791719501425@test.local`) remains, because there is no account-delete endpoint. Everything else I created was deleted by exact id and returned 204: 4 panels, dashboard `74172608-…`, pipeline `c6593303-…` and source `a3dacc54-…`. The Outputs now return 404, and every list endpoint is empty. The evaluator's user `953d45b0-4b38-468a-90d3-8141c37e4e76` also still remains. The full id list is in `ids.txt` in the evidence dir.
- Servers: I stopped the dev servers I started on 6740/9647 by exact PID (vite 383861, npm 383846, sbt java 383462/383268). Both ports are free afterwards. The browser theme was restored to `dark`, and my Playwright MCP files were moved to `skeptic-final-1/playwright-mcp/`.
