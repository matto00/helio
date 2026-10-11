## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `9d99f1629f2b32e8aeaad7e0afcfbf133ebf8559` against the live review base `bcb0e891923094c1a1e85ecc053f30a73ee6d70f` (resolve-review-base.sh, origin/main).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1308/evidence/` (files prefixed `eval1-` are this evaluation's own fresh runs).

### Phase 1: Spec Review — FAIL

- AC1 (330 -> "5m 30s"; 0, sub-minute, hour+): PASS. `formatDuration.test.ts` covers every spec scenario; I re-derived them in the running app too (see Phase 3).
- AC2 (selectable for metric and table columns; backend + JSON schema accept): PASS. Metric/collection Format select has `Duration` / `Duration (ms)`, the table column select has `Duration (s)` / `Duration (ms)`. Backend accepts and round-trips them (`DurationFormatSeamSpec` guard). The three request schemas document the vocabulary.
- AC3 (null/non-numeric fall back like other formats): PASS. Covered by tests and seen live: table `null` -> `—`, `"n/a"` -> `n/a`.
- Tasks: all checked, and they match the diff.
- `files-modified.md` matches `git diff --name-only BASE...HEAD` exactly for every code, test, schema and fixture file (the only omissions are the openspec planning artifacts, which is expected).
- C2 (no change to `conditionalFormatting.ts`): honored. The file is not in the diff.
- C3 (no backend value validator): honored. The backend change is the `OutputFormatVocabulary` doc object plus one appended `KeysDoc` sentence.
- **C1 is not honored**, which is the reason Phase 1 fails. C1 says that "a test that passes before the change is labelled a guard with a mutation that turns it red".
  - 4 of the 5 new frontend suites are recorded in `red-frontend.log` only as `Test suite failed to run` TypeScript compile errors: `'"duration"' is not assignable to type 'MetricFormat'`, and `Cannot find module './formatDuration'`. A compile-error red does not show that any assertion fails. It also hides tests that pass before the change on behaviour alone.
  - I checked these against the base code (`git show bcb0e8919:.../columnFormatting.ts`: an unknown spec type falls to `default: return formatCell(value)`, and `formatMetricValue`'s early returns run before the switch). Four tests pass before the change and none of them is labelled a guard:
    - `MetricRenderer.duration.test.tsx:16-21` "falls back exactly like the other formats ...". The pre-change early returns give the same `undefined`, `""`, `"n/a"` and `"Infinity"`.
    - `TableRenderer.duration.test.tsx:19-23` "null -> em dash, non-numeric passes through". The pre-change `default` branch gives `formatCell` -> `—`, `n/a` and `""`.
    - `TableRenderer.duration.test.tsx:49-57` "null renders an em dash and n/a passes through". Same reason as the previous test.
    - `OutputEditorSheet.duration.test.tsx:98-100` "ms -> Number drops the unit". `red-frontend.log`'s own summary (`Tests: 9 failed, 1 passed`) shows it passed before the change. The old reader dropped `unit` entirely.
  - The tests themselves are sound and can fail. Example: deleting `if (n === undefined) return formatCell(value);` from the new `duration` case in `columnFormatting.ts:76` makes `formatColumnValue({type:"duration"}, "n/a")` return `"undefined"`. They are guards, though, and the constraint requires them to be labelled as guards.
- The rest of the red-first evidence is real:
  - The behavioural red for the 9 editor tests is genuine (`red-frontend.log:167-1095`).
  - The backend schema-description test went red before the change (`red-backend.log:378-379`).
  - I ran my own mutation on the single-rounding claim: `eval1-mutation/` with orig.mts, mut.mts and run.mjs. With the total rounded from `s1` instead of the original magnitude, it gives `3629.5 -> "1h 1m"` and `88199.5 -> "1d 1h"`, so `formatDuration.test.ts:24-30` and the `3629500 ms` case would go red. These tests are real.
- Backend vocabulary tests (not red-first, mutation substitute): **adequate**. `red-backend-vocab-mutation.log:219-222` shows both the list test and the `Doc` test going red with exact-diff messages when `duration`/`durationMs` are stripped from `OutputFormatVocabulary`. The round-trip test is correctly labelled a GUARD and names its mutation. That mutation was not executed (non-blocking, see suggestions).
- Planning artifacts: `proposal.md` "Impact" lists `buildOutputConfig.ts` (and implies `HistorySummary.tsx`) as touched. Neither needed a change: `buildOutputConfig.ts:130` passes `columnFormats` through, and `HistorySummary.tsx:19` already calls `formatMetricValue`. This is a minor wording mismatch and non-blocking.

### Phase 2: Code Review — PASS

Gates, run fresh in `WORKTREE_PATH` at nice 19:
- `npm run lint`: 0. `npm run format:check`: 0. `npm run typecheck`: 0. Log: `eval1-static.log`.
- Targeted jest (`renderers|outputEditor|outputHistory|editors|helio-mcp|MetricOutputPanel`), both projects:
  - helio-mcp: 46 suites / 446 tests passed.
  - frontend: 529 suites / 5713 tests passed.
  - `npm run check:schemas`: 0. Log: `eval1-jest.log`.
- `npm --prefix frontend run build`: 0. Log: `eval1-build.log`.
- `sbt -J-Xmx3g testOnly DurationFormatSeamSpec OutputConfigValidationSpec AssistantProposalToolSchemasSpec RefinementEditShapeSpec`: 69 succeeded, 0 failed. Log: `eval1-sbt.log`.
- `npm run check:scala-quality`: clean. Its soft warnings are all pre-existing files.

Seam (`shared-test-fixtures/duration-format-seam.json`): every vocabulary check is exact equality and can fail.
- Backend:
  - `shouldBe` on the three lists and on `Doc`.
  - `KeysDoc.endsWith(sentence)`.
  - `shouldBe` on each of the 3 schema files' `format` / `columnFormats` description.
  - All of these were shown red, see Phase 1.
- Frontend:
  - `toEqual` on the exported arrays.
  - The guards reject `durationms`, `Duration`, `durationMS` and `""`.
  - The formatter checks run over all 14 `valueCases` on both the metric and table paths.
- helio-mcp: `toEqual` on the lists and `toBe` on `FORMAT_VOCABULARY_DOC`.
- The client and server vocabularies agree: frontend `METRIC_FORMATS` / `TABLE_COLUMN_FORMAT_TYPES` / `TABLE_DURATION_UNITS`, backend `OutputFormatVocabulary` and helio-mcp each carry identical ordered lists.

Code:
- `formatDuration.ts` follows D2 as specified:
  - Half-up rounding on the magnitude.
  - A single rounding from the original magnitude, with a carry re-decomposition.
  - No `-0s`.
  - `Intl` digits for huge values.
  - I spot-checked 0.0005, 0.0025, 0.9995, 1.5, 7199.5 and 1e21 and all behave sensibly.
- The `unit` handling in `useOutputColumnFormats.ts:84-88` drops a stale `unit` on every non-`durationMs` selection, as D4 requires. The guards in `outputConfigTypes.ts` are now derived from the exported arrays (DRY). No `any`, no dead code, no new dependency.
- CONTRIBUTING: no inline FQNs. File-size budgets were already exceeded before this change by `TableRenderer.tsx` (900 -> 903) and `outputConfigTypes.ts` (335 -> 361). The additions are minimal, so this is not a finding.
- DESIGN.md [mechanical]: there is no CSS change, and the new options reuse the shared `Select`/`SelectOption`. Nothing to enforce.

### Phase 3: UI Review — PASS

Servers: `start-servers.sh` on 6740/9647, `assert-phase servers` PASS. Fresh account `eval-hel1308-1791718331@test.local`.

Setup: one static source and a pipeline with a metric Output (`max(secs)`, `duration`, rule `gt 600` warning "slow"), a collection Output (`duration`, rule `gt 600` error) and a table Output (`secs: {type:duration}`, `ms: {type:duration, unit:ms}`, cell rule `gt 600` on `secs`). The pipeline was run and a dashboard placed all three.

Checks:
- Happy path, rendered on the dashboard:
  - Metric: `1d 1h` with the warning tone from raw 90061.
  - Collection: `5m 30s`, `46s`, `1h 2m` (error), `0s`, `1d 1h` (error), `11m 40s` (error).
  - Table `secs`: `5m 30s`, `46s`, `1h 2m` (warning), `0s`, `1d 1h` (warning), `11m 40s` (warning).
  - Table `ms`: `5m 30s`, `2s`, `250ms`, `—` (null), `n/a`, `11m 40s`.
  - The tone always comes from the raw value while the text is formatted, which shows the HEL-1307 composition works.
  - Duration cells are right-aligned.
- Editor:
  - The metric Format select reopens as `Duration`. Pressing ArrowDown+Enter selects `Duration (ms)`, and the live preview updates to `1m 30s`. After Save the stored config is `format: "durationMs"`.
  - The collection select offers all 6 options with `Duration` selected.
  - The table editor reopens `secs` as `Duration (s)` and `ms` as `Duration (ms)`. Switching `ms` through Number and then Duration (s) and saving stores `{ms: {type: "duration"}}` with no `unit` (checked with a GET on the Output).
- Unhappy paths: null -> `—`, non-numeric -> passthrough. No blank states.
- Console: no errors from this feature. The only error was a pre-existing `GET /api/pipelines/:id/schedule` 404 for a pipeline with no schedule.
- Accessibility: the selects have accessible names (`Format`, `Format <column>`) and keyboard selection works. The tone glyph carries an accessible name (`Warning` / `Critical`).
- Breakpoints:
  - 1440, 1100 and 768: no document horizontal overflow and no clipped metric/cell text.
  - 375: the panels stack, and the table scrolls horizontally inside its grid, which is pre-existing table behaviour.
  - At 375 the column Format listbox scrolls internally, so `Duration (ms)` is reachable. This is the shared Select's behaviour.
- Themes: light and dark were both checked at 1440 and 375.

Screenshots (durable, in the run evidence dir `eval1-ui/`):
- `eval1308-dash-1440-theme-initial.png` (dark) and `eval1308-dash-1440-light.png`.
- `eval1308-dash-375-light.png`, `eval1308-dash-375-dark.png` and `eval1308-table-375-light.png`.
- `eval1308-dash-768-light.png`.
- `eval1308-metric-format-open-dark.png`, `eval1308-table-format-open-dark.png`, `eval1308-table-editor-375-light.png` and `eval1308-table-format-open-375-light.png`.
- The Playwright MCP page/console files from this session were moved to `eval1-ui/playwright-mcp/`.

Subjective visual judgment (for example, the monospace metric figure making "1d  1h" read wide) is left to the skeptic.

Cleanup:
- Dashboard `9d60236f-...`, pipeline `bec5248a-...` (with its 3 Outputs) and source `e35e9187-...` were deleted by exact id (204s). The list endpoints are now empty for the account.
- There is no account-deletion endpoint, so **user row `953d45b0-4b38-468a-90d3-8141c37e4e76` remains** and needs exact-id removal by the driver.
- The servers (npm/vite and sbt run PIDs, exact ids) and the `sbt --client` server were stopped. Ports 6740/9647 are free.

### Overall: FAIL

### Change Requests
1. **C1 guard labelling.** Label each of these tests as a GUARD in its name or a comment right above it. For each one, name the mutation that turns it red, run that mutation once and record the red run in the run evidence dir. The tests stay as they are; only their labelling and evidence change.
   - `MetricRenderer.duration.test.tsx:16-21`. Mutation, for example: in `MetricRenderer.tsx`, call `formatDuration(Number(value))` ahead of the `Number.isFinite` early return for `duration`.
   - `TableRenderer.duration.test.tsx:19-23`. Mutation: delete `if (n === undefined) return formatCell(value);` in `columnFormatting.ts:76`.
   - `TableRenderer.duration.test.tsx:49-57`. Same mutation as the previous test.
   - `OutputEditorSheet.duration.test.tsx:98-100`. Mutation: restore `{ ...existing, type }` (the unit-spreading `setFormat`) in `useOutputColumnFormats.ts:85-88`.
   - Also note in the executor report that the red for 4 of 5 frontend suites was a compile-time red. The behavioural red was shown only for the editor suite, and for `formatDuration` by this evaluator's mutation (`eval1-mutation/`).

### Non-blocking Suggestions
- Run the backend round-trip guard's named mutation once (drop `format`/`columnFormats` in the Output write path) and keep the red log next to `red-backend-vocab-mutation.log`. Right now it is named but not shown.
- `proposal.md` Impact: drop `buildOutputConfig.ts` (and `HistorySummary.tsx`) from "touched", or note "unchanged, already routes through the shared formatter".
- The helio-mcp seam test has no red/mutation evidence. Its assertions are exact (`toEqual`/`toBe`), so this is low risk.
