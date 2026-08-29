## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**CR1 (round 3) — discriminated error channel: genuinely addressed.**
Decision 2 now defines `sealed trait CsvUrlFetchError` (InvalidScheme/Upstream/TooLarge/NotCsv),
the signature returns `Future[Either[CsvUrlFetchError, Array[Byte]]]`, and a binding mapping table
(400/502/413/400) is stated with an explicit "do NOT copy createTextUrl/refreshText's uniform
BadGateway mapping". Tasks 3.0, 3.7a, 3.7b carry it into executable steps, including per-case
status assertions on both HTTP paths. The precedent it warns against is real: verified
`DataSourceService.scala:618-620` (`case Left(err) => ServiceError.BadGateway(err)` in refreshText's
URL branch). `ServiceError.PayloadTooLarge` exists (`ServiceError.scala:37`) and maps to
`StatusCodes.RequestEntityTooLarge` (`ServiceResponse.scala:85`), so the 413 row is reachable.

**Spec-status enumeration vs the mapping table** (every status the four deltas assert):
- csv-url-ingestion "non-2xx URL ... 502-class error carrying the upstream status" -> `Upstream`/502. Consistent.
  `ContentSourceSupport.fetchUrl` returns `Left("Upstream returned HTTP $code")` (line 239), so the
  status is carried in the message as required.
- "http:// rejected ... 400, message names `http`" -> `InvalidScheme`/400. Consistent; ordering (scheme
  check before `fetchUrl`) satisfies "no outbound request".
- "file://, ftp://, gopher:// ... 400" -> `InvalidScheme`/400. Consistent.
- "each blocked address class is rejected ... an error stating the host resolves to a disallowed
  address" -> no status asserted by the spec; `Upstream`/502 does not contradict it (see note 1).
- "redirect to an internal address is not followed" -> guard returns non-2xx -> `Upstream`/502; verified
  `fetchUrl` explicitly rejects 3xx (`ContentSourceSupport.scala:237-240`).
- size limit: "413-class error naming the limit" on create and refresh; "run fails with an error naming
  the data source and the limit (no status code asserted there)" -> `TooLarge`/413 plus Decision 7's
  run-path `IllegalArgumentException`. Consistent, and task 9.3 forbids claiming a 413 on the run path.
- non-CSV body: spec asserts an error and its message content, no status -> `NotCsv`/400. Consistent.
- mcp-data-source-tools and pipeline-run-execution assert no HTTP statuses.
No spec-asserted status is unmapped, and no table row contradicts a spec scenario.

**CR2 (round 3) — size-limit rationale: genuinely addressed and now honest.**
Decision 7 states plainly that the check rejects rather than prevents the allocation, that up to
100 MiB is buffered on every path first, and that the benefit is parity + refusal to ingest/persist/parse.
Verified against code: `fetchUrl` does `toStrict(30.seconds, fetchSizeLimitBytes)` with
`fetchSizeLimitBytes = 104857600L` hard-coded and private (`ContentSourceSupport.scala:60`, `:226`),
then `entity.data.toArray` — so Finding 3 ("not parameterisable") is accurate, and the Risk entry
matches. Task 9.3b forbids a memory-bounding claim in comments/test names.

**Code claims re-audited (round 3 found none false; I found none either).**
- `csvMaxBytes` route-layer only, `CSV_MAX_FILE_SIZE_BYTES` default `52428800L` (DataSourceRoutes.scala:32-33). True.
- text duplicates its own env read with its own default in both route and service
  (DataSourceRoutes.scala:41-42, DataSourceService.scala:69-70). True — Decision 7's "do not copy this" is grounded.
- `createStaticRoute` branches on `type` for text/pdf/image else static; no csv branch (DataSourceRoutes.scala:104-140). True.
- `TextSourceUrlConfigPayload(url)` / `TextSourceUrlRequest(name, type, config, tag)` exist and are the
  shape Decision 5 mirrors (DataSourceProtocol.scala:160-161). True.
- `case c: CsvSource` in `loadRowsWithStats` does an unconditional `fileSystem.read(c.config.path)`, and
  text/pdf/image do the same (InProcessPipelineEngine.scala:146-163) — Decision 4 and Finding 1 both hold.
- Engine's missing-`path` failure style is an `IllegalArgumentException` naming source name+id
  (InProcessPipelineEngine.scala:147-153) — Decision 7's run-path shape matches an existing precedent.
- `SchemaInferenceEngine.fromCsv` has no failure path (returns empty schema / treats line 1 as headers,
  lines 35-45) — Decision 8's premise holds.
- `grep -rn "sourceUrl" helio-mcp/src` returns 0 hits — Decision 9's round-2 correction is accurate.
- `ContentSourceSupport.defaultResolveHost` and `isBlockedAddress` are public and have exactly the
  signatures Decision 2's `fetch` defaults use (lines 71, 78, 203-207). The proposed helper compiles as written.
- Minor: two line refs are off by one (`ingestText:249`/`refreshText:622` are actually 250/623). Cosmetic.

**Implementability:** the create/refresh/run wiring, the JSON request shape (`{name, type:"csv",
config:{url}, tag?}`), the seam type and its lazy-null discipline, the size-limit single source of
truth, and the BOM/`<` gate are all specified concretely enough that an executor need not guess.
Worktree is clean (`git status`: only the untracked change dir) — no code has been pre-written.

### Verdict: CONFIRM

### Non-blocking notes

1. **`Upstream` conflates a guard rejection with a genuine upstream fault.** A blocked/loopback host
   or a non-https-resolvable host is a caller-input error, but maps to 502. No spec scenario asserts a
   status for that case and the message stays accurate ("host resolves to a disallowed address"), so
   this is not a defect — but 502 reads as transient to an agent caller and may invite a pointless retry.
   If it is cheap, splitting a `Blocked` case mapping to 400 would be better; not required.
2. Decision 2 says each error "carries a caller-ready message" but does not say explicitly that
   `Upstream` must preserve `fetchUrl`'s own `Left` string. The spec's "carrying the upstream status"
   depends on that; it is the obvious reading, worth being deliberate about.
3. Task sections run 1-7, 9, 10, 8 — verification is last in content but not in numbering.
4. Two off-by-one line references noted above.
