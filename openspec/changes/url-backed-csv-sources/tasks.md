## 1. Ground the implementation in the existing pattern

- [x] 1.1 Read `TextSourceConfig`/`refreshText` and the text create path end to end, and the `DataSourceRepository`
      encode/decode for text config. Confirm the exact absent-vs-null decoding idiom before writing any code.
- [x] 1.2 Enumerate every site that constructs or pattern-matches `CsvSourceConfig`/`CsvSource` (do not assume a
      count — `grep` for both across `backend/src/main` and `backend/src/test`). Adding a field breaks every
      positional constructor call; the list is the work.
- [x] 1.3 Confirm the create order used by text/pdf (validate → fetch → store → persist) so a failed fetch leaves no
      row and no file.

## 2. Model + persistence

- [x] 2.1 Add `sourceUrl: Option[String]` to `CsvSourceConfig`, defaulted so existing positional constructions keep
      compiling where that is correct, and update every site found in 1.2.
- [x] 2.2 Update `DataSourceRepository` CSV config encode/decode following the text idiom exactly.
- [x] 2.3 Test: a config JSON containing ONLY `path` (key absent, not null) decodes with `sourceUrl = None`.
- [x] 2.4 Test: round-trip a config with a `sourceUrl` through encode → decode.

## 3. `CsvUrlFetch` — the single shared ingestion helper (design Decision 2)

- [x] 3.0 Define `sealed trait CsvUrlFetchError` with `InvalidScheme` / `Upstream` / `TooLarge` / `NotCsv`, each
      carrying a caller-ready `message`. A bare `Left[String]` is NOT acceptable: the specs demand four different
      statuses from this one channel, and the text precedent the create path otherwise mirrors maps everything to
      `BadGateway` — which would emit 502 for a scheme rejection and for an oversize body.
- [x] 3.1 Add a new PUBLIC object `com.helio.services.sources.CsvUrlFetch` with
      `def fetch(url, maxBytes, resolveHost = ..., isBlocked = ...)(implicit system: ActorSystem[_]):
      Future[Either[CsvUrlFetchError, Array[Byte]]]`, performing in order: https-only parsed-scheme check (never
      `startsWith`), `ContentSourceSupport.fetchUrl`, the size check (task 9), the non-CSV-body gate (task 10).
      It must be public and callable from BOTH `DataSourceService` and `PipelineRunService` — a private helper
      cannot be, which is the drift Decision 3 exists to prevent. Do NOT add it to `DataSourceCsvSupport`
      (that file's scaladoc disclaims a Pekko dependency).
- [x] 3.2 Error wording names the offending scheme AND states https is required (standing requirement 4).
- [x] 3.3 Do NOT modify `ContentSourceSupport`.
- [x] 3.4 Tests, one case per rejection class, asserting the message CONTENT not merely a non-200:
      `http`, `file`, `ftp`, a schemeless string; loopback, `169.254.169.254`, RFC1918, IPv6 unique-local,
      any-local, multicast. Each its own case — one representative is not enough.
- [x] 3.5 Test: the `http` rejection happens with NO outbound request issued (assert via a resolver/fetch seam that
      records calls, not by timing).
- [x] 3.6 Test: a `text` source with an `http://` URL is still accepted — proves the shared guard was not tightened.
- [x] 3.7a Map the ADT to `ServiceError` on BOTH HTTP paths per design Decision 2's table: `InvalidScheme` -> 400
      `BadRequest`, `Upstream` -> 502 `BadGateway`, `TooLarge` -> 413 `PayloadTooLarge`, `NotCsv` -> 400
      `BadRequest`. Do NOT copy `createTextUrl`/`refreshText`'s uniform `BadGateway` mapping.
- [x] 3.7b Test the mapping case by case: assert the STATUS CODE for each of the four cases, on create and on
      refresh. Four cases x two paths; a single representative is not enough.
- [x] 3.7 All three call sites (create, refresh, engine) call `CsvUrlFetch.fetch` — none reimplements any of its four
      checks. A reviewer must be able to see one implementation, not three.

## 4. Create path (design Decision 5)

- [x] 4.1 Read `createTextUrl` and `TextSourceUrlRequest`/`TextSourceUrlConfigPayload` first; mirror them.
- [x] 4.2 Add `CsvSourceUrlConfigPayload(url: String)` and `CsvSourceUrlRequest(name, type, config, tag)` to
      `DataSourceProtocol`, plus their JSON formats.
- [x] 4.3 Add a `csv` branch to `createStaticRoute` dispatching to a new `DataSourceService.createCsvUrl`.
      Do NOT touch the existing multipart CSV path.
- [x] 4.4 Fetch via the 3.1 helper, enforce the size limit (task 9) and the non-CSV-body gate (task 10),
      then store bytes at the fixed `csv/<id>.csv` path and persist `sourceUrl`.
- [x] 4.5 Do NOT use `filenameFromUrl` and do NOT apply `validateExtension` (design Decision 6 — there is no
      consumer for a derived filename, and extensionless/query-driven CSV endpoints are the target use case).
- [x] 4.6 Test: URL-created source stores both `path` and `sourceUrl`; inferred schema matches the fetched header row.
- [x] 4.7 Test: a failing fetch leaves NO data source row and NO stored file (assert both, by querying for the row
      and checking the filesystem).

## 5. Manual refresh path

- [x] 5.1 `refreshCsv`: when `sourceUrl` is present, fetch via the 3.1 helper, overwrite the snapshot, re-infer the
      schema; when absent, keep today's file-read behaviour byte-for-byte including the existing
      `NoSuchFileException` message.
- [x] 5.2 Test: upstream content CHANGES → refresh reflects the new content (assert the new values, not that a
      method ran).
- [x] 5.3 Test: inline-created CSV refresh performs NO fetch.

## 6. Scheduled-run path (load-bearing — AC3)

- [x] 6.1 Add the `csvUrlFetch: String => Future[Either[String, Array[Byte]]]` seam to `InProcessPipelineEngine`
      with a "not configured" default (design Decision 3).
- [x] 6.2 `case c: CsvSource` re-fetches when `sourceUrl` is present; reads the stored file when absent.
- [x] 6.3 Thread the real fetch from `PipelineRunService`, adding `ActorSystem`/`resolveHost`/`isBlocked` with the
      nullable/defaulted convention already used there so existing fixtures still compile.
- [x] 6.4 A fetch failure fails the run naming the data source and the reason — not zero rows, not a silent snapshot
      fallback.
- [x] 6.5 **AC3 evidence:** drive TWO runs through the engine path with a seam whose bytes differ between them, and
      assert the second run's ROWS differ. Asserting `refreshCsv` was called is NOT acceptable evidence.
- [x] 6.6 Test: a snapshot-backed CSV run reads the file and performs no fetch.
- [x] 6.7 The seam must close over the `ActorSystem` LAZILY and return `Left(...not configured)` at CALL time when
      it is unavailable — never dereference at construction (the engine is an eagerly-initialised field and
      `system` is null in every fixture that omits it). Test: constructing `PipelineRunService` without a system
      does NOT throw, and a URL-backed CSV run under it fails with the "not configured" Left.

## 7. MCP surface (design Decision 9)

- [x] 7.1 `content` becomes OPTIONAL and `sourceUrl` is added; `content` -> today's multipart POST unchanged,
      `sourceUrl` -> a JSON POST of exactly `{name, type: "csv", config: {url}, tag?}` to `/api/data-sources`.
      That body is the contract. NOTE: there is NO existing URL-backed text/pdf/image MCP create to copy — the MCP
      has no such tool. For a JSON `this.http.post` example to that endpoint see `createDataSource` in
      `helio-mcp/src/helioApi.ts`.
- [x] 7.1b Exactly one of `content`/`sourceUrl` is required. Zero or both raises in the tool BEFORE any HTTP call,
      with a message naming both arguments and stating they are mutually exclusive. This is the mutual-exclusion
      site; the backend cannot enforce it (a request is either multipart or JSON, never both).
- [x] 7.1c Test both failure cases (neither / both) and both transport paths.
- [x] 7.2 Rewrite the tool description to state accurately: `content` and `sourceUrl` are the accepted, mutually
      exclusive inputs; `sourceUrl` must be https; only a URL-backed source can refresh on a schedule. It must NOT
      describe a caller-supplied filesystem `path`.
- [x] 7.3 Test the forwarding and assert the description's CONTENT (that it names both inputs and the https rule),
      not merely that a description string exists.

## 9. Size limit on every URL path (design Decision 7)

- [x] 9.1 Enforce the size limit inside `CsvUrlFetch.fetch`, so all three URL paths get it by construction. Leave
      the existing route-layer multipart check in place (it fails an oversized upload early).
- [x] 9.2 Define the value ONCE as `CsvUrlFetch.maxFileSizeBytes` reading `CSV_MAX_FILE_SIZE_BYTES` with default
      `52428800L`, and change the existing route check to read that same val. Do NOT create a second env read with
      its own literal default — a silently diverging default is a behaviour split no test here would catch.
- [x] 9.3 Failure shape by path: `TooLarge` maps to 413 `PayloadTooLarge` naming the limit on create and refresh
      (task 3.7a); the RUN path fails with an `IllegalArgumentException` naming the data source and the limit
      (413 is a route-layer mapping unreachable from `domain.engine`). Do not claim a 413 on the run path.
- [x] 9.3b The limit rejects an oversize body; it does NOT prevent the allocation (the shared guard buffers up to
      100 MiB before returning). Do not write a comment or test name claiming it bounds memory.
- [x] 9.4 Tests: over-limit rejected on create (413), on refresh (413), and on a run (run fails, message names the
      source and the limit). The run case matters most — it is unattended.
- [x] 9.5 Test: the route's multipart limit and `CsvUrlFetch.maxFileSizeBytes` are the same value.

## 10. Reject an obviously-non-CSV body (design Decision 8)

- [x] 10.1 Inside `CsvUrlFetch.fetch`, operating on the fetched BYTES: skip a leading UTF-8 BOM (`EF BB BF`) and any
      leading ASCII whitespace; if the next byte is `<`, reject with an error stating the URL returned HTML/XML
      rather than CSV, and naming the URL.
- [x] 10.2 Because it lives in the shared helper it applies to all three paths with identical semantics — which also
      sidesteps the fact that the three paths decode UTF-8 differently today (strict `decodeUtf8` on create, lossy
      `new String` on refresh and in the engine). Do not change those decodes.
- [x] 10.3 Tests: an HTML body served with HTTP 200 is rejected with that message on each of the three paths; a
      BOM-prefixed HTML body is ALSO rejected (the BOM is not whitespace — a naive check passes it through); a
      normal CSV body, and a BOM-prefixed normal CSV body, are unaffected. Assert the message CONTENT.

## 8. Verification

- [x] 8.1 Backend: `sbt test` from `backend/` — full suite green.
- [x] 8.2 Frontend gates only if frontend files changed; never report a typecheck from a worktree without
      `node_modules` linked.
- [x] 8.3 helio-mcp: build and run its tests.
- [x] 8.4 **Behavioural mutation evidence, not compile-error revert** (standing requirement 1). For each of: the
      https-only check, the address denylist reuse, the engine re-fetch branch, and the mutual-exclusion check —
      mutate the PRODUCTION logic so it is wrong but still compiles (e.g. accept `http` too; drop the `sourceUrl`
      branch in the engine so it reads the snapshot; raise the size limit; drop the `<` body gate), re-run, and
      record which tests fail. A test that still passes
      under mutation is a weak assertion and must be strengthened.
- [x] 8.5 Recapture mutation evidence if any test changed after it was taken; the evidence must match the FINAL
      committed tests.
- [x] 8.6 Write `files-modified.md` with ONE full backtick-quoted path per `^-` bullet (squash-branch.sh parses only
      the first per bullet).
