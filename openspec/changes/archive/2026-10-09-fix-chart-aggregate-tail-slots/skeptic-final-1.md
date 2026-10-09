## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: b2269d459a511d4cd2b1753baa8843ff01c2d5fb. Base resolved live via resolve-review-base.sh (origin/main): d390a62e65554fab359866bd3c6eae44c00829d0.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/chart-aggregate-tail-slots/HEL-1390`.
- **Diff read in full** (`git diff d390a62e...HEAD`): buildOutputConfig.ts:215 one-line mapping fix; AssistantProposalToolSchemas.scala examples (dashboard panel, combined panel + new cast step + metric Output with config aggregation, PatchSet summary); PipelineService.scala:690 chain split (formatting only); new spec tests; remodel design doc correction notes; e2e seam spec; openspec deltas.

**AC (1) writes valid slots, red-first test.**
- Fixed code: `npx jest buildOutputConfig.test.ts` -> 15/15 passed, exit 0.
- Red-first, re-run myself (not by reading): restored `buildOutputConfig.ts` from d390a62e, re-ran -> `Tests: 1 failed, 14 passed`; failure is the HEL-1390 chart test, `- "xAxis": "region" / + "category": "region"`. Restored with `git checkout --`; worktree clean afterwards.
- Live seam (my own run, servers verified to be this worktree's via /proc/<pid>/cwd for ports 6822/9729): throwaway user, static source, pipeline, limit step; drove the real New-output sheet (Chart, group-by region, value amount, Sum) and clicked "Add as tail with aggregate". Network: `POST .../steps => 201`, `POST .../outputs => 201`. Stored Output config `fieldMapping: {xAxis: "region", yAxis: "sum_amount"}`, `aggregation: null`; aggregate step persisted (`groupBy region`, `sum_amount`). After a run the Output sheet preview renders a line chart north 4 / west 9 / east 10 (correct sums of the seed rows).
  - Screenshot: ref=/home/matt/Development/helio/.concertino/runs/HEL-1390/evidence/.concertino/runs/HEL-1390/skeptic-final-1/tail-chart-preview-dark.png
  - Screenshot: ref=/home/matt/Development/helio/.concertino/runs/HEL-1390/evidence/.concertino/runs/HEL-1390/skeptic-final-1/outputs-tab.png

**AC (2) examples corrected and asserted against the validator's key table.**
- Examples: dashboard and combined output panels now carry only title/type/outputId; the combined example's aggregation moved to a metric Output's `config` (`{fieldMapping:{value:"signups"}, aggregation:{agg:"sum"}}`), which matches `OutputConfigValidation.metricShape` (read the validator source).
- Tests read examples from the rendered `AssistantProtocol.assistantTools` surface and derive the forbidden set from `OutputConfigValidation.KnownKeys` (not a hand-copied list), validate every example Output config with `OutputConfigValidation.validateConfig`, and assert non-vacuity.
- `sbt --client testOnly ...AssistantProposalToolSchemasSpec` -> 24 run, 24 succeeded.
- Mutation (mine): re-added `"aggregation": {...}` to the dashboard example's output panel and `"bogusKey": 1` to the combined metric Output config -> `Tests: succeeded 22, failed 2`: "never put an Output config key on an output panel *** FAILED *** ... carries Output config key(s) aggregation" and "give every example Output a config that passes OutputConfigValidation.validateConfig *** FAILED *** example metric Output config {...bogusKey...}". Restored via `git checkout --`.
- Stale "render-only": dated corrections at remodel doc L31/L72/L152; live `pipeline-output-sheet` spec L49 "render-only" is replaced by this change's MODIFIED delta at archive.

**AC (3) tidied.** `doc shouldBe a[String]` removed; PipelineService chained line split, no semantic change; "both prompts" bullet already resolved per premise validation.

**Full gates:** relied on evaluator's pasted logs, which are unambiguous: `.concertino/runs/HEL-1390/eval1/sbt.log` (6413 succeeded, 0 failed, exit 0), `jest.log` (481 suites / 5067 tests passed). My targeted re-runs above agree.

**UI/design judgment:** no styling, component or token change in this diff; the only UI-visible effect is that the chart tail path now succeeds and renders through the existing chart component. No design-standard surface to judge; light/dark parity unaffected. Console: one 404 on `/schedule` (no schedule set, pre-existing) and ECharts zero-size warnings on modal mount (pre-existing), none from this change.

**Residue:** pipeline 1d8ce28f-b95f-4454-8655-49c5c5d4ef03 -> 204, source 7f8e15e1-04f6-4fbd-b96c-b495d3e3d03f -> 204, output 0df87d8c-5b7d-4c7d-aa7d-3b1059050f19 -> 404 afterwards. Throwaway user aa82fbd0-b7b3-434f-ad77-e8f74df99fab remains (no account-delete API). The sbt server I started was shut down via `sbt --client shutdown`; the dev backend stayed healthy (200).

**Gate-defect check (CON-160):** no mtime-ordering claim relied upon.

### Verdict: CONFIRM

### Non-blocking notes
- The dashboard panel input schema (AssistantProposalToolSchemas.scala L73-83) still advertises panel-level `fieldMapping`/`aggregation`/`label`/`unit` properties, which stay inert on output panels. The design explicitly lists the wire schema as a non-goal, so this is not a defect here; a follow-up could add descriptions saying they are ignored for `type: "output"`.
- e2e/hel1390-chart-tail-aggregate-live.spec.ts `finally` deletes do not assert their status, and the throwaway user is left behind (the evaluator noted this too).
