## Context

`DataSource` is a closed sealed trait (`CsvSource | RestSource | SqlSource | StaticSource`,
`backend/src/main/scala/com/helio/domain/DataSource.scala`) with a `kind` discriminator persisted
in `data_sources.source_type` under a Postgres CHECK constraint (`V13__add_sql_source_type.sql`).
Adding a source kind touches **four** closed `match`es, not two: `DataSourceRepository.rowToDomain`
(line 24), `domainToRow` (line 47), and `update` (line 121, which independently re-derives the config
JSON) — plus `DataSourceService.update` (lines 148-153), which has its *own* separate exhaustive match
building the renamed copy for `PATCH /api/data-sources/:id`. All four need a `TextSource` case; missing
`DataSourceService.update`'s would throw an uncaught `MatchError` (500) on rename. Also touches:
`DataSourceConfigCodec` (JSON codec for the stored config), `DataSourceProtocol` (wire response ADT +
formats), `DataSourceRoutes` (HTTP dispatch), and a new Flyway migration.

Critically, creating a `DataSource` + auto-inferred `DataType` (as CSV/Static do in
`DataSourceService`) is not sufficient to make it pipeline-bindable. Per the pipeline-only-bindings
invariant (source → pipeline → type → panel), row *values* only materialize when a pipeline runs.
`InProcessPipelineEngine.loadRows` is a closed `match` over `StaticSource | CsvSource` today;
`PipelineRunService.runPipeline`/`previewStep` explicitly reject `RestSource | SqlSource` as
Spark-only ("Only static and csv are currently supported"). A new source kind is invisible to
pipelines unless it gets a `loadRows` case.

HEL-217 added `StringBodyType`/`BinaryRefType` to `DataFieldType` (content field types) but no
connector consumes them yet. This change is the first consumer and, per the ticket, must leave a
clean seam for HEL-214 (PDF, needs text extraction → `StringBodyType`) and HEL-216 (image, needs
binary storage → `BinaryRefType`).

## Goals / Non-Goals

**Goals:**
- `.txt`/`.md` file upload and URL-based ingestion, producing a single-row `DataType`:
  `{content: StringBodyType, filename: StringType, sizeBytes: IntegerType}`.
- Pipeline-bindable via the in-process engine (no Spark dependency).
- A documented, reusable seam for HEL-214/HEL-216: the metadata-field shape and the
  upload-vs-URL ingestion plumbing, not the content-extraction logic itself.

**Non-Goals:**
- Spark-path row-loading (text content is one row; in-process is sufficient, same as CSV/Static).
- Markdown parsing/rendering — `.md` content is stored as-is, same as `.txt`.
- Generalizing PDF/image extraction now — those connectors add their own `loadRows` case and
  content-extraction logic in their own tickets.

## Decisions

**New `TextSource` kind, not a generalized "file" kind.** Mirrors the existing one-kind-per-connector
ADT shape (`CsvSource`, `RestSource`, ...) instead of introducing a cross-cutting "file connector"
abstraction now. HEL-214/HEL-216 each add their own kind (`"pdf"`, `"image"`) the same way — the
reuse is in the *helper functions* below, not in a shared ADT case. Config:
`TextSourceConfig(path: String, sourceUrl: Option[String])`. `path` is always populated (uploaded
bytes or fetched-and-stored URL content — this is why refresh/preview stay uniform with CSV).
`sourceUrl` is `Some(url)` for URL-ingested sources (refresh re-fetches) and `None` for uploads
(refresh re-reads the stored file, identical to CSV's `refreshCsv`).

**Reusable seam #1 — metadata-field builder.** New `ContentSourceSupport.metadataFields(contentFieldType:
DataFieldType, filename: String, sizeBytes: Long): Vector[DataField]` (new file,
`backend/src/main/scala/com/helio/services/ContentSourceSupport.scala`) returns the
`{content, filename, sizeBytes}` triple. `DataSourceService.createTextUpload`/`createTextUrl` call it
with `StringBodyType`; HEL-214/HEL-216 call it with `BinaryRefType` for their content field. This is
the single place that fixes the metadata field names/types so every content connector's `DataType`
shape is consistent.

**Reusable seam #2 — URL fetch-and-store, with an SSRF guard.** New `ContentSourceSupport.fetchUrl(url:
String, resolveHost: ..., isBlocked: ...)(implicit system): Future[Either[String, Array[Byte]]]` — a
raw-bytes HTTP GET (reusing the pooled-connection settings pattern from `RestApiConnector.doFetch`, but
returning bytes, not parsed JSON, and without auth — out of scope for this ticket). Since this endpoint
accepts a caller-supplied URL and prod runs on GCP Cloud Run, `fetchUrl` MUST validate scheme
(`http`/`https` only) and resolve + reject loopback/link-local (incl. `169.254.169.254`)/private/
unique-local/multicast addresses before issuing the request, re-validate redirect targets the same way,
and never echo the upstream response body in error messages. HEL-214/HEL-216 reuse this guarded helper
instead of writing their own unguarded HTTP client code for URL ingestion.

*Cycle-3 addendum — DNS-rebinding TOCTOU closed by pinning the connection.* A cold-skeptic final-gate
review (`skeptic-final-1.md`) REFUTEd the cycle-2 guard above: resolving a hostname to decide
permitted-vs-blocked and then re-issuing the HTTP request against the *hostname string* left Pekko
HTTP free to re-resolve that same hostname independently when it opened the TCP connection — a
rebinding-DNS attacker (first answer public/permitted, second answer moments later 169.254.169.254 or
RFC1918) could pass validation and still land the real connection on a disallowed address. The fix:
`fetchUrl`'s single `resolveHost` call now returns the validated `InetAddress`, which is threaded into
a `ClientTransport.withCustomResolver` (`ConnectionPoolSettings.withTransport`) that forces the actual
TCP connection to that exact, already-resolved address — Pekko's own connection-layer DNS lookup is
bypassed entirely (its default `ClientTransport.TCP` deliberately builds an *unresolved*
`InetSocketAddress` so a fresh lookup happens per connection; passing an already-resolved one skips
that). The `Host` header (and TLS SNI for `https`) are unaffected — they're derived from the request's
`Uri`/`ConnectionContext`, not from the transport, so they still carry the original hostname. This also
required a shape change to the test-injection seam: the pre-cycle-3 test pattern of a `resolveHost`
that *lied* about a test hostname's resolved address (mapping "localhost" to a fake public IP purely to
pass the address-only guard) stopped working once the real connection is pinned to whatever
`resolveHost` returns — a lie there now breaks the real HTTP fetch instead of just faking past
validation. `fetchUrl`/`validateUrl` gained a second, hostname-keyed `isBlocked: (String, InetAddress)
=> Boolean` parameter (default: the real, host-agnostic `isBlockedAddress`) so tests admit a single
known-safe hostname (e.g. `"localhost"`) past the denylist while `resolveHost` stays truthful (real DNS
for real test-server hostnames); a dedicated regression test in `ContentSourceSupportSpec` proves the
pin holds by fetching a URL whose host does not actually resolve via real DNS at all — the request can
only succeed if the connection is pinned to the resolver's answer, never re-resolving independently
(probe-confirmed: reverting the `.withTransport(...)` call makes this exact test fail with
`UnknownHostException`, then re-applying it makes the test pass). HEL-214/HEL-216 inherit this pinning
for free since they reuse the same `fetchUrl`.

**Reusable seam #3 — pipeline row-loading is per-connector, not shared.** `InProcessPipelineEngine.loadRows`
gets a `case t: TextSource => fileSystem.read(t.config.path).map(bytes => Seq(Map("content" ->
new String(bytes, UTF_8), "filename" -> filenameFromPath, "sizeBytes" -> bytes.length.toLong)))`.
This is a single-row loader, deliberately not shared with CSV's multi-row loader. HEL-214/HEL-216 add
their own case (PDF: extract text before building the row; image: reference stored bytes via
`BinaryRef`, not inline). Documenting this as *not* shared avoids a premature abstraction over three
data points.

**Filename storage.** `TextSourceConfig` does not carry a separate `filename` field — the filename is
derived from the stored `path`'s basename (`text/<sourceId>.<ext>`, mirroring CSV's `csv/<id>.csv`
convention) for uploads, and from the URL's last path segment (falling back to `downloaded.<ext>`) for
URL ingestion. Storing it once in `path` avoids two sources of truth for the same string.

**Route dispatch: one multipart route that branches internally, not two sibling routes.** A live HTTP
request's multipart entity is a connection-backed stream that can be materialized only **once**.
`createCsvRoute`'s existing `formData.parts.mapAsync(1)(...).runWith(Sink.seq)` already drains it in
full to inspect any part. Two *sibling* `entity(as[Multipart.FormData])` directives in the same
`concat` chain (one rejecting, one picking up) is unsafe — Pekko HTTP gives no guarantee the entity is
re-unmarshallable after a prior route has consumed it, and there is no existing precedent in this
codebase for that pattern (the JSON-body Static/CSV fallback works only because spray-json's
`toStrict` strictifies a small body up front; multipart streaming exists specifically to avoid that).
Fix: collapse into a **single** multipart route (`createMultipartUploadRoute`, replacing
`createCsvRoute`) that runs the existing `Sink.seq` collection once, reads an optional `type` part
(default `"csv"` — backward compatible with today's CSV-only uploaders), and then branches with a
plain Scala `if`/`match` on the collected parts map to either the existing CSV logic or the new
text-upload logic (`type = "text"`), calling `DataSourceService.createCsv` or `createTextUpload`
respectively. No second `entity(as[Multipart.FormData])` unmarshalling ever happens.

**JSON create dispatch: one `entity(as[JsValue])` route with discriminator-based `convertTo`, mirroring
`SourceRoutes.scala`.** `createStaticRoute` and a sibling `entity(as[TextSourceUrlRequest])` route
would both declare `Content-Type: application/json`, so the Content-Type short-circuit that makes the
Static/CSV split safe (Pekko rejects a `Multipart.FormData` route on JSON *before* touching
`dataBytes`) does not apply between two JSON routes: whether the request entity is safely re-readable
depends on arrival timing, not on being JSON, so a failed unmarshal on the first JSON route can leave
the second unable to re-materialize the same entity, surfacing a spurious 400. Fix: replace
`createStaticRoute`'s `entity(as[StaticDataSourceRequest])` with `entity(as[JsValue])`, inspect the
`type` field once, and `convertTo[StaticDataSourceRequest]` or `convertTo[TextSourceUrlRequest]` (new
payload: `{name, type, config: {url}}`) accordingly — the exact pattern `SourceRoutes.scala:31-53`
already uses for REST/SQL dispatch.

**Extension validation is service-layer, not route-layer**, consistent with CSV's UTF-8 check: `.txt`/
`.md` extension checking (upload filename or URL path) lives in `DataSourceService`, returning
`ServiceError.BadRequest` for other extensions. **Reuse `DataSourceCsvSupport.decodeUtf8` as-is** — it's
already content-agnostic (`Array[Byte] => Option[String]`); a CSV-neutral rename is a nice-to-have, not
required (avoids an unrelated rename under `CONTRIBUTING.md`'s no-unrelated-refactors rule).

**New `ServiceError.PayloadTooLarge` variant for the 413 path.** `ServiceError` is a closed 8-variant
set (`BadRequest, Unauthorized, NotFound, Forbidden, Conflict, UnprocessableEntity, BadGateway,
InternalError`) with no 413-mapped case; `ServiceResponse.completeError` is an exhaustive match over
exactly those 8. CSV's existing oversized-upload check avoids this entirely by living in the *route*
layer (`complete(StatusCodes.RequestEntityTooLarge, ...)` directly, no `ServiceError` involved) — but
text's URL-fetch size check cannot live in the route layer, because the route never sees the fetched
bytes (only the URL), so the fetch-and-measure step is necessarily in `ContentSourceSupport.fetchUrl`/
`DataSourceService.ingestText`. Fix: add `ServiceError.PayloadTooLarge(message: String)`, add a
`case ServiceError.PayloadTooLarge(m) => complete(StatusCodes.RequestEntityTooLarge, ErrorResponse(m))`
to `ServiceResponse.completeError`, and have `ingestText`'s size check (both the upload-bytes-length
check and the URL-fetch-byte-count check) return it. The upload path still gets an early
`Content-Length`-style rejection at the route layer where practical (mirrors CSV), but the service-layer
check is the one guaranteed path for both upload and URL cases and is what the spec's two 413 scenarios
require.

## Risks / Trade-offs

- [Risk] Non-UTF-8 `.txt`/`.md` files are rejected outright (same limitation as CSV) → Mitigation:
  matches existing CSV UX; error message states the encoding requirement.
- [Risk] URL ingestion has no size cap before download completes, unlike the upload path's
  `CSV_MAX_FILE_SIZE_BYTES`-style check → Mitigation: enforce the same max-bytes constant
  (`TEXT_MAX_FILE_SIZE_BYTES`, default 10 MB — smaller than CSV's 50 MB since text-file rows are
  meant to be modest) against `Content-Length` when present and against the fetched byte count
  regardless, via the new `ServiceError.PayloadTooLarge` path (see Decisions).
- [Risk] `loadRows`' per-connector-kind duplication (seam #3) could drift if a future connector copies
  the wrong template → Mitigation: design explicitly names this as intentional, not an oversight.
- [Risk] Collapsing `createCsvRoute`/`createStaticRoute` into branching, discriminator-based routes
  touches two stable, existing code paths (CSV upload, Static creation) → Mitigation: both branches
  for the pre-existing cases (`type` absent/`"csv"`; `type = "static"`) preserve existing logic
  unchanged; task 7.2 requires explicit regression tests for both.

## Planner Notes

- Self-approved: reusing `DataSourceCsvSupport.decodeUtf8` unchanged, and keeping `TextSource` under the
  `/api/data-sources` route family (not a new top-level prefix) since it's upload-first like CSV, not
  config-first like REST/SQL.
- Self-approved: 10 MB default max size for text uploads/URL fetches (configurable via
  `TEXT_MAX_FILE_SIZE_BYTES`, mirroring `CSV_MAX_FILE_SIZE_BYTES`'s env-var pattern).
