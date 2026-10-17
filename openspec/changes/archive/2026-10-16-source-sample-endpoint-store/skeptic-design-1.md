## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d777803c1fbdf45f093584527ed4c052c8ad992f (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/source-sample-api/spec.md, specs/pipeline-source-sample-store/spec.md).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/source-sample-store-label/HEL-1628`.
- **Engine path (D2/D4) is correct.** `InProcessPipelineEngine.loadRowsWithStats` (`InProcessPipelineEngine.scala:522`) is the
  only source loader. The single production run caller is `InProcessExecutionBackend.scala:54`, which passes its rows
  unchanged as the root frames into `executeTree`. REST (`:661`) and SQL (`:673`) read with `maxRunRows` = `MaxRunRows` = 1000
  (`:113`, `:188`) and return `SourceReadStats(outcome.truncated, outcome.availableRowCount)`. Every other kind returns
  `(false, None)` and is uncapped. `FetchOutcome` (`ConnectorDriver.scala`) documents that `availableRowCount` may be
  `None` while `truncated` is true. So D4's two branches cover every kind: (a) REST/SQL truncated → nullable total;
  (b) otherwise `rows.size` is the exact total. CSV truncation (12,431 > 1000) correctly comes out of branch (b).
  Dataset is capped at 500 (`DataSourceService.DatasetMaxRows`), so it can never be truncated.
- **Limiter scope (D1) is correct.** `DataSourcePreviewRoutes.routes` applies `rateLimited` inside `pathPrefix("data-sources")`.
  It is mounted with `sourceFetchRateLimitDirective` (its own `InMemoryRateLimiter`, `ApiRoutes.scala:315-321`, 932). The
  earlier-mounted `DataSourceRoutes` has no matcher for `:id/sample` (`DataSourceRoutes.scala:109-220`: csv-limits,
  references, `:id`, `:id/schema`, `:id/rows[...]`). The request therefore falls through to the preview routes and is charged
  to the source-fetch bucket. `RateLimitDirective` sends `Retry-After` on 429 (`RateLimitDirective.scala:97`).
- **Run guard is unreachable (D2).** The guard lives in `PipelineRunService.submit` / `PipelineRunExecutor`. A service that
  builds its own engine and calls `loadRowsWithStats` touches neither one.
- **Access (D3) matches preview.** `DataSourceService.preview` authorizes with `findByIdOwned` (`DataSourceService.scala:1351`).
  `findByIdOwned` runs under `withUserContext` plus an explicit owner filter (`DataSourceRepository.scala:180-185`). The
  dataset read after it is privileged (`readDatasetRows`, `:920`, `withSystemContext`), the same as the existing preview and run.
- **Credentials (D3).** The engine hard-codes `ConnectorResolveContext.Internal` for REST/SQL (`:661`, `:673`). That is what the
  ticket's house rule requires ("exactly as the existing engine fetch path"). The request-driven REST preview
  (`SourceService.scala:436`) uses `Owned(user)`, so this endpoint differs from it. That difference is bounded:
  - Source create validates connector ownership (`SourceService.scala:134-137, 214-240`).
  - The source owner can already reach the same connector through a pipeline run.
  - See the non-blocking note on the stale `ConnectorResolveContext` doc comment.
- **RLS fixture.** `TwoUserRlsApiFixture` creates `helio_app_test NOSUPERUSER NOBYPASSRLS` and routes the app pool through
  `SET ROLE helio_app_test`, with the full `ApiRoutes` tree. It does exercise the restricted role. Its `stubFileSystem.read`
  returns empty bytes, though (see notes).
- **Value model (D6).** The evaluator `Value` = null | boolean | string | number(double) | `Integral` int/long
  (`evaluator/value.ts:8-17`). `decodeValue` exists only in `evaluator/testing/corpus.ts:37`, which imports `fs`. Moving it
  into a production module is justified. What engine rows can actually contain:
  - `jsValueToAny` (`PipelineRowJson.scala:54-63`) maps JSON numbers to Double and **compactPrints any JsObject/JsArray to a
    String**. So REST, SQL and dataset rows hold only null, Boolean, Double and String; map-path and array leaves are strings.
  - CSV cells are String or null.
  - Text/PDF rows carry Int (`pageNumber`, `pageCount`, `characterCount`) and Long (`sizeBytes`).
  - The only nested `Map` any loader emits is the image row's `content` (`loadImageRowFromBytes`), which D5 refuses.
  - Result: the `$int`/`$long` encoding is load-bearing for text/pdf. The nested-map and non-finite/-0.0 paths cannot be
    reached from real source rows.
- **Image refusal (D5) is justified.** The URL-backed image branch calls `fileSystem.write(i.config.path, bytes)` before it
  builds the row (`InProcessPipelineEngine.scala:627-628`).
- **Labels vs §4.** I checked the spec table against `docs/live-draft-preview.md` §4 and §12 item 5. All four cases match, and
  "1,000+" for an unknown total is a disclosed, self-approved addition. `live` = rest_api / sql / any file kind with
  `sourceUrl` covers every kind (`DataSourceKind` has csv, rest_api, sql, dataset, text, pdf, image; there is no separate
  connector kind).
- **Evaluator inputs.** `RootFrame {rootId, rows}` and `SourceFrames = Record<dataSourceId, {rows, complete}>`
  (`evaluatePipeline.ts:29-34`). `combine.ts:54` treats `!complete` as "secondaryNotCached". D7's `complete = !truncated` is
  correct.
- **Sign-out.** Logout and the 401 path both dispatch `clearAuth` (`authSlice.ts:248`; `warmListeners.ts:204-211` resets the
  existing client caches on it). D7's "reset alongside the existing auth reset" is feasible.
- **Schema drift.** `check-schema-drift.mjs:165-175` requires the schema `title` to name a case class in `JsonProtocols` or
  `api/protocols/*`. Task 1.3/1.4 is compatible.

### Verdict: REFUTE

The core design is sound and well grounded: the engine path, limiter scope, run-guard isolation, access, labels and image
refusal all hold. Three planning defects would each force the implementer to guess on a parity or contract point. They are
cheap to fix in the artifacts.

### Change Requests

1. **D2 misstates how the URL-fetch seam is obtained. Specify the actual mechanism.** D2 says `SourceSampleService` is
   built with "the same `fileSystem`, `connector`, URL-fetch seam … that `PipelineRunService` receives". `PipelineRunService`
   does not receive a URL-fetch seam. It builds one privately: `private def urlFetchSeam` (`PipelineRunService.scala:125-139`)
   dispatches csv to `CsvUrlFetch.fetch` (https-only, non-CSV-body gate, `maxFileSizeBytes`) and text/pdf/image to
   `ContentSourceSupport.fetchUrlWithLimit` with per-kind byte limits, then passes it to the engine at `:142`. The service
   cannot reuse it as written. An implementer would either copy it, which reintroduces the per-kind drift HEL-862/881 closed,
   or not wire it, so every URL-backed CSV/text/PDF sample fails with "URL-backed source fetch is not configured".
   - Revise D2 to extract the seam into one shared function used by both `PipelineRunService` and `SourceSampleService`, for
     example a companion or object method taking `(system, resolveHost, isBlocked)`. Keep the lazy `system` dereference.
   - Add a task for the extraction, with a test that a URL-backed CSV sample goes through the same gate as a run (for
     example, an http:// URL is rejected the same way).
2. **Pin the wire form of an unknown `sourceRowCount` (the contract is undetermined).** The spec requires
   `sourceRowCount` null for a truncated read with no observed total. A default spray `jsonFormatN` *omits* a `None` field;
   it does not emit `null`. The repo convention is a custom writer emitting `JsNull`, with global `NullOptions`
   deliberately not mixed in (`ProvenanceProtocol.scala:63`, `HomeSummaryProtocol.scala:77`, `OutputHistoryProtocol.scala:84`;
   compare `PipelineRunSupport.scala:92`).
   - D4/D6 and the schema task must state:
     - `sourceRowCount` is always present, `type: ["integer","null"]`, and listed in `required`;
     - the protocol emits explicit `null` for `None`.
   - Task 3.4's shared seam fixture must include a truncated, unknown-total sample. Otherwise the seam test can pass while the
     server omits the field and the client's "1,000+" branch reads `undefined`.
3. **Resolve the D6/D7 contradiction on unsupported (nested) values.** D6 says the decoder returns an `unsupported` marker so
   "the store can mark such a sample `evaluable: false` with the offending column". D7's entry shape
   (`{status, sample?, error?, requestedAt}`) has no such field, and neither spec nor any selector says what
   `selectRootFrames`/`selectSourceFrames` return for it. That is the API HEL-1631 is meant to consume.
   - Ground truth makes the case unreachable apart from image, which D5 refuses: `PipelineRowJson.jsValueToAny` turns every
     JsObject/JsArray into a String (`PipelineRowJson.scala:54-63`).
   - Either drop the marker and the server-side "nested maps as JSON objects" encoding (then an object in a sample is a
     decode error, so the entry becomes `error`), or add `evaluable`/`unsupportedColumn` to the D7 entry and define the
     selectors' output for it (for example, the frame is omitted).
   - Make the spec and a slice test match whichever choice is made.

### Non-blocking notes

- **Secondary sources.** `useSourceSamples` is called with root source ids only. Join/union/lookup source secondaries feed
  `SourceFrames` but are never captured, so for now `combine.ts` will report "secondaryNotCached" for them. That is fine for
  this ticket, since the hook takes arbitrary ids. State in D7 that HEL-1631 is expected to pass secondary ids through the same
  hook, so "capture once on open" covers them later.
- **Stale doc comment.** `ConnectorResolveContext` (`ConnectorDriver.scala:11-19`) says `Internal` is used *only* by the
  pipeline-execution path. This endpoint is a request-driven caller of it. Update that comment and record the bounded
  rationale in D3: the owner-only source gate, create-time connector ownership validation, and the same reach as the owner's
  own run.
- **RLS spec data.** In task 3.3, seed a `dataset` source (privileged insert into `dataset_rows`) for "owner 200 with rows":
  the fixture's `stubFileSystem` returns empty bytes, so a CSV source would yield 0 rows. The other-user 404 also holds
  through `findByIdOwned`'s explicit owner filter even without RLS. The load-bearing half of the restricted-role proof is the
  owner 200 under `helio_app_test`, so make sure that assertion checks actual rows.
- **Late responses after sign-out.** Ignore a `fetchSourceSample` fulfillment whose `requestId` no longer matches the entry,
  so a response landing after `clearAuth` does not repopulate the store. Name `clearAuth` explicitly as the reset action.
- **Lossless-value scenario.** The spec scenario lists `NaN | Infinity | -Infinity`, while D6 also encodes `-0.0` (and the
  corpus decodes it). Align the two. None of these can arise from real source rows; the encoder is defensive.
- **D7 `condition`.** The condition skips while an entry is `loading`, so the refresh button should be disabled while
  loading. Otherwise a click is a silent no-op.
