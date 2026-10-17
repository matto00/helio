## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `887bdb0f51a25c625968de8d2953f4cb03a4a32d` (single commit on `d777803c1`, base resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (endpoint returns the engine-loaded head, at most 1,000 rows, with `capturedAt`/`sourceRowCount`/`truncated` for REST, SQL, CSV and dataset): `SourceSampleService` calls `InProcessPipelineEngine.loadRowsWithStats` directly. `SourceSampleServiceSpec` covers a dataset; an uploaded CSV under the cap (412) and over it (1,500 → 1,000, total 1,500, file order); a URL CSV to a blocked host (502 through the shared seam); REST flattening (asserted equal to `loadRowsWithStats` output); REST truncated with a known total (1,234); and SQL truncated with an unknown total (`None`), against embedded Postgres. It also covers image → 400 with no write, 404 for unknown/unowned, the 404 re-upload message, and 502 for both curated and generic failures. Access is `findByIdOwned`, the same check the preview services use.
- AC2 (limiter, run guard): the route is inside `DataSourcePreviewRoutes`' `rateLimited` scope. `SourceSampleRoutesSpec` sends 29 samples and 1 `/preview` (all 200), and the 31st request (a sample) gets 429 with `Retry-After`, which shows the bucket is shared. The limiter window is anchored to each key's first request (`InMemoryRateLimiter.scala:37`), so the test cannot straddle a window boundary. The run guard is structurally unreachable: the service owns its own engine and never touches `PipelineRunService`. The test also confirms that `pipeline_runs` and `pipeline_run_rate_window` row counts do not change.
- AC3 (capture once, refresh only, nothing across reload): I re-ran the executor's live e2e myself and it passed: 1 request on open, 0 after a step edit, +1 on refresh, 1 fresh capture after `page.reload()`, and no `sample` keys in localStorage or sessionStorage. My own probe found 2 requests per page load for a 2-root pipeline (one per root, 8 across 4 reloads), so there is no per-render refetch.
- AC4 (four label cases plus phone chip, both themes): re-ran green. Wording matches the spec table. Static over cap shows "first 1,000 of 1,200 rows" plus the caveat from the real endpoint. The two non-static cases use the D10 schema-validated `page.route` fixture, because a live REST/SQL host cannot be reached from the dev stack. The non-static flag and counts are proven on the real service in `SourceSampleServiceSpec`.
- Constraint C1: honored. `SourceSampleSeamSpec` validates bodies produced by the real `sourceSampleResponseFormat` writer from engine-typed values, including the explicit `sourceRowCount: null`. It asserts that the committed `shared-test-fixtures/source-sample/*.json` equal the writer output exactly, so the frontend half (`sourceSampleWire.contract.test.ts`, Ajv2020 over the same committed schema plus `wire.decodeRow`) is fed real serializer output. Negative cases are present on both sides: missing `capturedAt`, missing `sourceRowCount`, malformed `$int`/`$long`/`$double`, an unknown object cell, and on the server an extra top-level key and an array cell.
- Evaluator not wired into the UI: the only imports from `pipelines/evaluator/` outside that folder are type-only (`RootFrame`, `SourceFrames`, `Frame`) plus `wire.decodeRow`, all in `sourceSamplesSlice.ts`. Nothing calls `evaluatePipeline`.
- Tasks 1.0 to 3.6 are all checked and match the diff. No scope creep. CLAUDE.md endpoint entry added. Schema committed.

Executor-reported deviations, judged:
- *Int-as-plain-number schema negative replaced by a serializer assertion*: **accepted**. Under D6 a plain JSON number means a double, so the schema cannot reject `7` for an Int cell. The right guard is that the real writer never emits it (`SourceSampleSeamSpec`: `row0("i") shouldBe {"$int":7}`), plus the corpus agreement test.
- *Run-guard proof by row counts*: **accepted**, combined with the structural argument (the service has no `PipelineRunService` reference). See the non-blocking suggestion about `request_count`.
- *14 test stores touched*: **accepted**. Every page-level test store that renders `SpineSourceCard`/`PipelineDetailHeader` needs the new reducer, and each change is a 2-line registration.
- *CSS count guards bumped 147 → 148*: **accepted**. I recounted independently: `find frontend/src -name '*.css' | wc -l` = 148.
- *Label wraps instead of ellipsis*: **accepted**. An ellipsis would cut off the capture age, which is the point of the label. No horizontal overflow at any breakpoint (below).

### Phase 2: Code Review — FAIL
Gates (my own fresh run, in WORKTREE_PATH):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test` (HELIO_JEST_MAX_WORKERS=2): exit 0. Root: 61 suites / 524 tests. Frontend: 692 suites / 8,793 tests.
- `npm --prefix frontend run build`: exit 0
- `sbt testFull` (under the sbtfull flock, `-J-Xmx3g`): exit 0. 8,939 succeeded, 0 failed, 4 canceled. All 4 canceled tests are the pre-existing `HELIO_MEASURE`-gated measurement specs. `SourceSampleSeamSpec`, `SourceSampleServiceSpec`, `SampleRowJsonSpec` and all 4 `SourceSampleRoutesSpec` cases ran and passed.
- `npm run check:scala-quality`: clean. Its regex does not cover `java.lang.`, so it misses issue 1.

Issues:
1. **CONTRIBUTING.md "Imports & Qualifiers" [mechanical] violation.** `backend/src/main/scala/com/helio/services/sources/SampleRowJson.scala:29` reads `else JsNumber(BigDecimal(java.lang.Double.toString(d)))`. That is an inline fully-qualified name, and it is the only inline `java.lang.` qualifier in all of `backend/src/main/scala`.

Verified clean:
- **Logging and security:** `SourceSampleService` logs only the source id plus an exception class name (`:83`, `:86`). The `rest-boom` test shows a credential-shaped message is replaced by "Failed to read source". `SampleRowJson.UnsupportedValue` names only the JVM class. The image refusal comes before any engine read, so nothing is written to `config.path`. Credentials use `ConnectorResolveContext.Internal` only after `findByIdOwned`, identical to the run path, and the doc comment is updated.
- **RLS:** `SourceSampleRoutesSpec` runs on `TwoUserRlsApiFixture`. Its app pool is `SET ROLE helio_app_test`, created `NOBYPASSRLS NOSUPERUSER`, and `ApiRoutes` builds the real `SourceSampleService` over that `DbContext`. On it, the owner gets 200 with 3 rows (so RLS does not deny the owner's own dataset read). User B gets a 404 body identical to an unknown id's, with no `secret-orders` row text.
- **Behaviour preservation:** the `SourceUrlFetch.seam` extraction is a verbatim move, and `system` is still read at call time through a by-name parameter.

### Phase 3: UI Review — FAIL
Servers started with `start-servers.sh` (7060/9967). `assert-phase.sh servers` printed PASS.

- Happy path: PASS (executor e2e re-run, 3/3 green, 30.1 s).
- Unhappy paths:
  - **FAIL.** When the caller's sources list (`GET /api/data-sources`) fails, the source card shows "Loading sample…" permanently. There is no refresh control and no error. I reproduced this with `page.route` returning 500 for that GET; after 8 s the card text was still `"eval-static\nLoading sample…"`. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1628/evidence/.concertino/scratch/HEL-1628/eval1/sources-list-failed.png`. Probe: `.../eval1/eval2.spec.ts`. Root cause: `SourceSampleLabel.tsx:47` treats every non-`succeeded` sources status, `failed` included, as still loading.
  - PASS: a failed first sample capture (502) shows "Sample unavailable" with the refresh button, sends exactly 1 request, and is not auto-retried. Keyboard focus plus Enter on the refresh button recovers it to "Static · 3 rows" (2 requests total). Evidence: `.../eval1/error-state-dark.png`, `.../eval1/focus-ring.png`.
- Console errors: none from this feature. Every 4xx/5xx seen was pre-existing or injected: `/api/auth/me` 401 before login, `/api/pipelines/:id/schedule` 404 (no schedule set), and my injected 502.
- Entry points: desktop spine card and phone header chips both render the label and refresh.
- Accessibility: the refresh `IconButton` has an accessible name ("Refresh sample of <source>") plus a title, works from the keyboard, and shows the accent focus ring.
- Accent (DESIGN.md v3): in both themes the label text is `--app-text-muted` and the refresh icon is neutral. Accent appears only on the primary action (Run pipeline), the selected step row, the active nav item and the focus ring (executor `page-live-prefix-{dark,light}.png`, re-generated by my run).
- Breakpoints 1440 / 1100 / 768 / 390: no horizontal overflow at any width. At 390 the chip label wraps under the chip without breaking the layout (`.../eval1/bp-{1440,1100,768,390}.png`).

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/services/sources/SampleRowJson.scala:29`: remove the inline FQN `java.lang.Double.toString(d)` (CONTRIBUTING.md, Imports & Qualifiers). The simplest equivalent is `else JsNumber(d)`: spray's `JsNumber(Double)` builds `BigDecimal(d)`, which goes through `Double.toString`. Alternatively use `BigDecimal(d.toString)`. `SampleRowJsonSpec` (1.5, -2.25, 0.0, 1e300 against the corpus) must stay green.
2. `frontend/src/features/sources/ui/SourceSampleLabel.tsx:47-56`: when `state.sources.status === "failed"` and there is no entry, do not show "Loading sample…" forever. Treat only `idle`/`loading` as waiting, so a failed sources list reads "Sample unavailable". Add a `SourceSampleLabel.test.tsx` case with sources status `failed` asserting "Sample unavailable" and no "Loading sample…". Showing the refresh control in that state is optional: ownership is unknown, so a request might 404, which is acceptable given the 404 handling.

### Non-blocking Suggestions
- `SourceSampleRoutesSpec`: the run-guard assertion counts `pipeline_run_rate_window` rows. A guard that increments `request_count` on an existing row would not change the count. Asserting `COALESCE(SUM(request_count),0)` as well would make the guard failable by that mutation.
- `SourceSampleLabel.tsx:61`: `role="status"` is a polite live region, and the 30 s age tick changes its text, so screen readers will re-announce "fetched N minutes ago" about once a minute for every source. Consider putting the live region on status changes only, or using `aria-live="off"` for the age.
- `.source-sample-label--compact` has no CSS rule and is used only as a test hook. Either style it or drop the modifier.
- `capturedAt` is emitted with nanosecond precision (`2026-10-17T02:33:13.471702164Z`). V8 parses it, but truncating to milliseconds server-side would remove any cross-engine `Date` parsing risk.
- The `IconButton size="xs"` is described in DESIGN.md as the dense-row exception for list row actions. Its use in a card label is a judgment call for the skeptic.
