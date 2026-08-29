## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every claim below derived from the named files in the worktree, not from rounds 1/2 or the
planner's account.

### Round-2 change requests — status

**CR1 (false "MCP already creates URL-backed text/pdf/image" claim) — ADDRESSED.** Decision 9 now states the
JSON body `{name, type: "csv", config: {url}, tag?}` as the contract outright and explicitly records that no
such MCP code exists, pointing at `createDataSource` in `helio-mcp/src/helioApi.ts`. Task 7.1 carries the same
NOTE. Re-verified independently: `grep -rn "sourceUrl" helio-mcp/src` → zero hits.

**CR2 (private helper unreachable from `PipelineRunService`) — ADDRESSED, and constructible as described.**
Verified: `ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked)(implicit system: ActorSystem[_])`
(`ContentSourceSupport.scala:204-208`) plus public `defaultResolveHost` (:73) and `isBlockedAddress` (:80) —
Decision 2's signature is a faithful wrapper. ActorSystem at all three call sites:
- create/refresh: `DataSourceService` already has `(implicit ec, mat, system: ActorSystem[_])`
  (`DataSourceService.scala:58`) and its own `resolveHost`/`isBlocked` ctor params (:54-55). No change needed.
- engine: `PipelineRunService` (`PipelineRunService.scala:29-52`) has only `(implicit ec)`, and its
  `private val engine = new InProcessPipelineEngine(fileSystem, connector)` (:56) is still an eagerly
  initialised field — so Decision 3's lazy-closure + null-system requirement remains correct and necessary.
- **Layering: no violation, and the design's premise is over-cautious in a harmless direction.**
  `domain/engine/InProcessPipelineEngine.scala:6` ALREADY imports
  `com.helio.services.sources.{ImageSourceSupport, PdfTextSupport}`, so `domain.engine → services.sources` is
  a pre-existing edge. The function seam is still the right call (it keeps `ActorSystem` out of the engine and
  makes the run testable), so this is a note, not a defect.

**CR3 (size-limit specifics) — PARTLY ADDRESSED. Value-sharing and failure-shape-by-path are fixed; the
honesty of what the limit actually buys is not. See CR 2 below.** Verified premises: the route's
`csvMaxBytes` is `sys.env CSV_MAX_FILE_SIZE_BYTES` / `52428800L` (`DataSourceRoutes.scala:33-34`, used at
:210-213); `ServiceError.PayloadTooLarge` → `StatusCodes.RequestEntityTooLarge` is a route-layer mapping
(`ServiceResponse.scala:85`) unreachable from `domain.engine`; the engine's existing failure idiom is
`IllegalArgumentException` naming the source (`InProcessPipelineEngine.scala:146-153`). Decision 7 is
accurate on all three.

**No initialisation-order risk from the route reading `CsvUrlFetch.maxFileSizeBytes` (question 2 — checked,
clean).** `ConnectorRegistry.scala:23-29` warns about a *mutual* object dependency (`DataSourceKind.All`
derives from `ConnectorRegistry.all`, so referencing `DataSourceKind`'s constants there would make the two
`<clinit>`s cycle). Nothing analogous here: `CsvUrlFetch` would depend only on `ContentSourceSupport`, and
nothing in `services.sources` references `api.routes.sources`. The dependency is strictly one-directional.
`sys.env` is immutable at runtime, so hoisting the read from a per-route-instance val to an object val is
behaviour-preserving.

**CR4 (BOM defeats the `<` gate) — ADDRESSED.** Decision 8 now gates on bytes inside `CsvUrlFetch`, skipping
`EF BB BF` then leading ASCII whitespace, with the BOM'd-HTML test required (task 10.3, spec scenario
"A BOM-prefixed HTML body is also rejected"). The decode-inconsistency premise re-verified as true:
`DataSourceCsvSupport.decodeUtf8` is strict `REPORT` (`DataSourceCsvSupport.scala:13-21`), `refreshCsv` uses
`new String(bytes, UTF_8)` (`DataSourceService.scala:~581`), the engine likewise in `loadCsvRowsFromBytes`
(`InProcessPipelineEngine.scala:309-310`). Gating on bytes before all three is the right resolution.

### False-claim sweep (question 4) — none found this round

Checked every load-bearing code claim added or retained in the revision:
`DataSourceService.scala:167`-style fixed `csv/${sourceId.value}.csv` path — TRUE (`createCsv`,
`CsvSourceConfig(filePath)`). Text's re-checks at `ingestText` and `refreshText` — TRUE (`bytes.length >
textMaxBytes` → `PayloadTooLarge` in both, the refresh one inside the `case Some(url)` branch).
`RestApiConnectorDriver.fetchOverride` test seam — TRUE (`RestApiConnectorDriver.scala:45, 228`).
`InProcessPipelineEngine(fileSystem, connector = null)` nullable default — TRUE (:68).
`PipelineRunService`'s nullable/defaulted convention for `binaryRefRepo`/`alertEvaluationService`/`connector`/
`auditService` — TRUE (:38-51). `DataSourceCsvSupport`'s scaladoc disclaiming Pekko — TRUE (:8-10), so
Decision 2's "new object, not an addition there" is correctly reasoned. Finding 1 re-verified: text/pdf/image
each `fileSystem.read(<config>.path)` with no `sourceUrl` branch (`InProcessPipelineEngine.scala:155-186`).
`ContentSourceSupport` non-2xx handling and no redirect-follow — TRUE (:238-247), so the spec's
"redirect to an internal address is not followed" scenario is satisfiable.

### Verdict: REFUTE

Both change requests below are consequences of the round-2 revisions themselves, not re-litigation.

### Change Requests

1. **`CsvUrlFetch.fetch` returns a single undifferentiated `Left[String]`, but the design and the specs demand
   four DIFFERENT HTTP outcomes from it — and the design never says how the caller tells them apart.**
   Enumerate what the artifacts require of a create/refresh caller holding one `Left(String)`:
   - scheme rejection → `csv-url-ingestion` spec: "the response is **400**, the message names `http`…" (twice:
     the `http://` scenario and the `file/ftp/gopher` scenario);
   - over-limit body → Decision 7 / task 9.3 / spec: **413-class `ServiceError.PayloadTooLarge`**;
   - non-2xx upstream → spec: "the response is a **502-class** error carrying the upstream status";
   - HTML/XML body (Decision 8) → an unstated status (presumably 400).

   The only precedent in the file maps the whole channel uniformly: `createTextUrl`
   (`DataSourceService.scala:220-226`) and `refreshText`'s URL branch (`~:617-627`) both do
   `case Left(err) => ServiceError.BadGateway(err)`. An executor mirroring text — which Decision 5 and task
   4.1 tell it to do — will emit **502 for an `http://` scheme rejection and for an oversize body**, directly
   violating two spec scenarios and Decision 7's own 413 requirement. The only alternative the current
   signature leaves is string-matching the message to pick a status, which is fragile and which no artifact
   authorises.
   Required: specify the discriminated result. E.g. change the entry point to return
   `Future[Either[CsvUrlFetchError, Array[Byte]]]` with a sealed ADT in the same object
   (`InvalidScheme`, `Guard`/`Upstream`, `TooLarge`, `NotCsv`), each carrying its caller-ready message, plus
   an explicit table of ADT case → `ServiceError` (400 / 502 / 413 / 400) for the two HTTP paths and →
   `IllegalArgumentException` text for the run path. Update Decision 2's signature, Decision 7's failure-shape
   paragraph, task 3.1 and task 9.3 to match. Without this the executor must guess the status codes the specs
   assert, and the most likely guess is wrong.

2. **Decision 7's size limit is post-hoc, and the design's stated rationale for it — unattended heap safety on
   scheduled fires — is not what the placement delivers. Say so plainly.** `ContentSourceSupport.fetchUrl`
   does `response.entity.toStrict(30.seconds, fetchSizeLimitBytes)` with `fetchSizeLimitBytes = 104857600L`
   (`ContentSourceSupport.scala:62`, :238) and returns `entity.data.toArray` — i.e. up to 100 MiB is fully
   buffered **and then copied into a fresh `Array[Byte]`** (transiently ~2× on the JVM heap) BEFORE
   `CsvUrlFetch` can measure anything. A check inside `CsvUrlFetch.fetch` therefore *rejects* an oversize body;
   it does not *prevent the allocation*. Decision 7 argues from exactly that allocation ("on every unattended
   scheduled fire into the engine's heap … the scheduled case is the dangerous one because nobody is
   watching"), and Decision 2 forbids modifying `ContentSourceSupport`, so the memory exposure is unchanged by
   this design. It never states this.
   Required: (a) reword Decision 7 so the benefit claimed is the honest one — parity with the uploaded-CSV
   limit and refusal to *ingest/persist/parse* an oversize body — and state explicitly that up to
   `ContentSourceSupport`'s 100 MiB is still buffered per fetch on every path including unattended runs;
   (b) record the residual as a Risk/Trade-off or a Finding (a `maxBytes` parameter threaded into
   `fetchUrl`'s `toStrict` is the actual fix and is out of scope here under Decision 2), so it is a recorded
   decision rather than an unnoticed gap.

### Non-blocking notes

- `domain.engine` already depends on `services.sources` (import at
  `InProcessPipelineEngine.scala:6`); Decision 3's "rather than dragging an `ActorSystem` into the domain
  engine" is still the right reason for the seam, but the layering half of the justification is weaker than
  stated. No action needed.
- Decision 8 says "skip a BOM, then leading ASCII whitespace". A body of whitespace-then-BOM-then-`<` would
  slip through. Vanishingly unlikely (a BOM is by definition at offset 0) — mentioned only so the executor
  implements the stated order deliberately rather than accidentally.
- `tasks.md` orders its sections 1-7, 9, 10, 8 (Verification last but numbered 8). Harmless, mildly confusing;
  renumber if convenient.
- Round-2's note still holds: adding the `csv` arm to `createStaticRoute` changes the *message* (not the
  status) for an existing malformed JSON `{"type":"csv"}` POST that today falls into the
  `StaticDataSourceRequest` arm.
