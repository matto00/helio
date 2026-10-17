## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `a9ff8cbf825ac282edfce6bc5c8744109cb9cbbe`. Base resolved live with `resolve-review-base.sh`: `d777803c1fbdf45f093584527ed4c052c8ad992f`. The diff covers 68 files.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/source-sample-store-label/HEL-1628`.

**AC1: the endpoint returns the engine-loaded head for REST, SQL, CSV and dataset sources, with owner access.**
- `SourceSampleService.sample` (SourceSampleService.scala) does three things in order:
  - it calls `findByIdOwned` (DataSourceRepository.scala:180, which uses `withUserContext` plus an explicit owner filter);
  - it refuses image sources with 400;
  - it calls `engine.loadRowsWithStats(ds, dataSourceRepo)` directly. This is the same dispatch a run uses (InProcessPipelineEngine.scala:522), on an engine built with the run's `fileSystem`, `connector` and shared `SourceUrlFetch.seam`.
- The response takes `head = rows.take(1000)`. The counts logic matches design D4.
- I checked the value-class coverage of `SampleRowJson` against the engine's loaders:
  - `jsValueToAny` produces only null, Boolean, Double and String;
  - text and PDF rows add Long and Int;
  - CSV produces String or null.
  - All of these are encoded, and anything else is a 500 with no `toString` fallback.
- Fresh run, `sbt testOnly SampleRowJsonSpec SourceSampleServiceSpec SourceSampleRoutesSpec SourceSampleSeamSpec`: **27 succeeded, 0 failed, exit 0**. These tests cover:
  - REST rows equal `loadRowsWithStats` output, flattened;
  - truncated REST with a known total;
  - SQL truncated with total `None` (embedded PG `generate_series(1,1001)`);
  - uploaded CSV with 412 rows and with 1500 rows (first 1000 in file order);
  - a URL CSV to a blocked host returns 502 through the shared seam;
  - image returns 400 and nothing is written;
  - a missing file returns 404;
  - read failures return a 502 with a curated message or a generic one.
- Live, on the running app (port 9967 via the 7060 proxy), as a fresh user:
  - CSV with 1200 rows: 1000 rows, `sourceRowCount` 1200, `truncated` true, `live` false, row 0 `n:"0"`, row 999 `n:"999"`, `capturedAt` `2026-10-17T03:15:10.687Z`. The millisecond precision confirms the server is running the a9ff8cbf8 code.
  - Dataset with 30 rows: `sourceRowCount` 30, `truncated` false, `live` false.

**AC2: the 31st request gets 429 and the run guard is untouched.**
- The route sits inside `DataSourcePreviewRoutes`' `rateLimited` block (DataSourcePreviewRoutes.scala). `SourceSampleService` has no reference to `PipelineRunService` or to any guard repository.
- `SourceSampleRoutesSpec` passed (fresh) on `TwoUserRlsApiFixture`. It sends 29 samples, then 1 `/preview`; the 31st request (a sample) returns 429 with `Retry-After`, and the next `/preview` also returns 429. The `pipeline_runs` count, the `pipeline_run_rate_window` count and `SUM(request_count)` are unchanged.
- If the route were moved outside `rateLimited`, the 31st request would return 200 and the test would fail, so the assertion is meaningful.

**Owner-only access and RLS on the non-BYPASSRLS role.** The same spec, on the `helio_app_test` restricted pool:
- the owner gets 200 with a schema-valid body;
- user B gets 404 on A's source, with no `secret-orders` text and a body byte-identical to the 404 for an unknown id.

**No row contents or credentials in logs.**
- The service logs only the source id plus an exception class name, or the encoder's class-name message.
- `grep -c "row-[0-9]"` on `.concertino-backend.log` returned 0 after my live samples of the 30-row and 1200-row sources.
- Credentials use the run's `ConnectorResolveContext.Internal` path, unchanged, and only after the ownership check. The doc comment in ConnectorDriver.scala is updated to say so.

**Schema seam on both sides (C1).**
- `SourceSampleSeamSpec` (server):
  - serializes engine-typed rows through the real `SourceSampleResponse` writer and `SampleRowJson.encode`;
  - validates them against `schemas/sources/source-sample-response.schema.json`;
  - asserts the committed `shared-test-fixtures/source-sample/*.json` equal that output exactly;
  - includes negative cases: missing `capturedAt` or `sourceRowCount` or `live`, an extra key, `$int` 1.5, a numeric `$long`, a malformed `$long`, a bogus `$double`, an object with extra keys, a nested map, and an array.
- `sourceSampleWire.contract.test.ts` (client) validates the same fixtures with Ajv2020 and runs them through `wire.decodeRow` (Int and Long become `Integral` of the right kind, -0 and -Infinity are preserved), plus negative cases. It passed in my fresh jest run.
- `npm run check:schemas` exits 0.

**AC3: capture once, refresh only on the button, nothing kept across a reload.**
- On the running app, two-root pipeline (dark): 2 sample requests on the first load. A reload after switching theme sent exactly 2 more. Navigating within the app to another pipeline using an already-cached source sent 0.
- Editing the filter value to 5 sent 0 sample requests; only analyze and step-preview traffic followed.
- Clicking "Refresh sample of skeptic-static-30" sent exactly 1.
- Store code: the thunk's `condition` skips loading and existing entries unless `force` is set. Nothing is persisted, and `clearAuth` bumps the epoch so a late fulfilment is dropped.
- I re-ran the executor's e2e myself (`DEV_PORT=7060`, under the e2e flock, 1 worker, output to SCRATCH_DIR): **3 passed (27.3s)**. It covers capture-once, zero requests on edit, one on refresh, a fresh capture on reload with no `sample` keys in storage, and the phone chip. Its global teardown deleted its 3 users.

**AC4: the four label cases, both themes, and the phone chip.**
- `describeSampleLabel` implements the spec table, including the "1,000+" case for an unknown total.
- I looked at the fresh e2e screenshots and my own captures:
  - static exact: "Static · 30 rows", no caveat;
  - static over the cap: "first 1,000 of 1,200 rows" plus the caveat, no age;
  - live exact: "sample · 412 rows · fetched 3 minutes ago";
  - live prefix: "sample · first 1,000 of 12,431 rows · fetched 3 minutes ago" plus the caveat.
- The two live cases are fixture-fulfilled through `page.route` with a schema-validated body, as design D10 says (no reachable live host from the dev stack).
- Evidence: `.../evidence/.concertino/scratch/HEL-1628/skeptic/two-root-dark-1440.png`, `.../skeptic/two-root-light-cards.png`, `.../skeptic/e2e/page-live-prefix-dark.png`, `.../skeptic/e2e/label-live-exact-light.png`, `.../skeptic/e2e/phone-chip-dark.png`, `.../skeptic/e2e/phone-chip-light.png` (all under `/home/matt/Development/helio/.concertino/runs/HEL-1628/evidence/`).

**DESIGN.md v3 judgment.**
- The label uses only `--text-xs` and `--app-text-muted`, with `--space-1` gaps. No accent appears on the label or the refresh control: the icon is a neutral ghost `IconButton`, and its focus ring comes from the primitive.
- The refresh control reuses the shared `IconButton` at `xs` size with `aria-label` and `title`. DESIGN.md §5 allows `xs` for inline row actions, and this inline label action fits that.
- Light and dark look the same apart from theme colours (muted grey on both card surfaces). The label sits under the kind meta with consistent rhythm, and the caveat wraps cleanly.
- On phone, the chip and label stack within the header row with no overflow at 390px.
- The page's only accent-coloured controls are pre-existing (Run pipeline, the selected step, the phone Output/Branch pills). This change adds none.

**Evaluator not wired into the UI; store API usable by HEL-1631.**
- `grep` shows `selectRootFrames` and `selectSourceFrames` are referenced only from the slice and tests. `evaluatePipeline` is imported only from the evaluator module itself and its index.
- The selectors return the evaluator's own `RootFrame[]` and `SourceFrames` types (`complete = !truncated`), and typecheck passes.

**Other gates (fresh, run by me):**
- `npm run lint` 0; `npm run typecheck` 0; `npm run format:check` 0; `npm run check:scala-quality` clean.
- Targeted jest (34 suites, 1208 tests: sample, label, hook, service, header, pipeline page, evaluator, token guards): exit 0.
- `PipelineRunServiceSpec` + `InProcessPipelineEngineUrlRefetchSpec`: 100/100. The `SourceUrlFetch` extraction does not change behaviour.
- I did not re-run the full `sbt testFull` or the full jest suite. For those I relied on evaluation-2's stated exit codes and counts (8,939 sbt; 524 + 8,793 jest), which are asserted rather than pasted. The changed areas' suites were re-run fresh above.

**Gate-defect check (CON-160).** No report I relied on depends on mtime ordering, so I have no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- A static source's spine card reads "Static" (kind meta) directly above "Static · 30 rows". This doubled word is the spec's mandated wording, not a defect. HEL-1631 or a later polish pass could drop the kind meta when the label already says "Static".
- The refresh icon (24px `xs` box, `align-items: flex-start`) sits a few px below the 12px text baseline. `align-items: center` on `.source-sample-label__line` would line it up for single-line labels.
- The PR body must record the label placement (spine card plus under the phone chips) as a reversible visual choice, per the driver brief. No PR exists yet, so the orchestrator must check this at delivery.
- `$long` decoding uses `Number(...)`, which loses precision above 2^53. This is inherited from HEL-1581's value model; flag it for HEL-1631.
- Residue: my live probe registered one dev-DB user, `hel1628-skeptic-1792206909880@example.test`, with 2 sources and 3 pipelines. I did not delete it by hand, following the exact-id destructive-ops rule; add it to the next residue sweep.
