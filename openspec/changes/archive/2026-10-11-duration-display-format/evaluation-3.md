## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `16b526f41818cde26474763aac981cf7c9eb8f9f` against the live review base `5986340c5fbe17cc6ea64618d53fcce2b9fad6ae` (resolve-review-base.sh, origin/main).

Two things changed since cycle 2 (`eb1b8a069`):
- the merge commit `b92f447c1` (origin/main at 5986340c5);
- commit `16b526f41`, which implements the owner ruling on P6. The ruling is in `events.jsonl` as `escalation.answered` with `approve-hide-duration-unit-suffix` and `answer_source: human`.

Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1308/evidence/`. Files prefixed `eval3-` come from this evaluation's own runs.

### Phase 1: Spec Review — PASS

- **The owner ruling is implemented as specified.**
  - The new requirement "Metric unit suffix hidden for duration" is added identically to the archived change spec and to `openspec/specs/output-duration-format/spec.md`. The only differences between the two files are the header and the `ADDED`/`Requirements` heading.
  - `design.md` P6 records the ruling and that P6 changed from the assumed call.
  - Implementation:
    - `isDurationFormat`, plus the guard on the unit `<span>` in `MetricRenderer.tsx:170`.
    - `metricBaselineText` at `MetricRenderer.tsx:69-76`, used by `MetricOutputPanel.tsx:117`.
  - It is a display rule only: the stored `unit` stays as written. In the running app, the stored config read back `unit: "s"`, `format: "duration"`, and the editor's "Unit text" field still shows `s`.
- **No surface still renders or announces the unit beside a duration value.** I enumerated every unit sink in `frontend/src`:
  - **Unit `<span>`:** the only element is `MetricRenderer.tsx:170`. Every metric/collection surface renders through `MetricRenderer`: `MetricOutputPanel`, `CollectionRenderer` items (both the `metricOptions.unit` and the `fieldMapping.unit` paths), `OutputPreviewPane` (the editor preview) and `PanelContent`.
  - **Baseline text:** the only builder is `metricBaselineText`. It is shown in `ProvenanceContent.tsx:97`.
  - **Comparison delta:** `ComparisonLine` never includes the unit, and its `aria-label` is direction plus magnitude plus words.
  - **Tone text:** the sr text (`ToneSrText`) reads the rule name only.
  - `HistorySummary` does not use `unit`.
  - No other `unit` string is composed beside a formatted value anywhere.
- **Red-first evidence (C1) is genuine.** `red-cycle3-unit-suffix.log` shows 5 behavioural failures with exact received values:
  - `<span class="panel-content__metric-unit">s</span>` for duration and for durationMs;
  - the collection unit from `metricOptions`, and the `fieldMapping` unit column (`ms`);
  - `metricBaselineText(330,"duration","s")` returned `"5m 30s s"`.

  The 7 tests that pass in that run are the pre-existing ones plus the labelled guard.
- C2: `conditionalFormatting.ts` is untouched. C3: there is still no value validator; `LegacyOutputFormatSpec` is a test-only guard.
- The merge introduced no regression in the duration feature:
  - `git show --cc b92f447c1` has no conflict hunks.
  - Not one of the feature's code files differs between `eb1b8a069` and `b92f447c1`.
  - HEL-1441's `LegacyOutputFormat.normalise` rewrites only an object-valued `format`. The new `LegacyOutputFormatSpec` guard pins that `duration`/`durationMs` strings, and a `unit`, pass through unchanged, including through `normaliseRestored`.

### Phase 2: Code Review — PASS

Gates were run fresh at nice 19 in `WORKTREE_PATH`:
- `npm run lint`: 0
- `npm run format:check`: 0
- `npm run typecheck`: 0
- `npm run check:schemas`: 0
- full root `npm test`:
  - helio-mcp: 47 suites / 450 tests passed
  - frontend: 531 suites / 5723 tests passed
- `npm --prefix frontend run build`: 0

All of these are in `eval3-gates.log`.

`sbt -J-Xmx3g testOnly` over 6 suites, 82 tests, 0 failed, with the HEL-1468 guard reporting `failed=0 aborted=0` (`eval3-sbt.log`):
- `DurationFormatSeamSpec`
- `OutputConfigValidationSpec`
- `LegacyOutputFormatSpec`
- `LegacyOutputFormatParitySpec`
- `AssistantProposalToolSchemasSpec`
- `RefinementEditShapeSpec`

The `sbt --client` server was shut down afterwards.

Code: `isDurationFormat`/`metricBaselineText` are small, typed and exported. The baseline-text logic moved out of `MetricOutputPanel` into one tested helper, which is DRY. There is no `any` and no dead code. DESIGN.md [mechanical]: no CSS or token changes.

### Phase 3: UI Review — PASS

Setup:
- Servers: `start-servers.sh` on 6740/9647, and `assert-phase servers` PASS.
- Fresh account `eval-hel1308-c3-1791744894@example.test`.
- One static source and one pipeline with 5 Outputs, run twice so `compare: previous_run` has a baseline:

| Output | Config |
|---|---|
| metric | `duration`, `unit: "s"`, rule `gt 600` warning "slow" |
| metric | `number`, `unit: "s"` |
| metric | `durationMs`, `unit: "ms"` |
| collection | `duration`, unit column `u`=`s`, rule `gt 600` error |
| collection | `number`, the same unit column |

Observed, with the same results at 1440 dark, 1440 light, 375 light and 375 dark (DOM-measured unit-element count per panel):

| Panel | Rendered value | Unit elements |
|---|---|---|
| Metric, duration | `1h 2m`, warning tone from raw 3725 | 0 |
| Metric, number | `3725` + `s` | 1 |
| Metric, durationMs | `11m 40s` | 0 |
| Collection, duration | `5m 30s`, `46s`, `1h 2m` (error), `11m 40s` (error) | 0 |
| Collection, number | `330 s` style on each item | 4 |

- **Baseline (provenance) text:**
  - The duration metric reads `Compared with 31 seconds ago · 1h 2m`, with no unit.
  - The number metric reads `... · 3725 s`.
- **Editor preview:**
  - On a duration metric, the preview value is `1h 2m` with no unit element.
  - Switching Format to Number live makes the unit appear (`s`).
  - The edit was cancelled, not saved.
- **Conditional formats:** they compose with duration plus a hidden unit. The tone comes from the raw value, and the sr text announces the rule name only.
- **Layout and console:**
  - No horizontal overflow at 375.
  - No console errors from the feature; the only one is the 404 from `GET /pipelines/:id/schedule` on a pipeline with no schedule.

Screenshots are durable, in `evidence/eval3-ui/`:
- `c3-dash-1440-dark.png`
- `c3-dash-1440-light.png`
- `c3-dash-375-light.png`
- `c3-dash-375-dark.png`
- `c3-provenance-number-dark.png`

This session's Playwright MCP files were moved to `eval3-ui/playwright-mcp/`.

Cleanup:
- The dashboard `218648ed-7b26-4bef-a27e-4c62132232fc` (5 panels), the pipeline `cd18576d-9871-49b5-9921-b87a629eb9fa` (5 Outputs) and the source `e131c0b5-9308-46ef-937b-f8b585cf5e04` were deleted by exact id (204). The list endpoints are now empty.
- User `ed48a6af-0abb-4a02-a1a2-38ff48628042` was deleted by exact id+email through HEL-1301's own builder (`e2e/support/userCleanupCore.cjs`; script `eval3-ui/delete-user.cjs`). Afterwards the remaining row count was 0.
- Servers (sbt run chain and npm/vite) were stopped by exact PID. Ports 6740/9647 are free.

### Overall: PASS

### Non-blocking Suggestions
- **C1 wording:** `MetricRenderer.duration.test.tsx` "keeps the unit for a non-duration format (guard: unchanged behaviour)" is labelled a guard but names no mutation. The obvious one is to hide the unit unconditionally; then `toHaveTextContent("s")` on a null element fails, so the test can fail. Name it in the comment for consistency with cycles 1-2.
- `LegacyOutputFormatSpec`'s new guard names its mutation but has no recorded red run. This is the same situation as the cycle-1 backend guard.
- **Dev-DB residue, still open:** `953d45b0-4b38-468a-90d3-8141c37e4e76` (`eval-hel1308-1791718331@test.local`, this evaluator's cycle-1 user) and `cf788e23-3e5e-48fa-9b5d-976d29b43955` (`skeptic-hel1308-1791719501425@test.local`) are both clearly HEL-1308 residue. They were identified by a read-only lookup (`eval3-ui/lookup-users.cjs`). HEL-1301's builder refuses them because `test.local` is outside its e2e throwaway domains (`example.test`, `example.com`). I did not get around that guard with hand-written SQL; they need exact-id removal by the driver.
