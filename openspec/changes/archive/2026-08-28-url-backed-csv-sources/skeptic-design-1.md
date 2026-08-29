## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All paths relative to the worktree unless stated.

**Decision 4 — VERIFIED CORRECT.** `PipelineSchedulerService.fire` calls
`pipelineRunService.submit(...)` (`PipelineSchedulerService.scala:120`). `DataSourceService.refresh`
(`DataSourceService.scala:536`) is reached from exactly two call sites in `src/main`, both HTTP:
`DataSourcePreviewRoutes.scala:42` and `:44`. It is not on the scheduled path. The engine branch is
load-bearing as claimed: `InProcessPipelineEngine.scala:154` — `fileSystem.read(c.config.path)`
unconditionally.

**Finding 1 — VERIFIED CORRECT by enumeration.** `loadRowsWithStats` (`InProcessPipelineEngine.scala:140`):
`case t: TextSource` reads `t.config.path` (:163), `case p: PdfSource` reads `p.config.path` (:172),
`case i: ImageSource` reads `i.config.path` (:182) — none consults `sourceUrl`, which all three configs do
carry (`DataSource.scala:80, 103, 148`). The gap is real in three more places. Safe to report as fact.

**Question 3 (https-only without touching the shared guard) — VERIFIED WORKABLE.**
`ContentSourceSupport.resolveValidated` accepts `Some("http") | Some("https")`. A CSV-local pre-check on
`new URI(url).getScheme.toLowerCase` is strictly narrowing and requires no change to the shared guard.

**Decision 3 — WORKABLE, with one unaddressed hazard (CR 5).** `ApiRoutes` has
`(implicit system: ActorSystem[_])` (`ApiRoutes.scala:172`) and constructs `PipelineRunService`
positionally at `:288`, so trailing defaulted params are safe. Enumerated fixture call sites that would
omit them (9 total): `PipelineRunRoutesSpec.scala:218` and `:726`, `ResourceTaggingSpec.scala:130`,
`DataTypeDataSourceAclSpec.scala:133`, `PipelineRunServiceSpec.scala:97`, `BoundPanelRoutesSpec.scala:177`,
`PipelineAclSpec.scala:146`, `DataTypeRoutesSpec.scala:82`, `PipelineSchedulerServiceSpec.scala:100`. All
positional-prefix; appending defaults compiles. Engine construction sites: `PipelineRunService.scala:56`
plus 11 test sites — all use `(fileSystem)` or `(fileSystem, connector)`, so a trailing defaulted
`csvUrlFetch` is safe.

**Question 4 (no extension validation) — the CHOICE is right, the STATED JUSTIFICATION is false (CR 6).**
Not applying `validateExtension` is correct: `filenameFromUrl` on `.../export?format=csv` returns `export`,
extension `""`, which `validateExtension` would reject — exactly the target use case. But design Decision 6's
sentence "a non-CSV body fails schema inference with its own error" is FALSE against
`SchemaInferenceEngine.fromCsv:35-55`, which has no error path at all.

**Question 5 (SSRF gaps) — none found beyond the guard.** Pinned transport, 2xx-only, no redirect-follow,
100 MiB `toStrict` cap are all real in `ContentSourceSupport`. The residual exposure is size, not target
(CR 3).

### Verdict: REFUTE

### Change Requests

1. **The create-surface mechanism is unspecified, and "mutually exclusive with inline `content`" is not
   implementable at the backend as written.** Enumerated: `DataSourceRoutes` has two disjoint create paths —
   a JSON dispatch (`createStaticRoute`, branching on `type` for static/text/pdf/image, `:105-125`) and a
   multipart path (`:195-222`). CSV has **no JSON branch at all**, and there is **no `content` field anywhere
   on the backend CSV surface** — inline `content` is an MCP-side construct that `helioApi.ts:404-414`
   converts into a multipart `file` Blob. A request is either multipart or JSON; it can never carry both, so
   Decision 5 / task 4.1 / the `csv-url-ingestion` scenario "Supplying both sourceUrl and content is rejected
   with 400 naming both fields" cannot be satisfied at the route. Specify the actual mechanism: add a `csv`
   branch to `createStaticRoute` with a `CsvSourceUrlRequest` mirroring `TextSourceUrlRequest`
   (`DataSourceRoutes.scala:111`), and place the mutual-exclusion 400 at the MCP tool layer where both
   arguments genuinely coexist — or name a different mechanism. As written the executor must guess.

2. **The MCP transport switch is unspecified.** `createCsvDataSource` posts `multipart/form-data`
   (`helio-mcp/src/helioApi.ts:404-414`) and `content` is required (`write.ts:102`,
   `z.string().min(1)`). Task 7.1's "add `sourceUrl` to the input schema and forward it" is not
   implementable against that transport: with `sourceUrl` there is no file part to post and the call must
   become a JSON POST. Design must state that `content` becomes optional, that exactly one of
   `content`/`sourceUrl` is required, and which transport each takes.

3. **No size limit on any URL-backed CSV path.** Enumerated: `csvMaxBytes` exists only at the route layer
   (`DataSourceRoutes.scala:33` and `:210`), gating the multipart part. `DataSourceService.createCsv:149`
   and `refreshCsv:578` have no size check. By contrast text deliberately re-checks `textMaxBytes` inside
   `ingestText` (`:249`) and again in `refreshText` (`:622`) precisely because the URL path bypasses the
   route check. As designed, a URL-backed CSV would ingest up to `ContentSourceSupport`'s 100 MiB on create,
   on every manual refresh, and on **every scheduled fire** (unattended, into `loadCsvRowsFromBytes` in the
   engine's heap), while the byte-identical CSV by upload is capped at `csvMaxBytes`. Design and tasks are
   silent. Add an explicit decision on which limit applies at each of the three call sites, and a test.

4. **Task 4.2 and task 4.3 contradict each other; `filenameFromUrl` has no CSV consumer.**
   `createCsv` stores at the fixed `csv/${sourceId.value}.csv` (`DataSourceService.scala:167`), and CSV has
   no `filename` metadata field — `ContentSourceSupport.metadataFields` is a text/pdf/image concern only.
   Task 4.2 says store at "the usual `csv/<id>.csv` path"; task 4.3 says use `filenameFromUrl` for "a
   meaningful stored filename". Both cannot hold. Drop 4.3 (and the corresponding half of Decision 6), or
   state precisely where the derived filename is consumed.

5. **The null-`ActorSystem` seam hazard is unaddressed.** `PipelineRunService` builds its engine as an
   eagerly-initialised field (`:56`). Decision 3 says the service "gains `ActorSystem`/`resolveHost`/
   `isBlocked` with the same nullable/defaulted convention", but never says what the `csvUrlFetch` function
   must do when `system` is null — which it will be in all 9 fixtures enumerated above. State that the seam
   must close over the system lazily and return `Left("... not configured")` at call time rather than
   NPE-ing at construction, and add a task/test for it. Without this the entire test suite construction path
   is at risk.

6. **Decision 6 contains a false claim about code, which the design then relies on.** "Content is parsed as
   CSV regardless; a non-CSV body fails schema inference with its own error" is false:
   `SchemaInferenceEngine.fromCsv` (`:35-55`) has no failure path — it returns `InferredSchema(Seq.empty)`
   for empty input and otherwise treats the first line as headers, so an HTML error page returned with
   HTTP 200 (the single most likely failure mode for a public-dataset URL: an interstitial, a login page, a
   rate-limit notice) is silently accepted as a CSV source with a garbage one-column schema. The only other
   gate on `createCsv` is `DataSourceCsvSupport.decodeUtf8`, which HTML passes. Under standing requirement 4
   this is behaviour, not documentation: either correct the sentence and accept the behaviour explicitly, or
   add a minimal sanity gate (e.g. reject a `text/html` content type, or a header row that parses to a
   single column containing `<`). Decide it in design; do not leave it to the executor.

### Non-blocking notes

- Decision 1's absent-vs-null emphasis is well targeted; `TextSourceConfig` is the right idiom to copy.
- `refreshCsv` today does not overwrite the stored file (it only re-infers schema, `:578-594`). Task 5.1's
  "overwrite the snapshot" is a genuine behaviour addition for the URL case, not a mirror of today's path —
  worth calling out so the executor does not read it as pre-existing.
- Finding 2 (openspec CLI drift) is plausible but not independently verified here; it is inert either way.
