## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review. Every claim below is derived from the files/code named, not from round 1's narrative or the
executor's account.

### Round-1 change requests — status

**CR1 (create surface) — ADDRESSED.** Decision 5 now names the mechanism. Verified reachable:
`DataSourceRoutes.scala:78` is `post { concat(createStaticRoute, createMultipartUploadRoute) }`;
`createStaticRoute` (`:104-137`) is a single `entity(as[JsValue])` that reads the `type` discriminator and
branches Text/Pdf/Image/else. A JSON `{"type":"csv"}` body reaches `createStaticRoute` FIRST (it is first in
the `concat`, and a JSON entity cannot unmarshal as `Multipart.FormData`), and today lands in the `else`
`StaticDataSourceRequest` arm. Adding a `csv` arm before that `else` intercepts it cleanly. Nothing else
gates it: there is no `DataSourceKind` validation on this path (`DataSourceKind`, `DataSource.scala:167-175`,
is a bag of string constants, not a validating enum), and the multipart CSV branch
(`DataSourceRoutes.scala:206-221`) is only reachable from a materialised multipart entity. The shape
mirrors reality: `TextSourceUrlRequest(name, type, config, tag = None)` +
`TextSourceUrlConfigPayload(url)`, `jsonFormat4`/`jsonFormat1` (`DataSourceProtocol.scala:160-161, 410-411`).
Moving mutual exclusion to MCP is correct — no backend state holds both.

**CR2 (MCP transport) — PARTLY ADDRESSED; a new false code claim was introduced. See CR 1 below.**
The transport switch itself is now specified (Decision 9), and the premise is verified true:
`createCsvDataSource` (`helio-mcp/src/helioApi.ts:404-414`) builds a `FormData` and calls
`postMultipart`; `content: z.string().min(1)` is required (`write.ts:102`).

**CR3 (size limit) — ADDRESSED in principle (Decision 7), with two unresolved specifics. See CR 3.**
Premise verified: `csvMaxBytes` exists only at `DataSourceRoutes.scala:33-34`;
`DataSourceService.createCsv:149` and `refreshCsv:578` have no size check; text does re-check
`textMaxBytes` at `:249` and `:622` from its own private val at `:69-70`.

**CR4 (`filenameFromUrl`) — ADDRESSED.** Decision 6 drops it; task 4.5 states it as a prohibition. Verified
there is genuinely no consumer: `createCsv` stores at `s"csv/${sourceId.value}.csv"`
(`DataSourceService.scala:167`) and `CsvSourceConfig` carries no filename.

**CR5 (null `ActorSystem`) — ADDRESSED.** Decision 3's lazy-closure requirement and task 6.7 are correct and
necessary: `PipelineRunService.scala:56` is still `private val engine = new InProcessPipelineEngine(fileSystem, connector)`,
an eagerly-initialised field.

**CR6 (false `SchemaInferenceEngine` claim) — ADDRESSED.** Decision 8 retracts the claim and adds a gate.
The retraction is accurate. But the gate has a defect — see CR 4.

### New problems found

### Verdict: REFUTE

### Change Requests

1. **Decision 9 and task 7.1 instruct the executor to copy code that does not exist — the same
   false-claim-about-code class as round-1 CR6, reintroduced.** Decision 9: "This mirrors how the MCP already
   creates URL-backed text/pdf/image sources; the executor must read that existing call and follow it rather
   than inventing a request shape." Task 7.1 repeats it as the first instruction. Enumerated against
   `helio-mcp/src`: `grep -rn "sourceUrl" helio-mcp/src` returns **zero** hits, and the complete set of
   source-creating methods in `helioApi.ts` is `createDataSource` (static, JSON POST `/api/data-sources`),
   `createCsvDataSource` (multipart), `createRestDataSource` and `createSqlDataSource` (JSON POST
   `/api/sources`). There is **no text, pdf or image data-source tool in the MCP at all** — the registered
   create tools in `write.ts` are `create_data_source`, `create_csv_data_source`, `create_rest_data_source`,
   `create_sql_data_source`. The executor cannot follow this instruction, and following it literally (going
   looking for a URL-backed text create) wastes a cycle or produces an invented shape anyway. Required:
   delete the "mirrors how the MCP already creates URL-backed text/pdf/image" sentence from Decision 9 and
   task 7.1, state the JSON body explicitly as the contract (`{name, type: "csv", config: {url}, tag?}`
   posted to `/api/data-sources`), and — if a reference is wanted — point at `helioApi.ts:381-394`
   (`createDataSource`), which is the real in-repo example of a JSON `this.http.post` to that endpoint.

2. **Decision 2 and Decision 3 contradict each other on where the shared fetch helper lives, and Decision 3's
   requirement is not satisfiable as written.** Decision 2 / task 3.1 specify "one shared **private** helper"
   at the CSV call site (i.e. inside `DataSourceService`). Decision 3 then requires that "the helper from
   Decision 2 must be the **single implementation** used by both the service refresh path and the value passed
   here", where "here" is `PipelineRunService`'s `csvUrlFetch` seam. `PipelineRunService`
   (`PipelineRunService.scala:29-52`) holds no `DataSourceService` reference and cannot call a private method
   on one; a private helper therefore guarantees the exact two-copies drift Decision 3 says it is preventing.
   Required: name the host and visibility of the single implementation (e.g. a public method on an object
   such as `DataSourceCsvSupport`, noting that unlike everything currently in that file it would need
   `ActorSystem`/`resolveHost`/`isBlocked` and thus a Pekko dependency the file's own scaladoc currently
   disclaims), and its signature, so both `DataSourceService` and `PipelineRunService` demonstrably call the
   same function. Then make task 3.1 say that instead of "private".

3. **Decision 7 leaves the run-path failure shape unspecified, and the spec asserts a status code on a path
   that has no HTTP response.** Two specifics:
   (a) `csv-url-ingestion` scenario "An over-limit body is rejected on every URL path" requires a "413-class
   error naming the limit" and then says "this holds independently on create, on manual refresh, and **during
   a pipeline run**". A pipeline run produces no HTTP status: the engine seam's type is
   `String => Future[Either[String, Array[Byte]]]` and `loadRowsWithStats` fails the run with an
   `IllegalArgumentException` (`InProcessPipelineEngine.scala:147-153` is the existing pattern), while
   `ServiceError.PayloadTooLarge` → 413 is a route-layer mapping (`ServiceResponse.scala:85`) unreachable from
   `domain.engine`. Task 9.3 says "over-limit rejected ... on a run" without saying what "rejected" means
   there. State the run-path failure shape explicitly (run fails, message names the data source and the
   limit) and reword the scenario so the 413 claim is scoped to the two HTTP paths.
   (b) Decision 7 says only "`csvMaxBytes` must be readable from the service" without saying how. The pattern
   it cites is duplication, not sharing: `DataSourceRoutes.scala:33-34` and `DataSourceService.scala:69-70`
   each independently read their env var with their own literal default. State that the service gets its own
   private val reading `CSV_MAX_FILE_SIZE_BYTES` with the **same** default (`52428800L`) as the route — a
   default that silently diverges between the two sites is a behaviour split that no test in tasks 9.x would
   catch.

4. **Decision 8's `<` gate does not fire on a UTF-8 BOM'd body, and "after decoding" names three different
   decodes.** `Character.isWhitespace('﻿')` is `false`, so for an HTML/XML body served with a UTF-8 BOM
   the first non-whitespace character is `U+FEFF`, not `<`, and the gate passes it through — precisely the
   "HTML interstitial served with HTTP 200" case Decision 8 exists to catch. Nothing in the backend strips a
   BOM today (`grep -rn "FEFF\|BOM" backend/src/main` → no hits). Separately, task 10.2's "same three sites"
   decode differently: `createCsv` uses `DataSourceCsvSupport.decodeUtf8` (strict, `REPORT` on malformed,
   `DataSourceCsvSupport.scala:13-21`), `refreshCsv` uses `new String(bytes, UTF_8)`
   (`DataSourceService.scala:580`, lossy, never fails), and the engine uses `new String(bytes, UTF_8)` inside
   `loadCsvRowsFromBytes` (`InProcessPipelineEngine.scala:310`). Required: state that the gate skips a leading
   BOM as well as whitespace, and specify which decode each of the three sites performs before applying it
   (or, cleaner, apply the gate to the fetched **bytes** in the single shared helper of CR 2, where all three
   paths get it once with identical semantics).

### Non-blocking notes

- Decision 5's "no partial state on failure" is verified achievable: `createTextUrl`
  (`DataSourceService.scala:220-226`) fetches before `ingestText`, and `ingestText` validates/size-checks
  before `fileSystem.write` + `dataSourceRepo.insert`. Task 4.4's ordering matches.
- Adding the `csv` arm changes the error message (not the status) for an existing malformed JSON
  `{"type":"csv"}` POST, which today falls into the `StaticDataSourceRequest` arm and 400s on a missing
  `columns` field. Harmless, but the executor should not be surprised if an existing route spec asserts that
  message.
- Task 2.1 says add `sourceUrl` "defaulted so existing positional constructions keep compiling". Note that
  the production construction at `DataSourceService.scala:167` is `CsvSourceConfig(filePath)` positional —
  a default keeps it compiling silently, which is fine here but means task 1.2's enumeration is the only
  thing standing between the executor and a missed site.
- Finding 1 re-verified as still true (`InProcessPipelineEngine.scala:155-186`: text/pdf/image each
  `fileSystem.read(<config>.path)` with no `sourceUrl` branch).
