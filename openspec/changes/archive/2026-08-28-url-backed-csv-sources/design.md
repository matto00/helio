## Context

CSV is the only content connector that cannot be created from a URL. `text`/`pdf`/`image` (HEL-214/215/216) each
carry `sourceUrl: Option[String]` and re-fetch it on refresh; `CsvSourceConfig` is `(path: String)` only, and
`refreshCsv` always reads the stored file. This change extends that established pattern to `csv` — and fixes the
scheduled-run path, which the established pattern does NOT cover (see Decision 4 and Finding 1).

## Premise corrections carried in from validation

These overrode the ticket's original wording and were approved by the coordinator before planning:

1. **"Reuse the REST connector's egress policy" was false.** `RestApiConnectorDriver` has no egress policy at all:
   `buildResolvedRequest` builds `Uri(joinUrl(baseUrl, endpoint))` and `buildEphemeralRequest` builds
   `Uri(config.url)`, both handed to `Http().singleRequest` with only connecting/idle timeouts — no scheme check, no
   address denylist, no pinned transport. `ConnectorEntityService` validates `baseUrl.trim.isEmpty` and nothing else.
   That hole is real but OUT OF SCOPE here; it is filed as HEL-879.
2. **The real guard is `ContentSourceSupport`** (`validateUrl`/`fetchUrl`/`isBlockedAddress`/`pinnedTransport`),
   already used by text/pdf/image. Reuse it; do not fork it. Its connection pinning to the already-validated
   `InetAddress` is what makes it genuinely rather than superficially safe.
3. **No caller-supplied filesystem path.** Coordinator override of the ticket's original AC. An MCP caller cannot see
   the server's uploads root, so the capability has no legitimate use from the API surface, and supporting it would
   add a path-traversal validation surface for nothing. The Linear ticket has been corrected to match.

## Goals / Non-Goals

- **Goals:** URL-backed CSV create; re-fetch on manual refresh AND on scheduled runs; https-only; reuse of the
  existing address guard; inline `content` and existing snapshot sources completely unaffected; honest MCP surface.
- **Non-Goals:** the REST egress hole (HEL-879); changing the shared guard's accepted schemes; fixing the identical
  scheduled-path staleness for text/pdf/image (Finding 1 — reported, not silently fixed); auth on the fetched URL;
  a row cap for CSV; any Flyway migration.

## Decisions

### Decision 1: `CsvSourceConfig` gains `sourceUrl: Option[String]`, mirroring `TextSourceConfig`

`final case class CsvSourceConfig(path: String, sourceUrl: Option[String])`. Source config is stored as JSON, so no
Flyway migration is needed — exactly as text/pdf/image added the same field.

**Absent-vs-null hazard (this repo has been bitten repeatedly):** spray-json omits `Option = None` on the wire, and a
pre-existing CSV config contains no `sourceUrl` key at all. The decoder MUST tolerate the key being absent, not merely
null. The executor MUST read how `TextSourceConfig` is decoded in `DataSourceRepository` and follow that exact
idiom, and MUST include a test that decodes a config JSON containing only `path`.

### Decision 2: one PUBLIC shared helper object, `CsvUrlFetch`, is the single ingestion path

Corrected from round 2. Round 1 said "one shared **private** helper" at the CSV call site, which contradicted
Decision 3: `PipelineRunService` holds no `DataSourceService` reference and cannot call a private method on one, so a
private helper would have guaranteed exactly the two-copies drift Decision 3 exists to prevent.

Introduce a new public object `com.helio.services.sources.CsvUrlFetch` with a single entry point:

```scala
sealed trait CsvUrlFetchError { def message: String }
object CsvUrlFetchError {
  final case class InvalidScheme(message: String) extends CsvUrlFetchError  // https-only pre-check
  final case class Upstream(message: String)      extends CsvUrlFetchError  // guard reject, non-2xx, transport
  final case class TooLarge(message: String)      extends CsvUrlFetchError  // over the CSV size limit
  final case class NotCsv(message: String)        extends CsvUrlFetchError  // HTML/XML body
}

def fetch(
    url: String,
    maxBytes: Long,
    resolveHost: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    isBlocked: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)
)(implicit system: ActorSystem[_]): Future[Either[CsvUrlFetchError, Array[Byte]]]
```

It performs, in order: (1) https-only scheme check on the parsed URI; (2) `ContentSourceSupport.fetchUrl`;
(3) the size check (Decision 7); (4) the non-CSV-body gate (Decision 8). Each failure carries a caller-ready
`message`.

**The error type is discriminated, not a bare `String` (corrected from round 3).** The specs demand four
DIFFERENT outcomes from this one channel — 400 for a rejected scheme, 502-class for a non-2xx upstream, 413 for
an over-limit body, 400 for an HTML body. The only precedent in `DataSourceService` maps the whole channel
uniformly to `BadGateway` (`createTextUrl` and `refreshText`'s URL branch both do
`case Left(err) => ServiceError.BadGateway(err)`), so an executor told to "mirror text" would emit 502 for an
`http://` scheme rejection and for an oversize body, violating two spec scenarios and Decision 7. A bare
`String` would leave only message-substring matching to recover the status, which nothing authorises.

**Mapping table — binding for the two HTTP paths (create, manual refresh):**

| `CsvUrlFetchError` | `ServiceError`      | Status |
| ------------------ | ------------------- | ------ |
| `InvalidScheme`    | `BadRequest`        | 400    |
| `Upstream`         | `BadGateway`        | 502    |
| `TooLarge`         | `PayloadTooLarge`   | 413    |
| `NotCsv`           | `BadRequest`        | 400    |

**`Upstream` must preserve `ContentSourceSupport.fetchUrl`'s own `Left` string verbatim** — the spec scenario
"a 502-class error carrying the upstream status" depends on it, as does the blocked-address message
("URL host '<host>' resolves to a disallowed address"). Do not replace it with a generic summary.

**Deliberate deferral (round 4, non-blocking note 1):** a guard rejection (blocked/loopback host) is really a
caller-input error, and 502 reads as transient to an agent caller that may then retry pointlessly. Splitting a
`Blocked` case mapping to 400 would be better, but distinguishing it means calling
`ContentSourceSupport.validateUrl` before `fetchUrl`, which resolves DNS a SECOND time on every fetch including
every scheduled run. The message is accurate either way, and no spec asserts a status for that case, so this is
deferred rather than paid for now. Recorded here so it is a decision, not an oversight.

On the RUN path there is no HTTP response: every case fails the run with an `IllegalArgumentException` whose
text is the data source name plus the error's own `message` (Decision 7).

A NEW object rather than an addition to `DataSourceCsvSupport`: that file's own scaladoc disclaims a Pekko
dependency, and this helper needs `ActorSystem`/`resolveHost`/`isBlocked`.

Because all four checks live here, all three call sites (create, refresh, engine) get byte-identical semantics by
construction rather than by three careful copies.

It rejects any scheme other than `https` **before** any network call. `ContentSourceSupport` is NOT modified —
tightening it would silently change behaviour for text/pdf/image callers who never asked for it.

The check must be by parsed URI scheme (`new URI(url).getScheme`, lower-cased), never a `startsWith("https://")`
string test, which would accept `https:/evil` style inputs inconsistently and reject valid mixed-case schemes.

**Error wording is behaviour, not documentation** (standing requirement 4). The rejection must name the offending
scheme and state that https is required. A bare "invalid URL" would leave a caller guessing, and an agent caller would
plausibly retry the same URL.

### Decision 3: The fetch is injected into the engine as a function seam, not an `ActorSystem` dependency

`InProcessPipelineEngine` lives in `domain.engine`, takes `(fileSystem, connector)` and has no `ActorSystem`.
`ContentSourceSupport.fetchUrl` needs one. Rather than dragging an `ActorSystem` into the domain engine, add a
constructor parameter:

`csvUrlFetch: String => Future[Either[String, Array[Byte]]]`

defaulting to a function returning `Left("URL-backed CSV fetch is not configured")`. `PipelineRunService` supplies the
real one. This mirrors the engine's existing nullable-default wiring for `connector` and `RestApiConnectorDriver`'s
`fetchOverride` test seam, and it makes the scheduled-run scenario testable with no real network.

`PipelineRunService` does not currently have an `ActorSystem`/`resolveHost`/`isBlocked`. It gains them with the same
nullable/defaulted-parameter convention already used there for `binaryRefRepo`, `alertEvaluationService`,
`connector` and `auditService`, so existing fixtures that omit them keep compiling.

**Null-system hazard (corrected from round 1, which was silent on it).** `PipelineRunService` builds its
engine as an EAGERLY-initialised field, and `system` will be null in every fixture that omits it (9
enumerated call sites). The seam must therefore close over the system LAZILY and return
`Left("URL-backed CSV fetch is not configured")` at CALL time when it is unavailable — never dereference it
at construction time, or the whole test-suite construction path NPEs. This needs its own test.

**`csvUrlFetch` must be a thin closure over `CsvUrlFetch.fetch` (Decision 2), not a second implementation.** Both
`DataSourceService` and `PipelineRunService` call that same public function; neither reimplements any of its four
checks. Two copies of the https check would drift — precisely the "second, weaker policy" the ticket warned against,
just relocated.

### Decision 4: The engine branch is load-bearing; the manual refresh path alone does not satisfy AC3

Traced call path: `PipelineSchedulerService` → `PipelineRunService.executeRun` → `InProcessPipelineEngine
.loadRowsWithStats`, whose `case c: CsvSource` does `fileSystem.read(c.config.path)` unconditionally.
`DataSourceService.refresh` is never on this path. A change confined to `refreshCsv` would leave every scheduled run
serving the original snapshot forever while every test of `refreshCsv` passed — the exact shape of defect this epic
keeps producing.

**Verification requirement:** AC3 is proven by executing a run through the engine with a fetch seam whose returned
bytes CHANGE between the first and second run, asserting the second run's rows differ. Asserting that `refreshCsv`
was called is explicitly NOT acceptable evidence.

### Decision 5: The create surface is a new JSON `csv` branch; mutual exclusion lives at the MCP layer

Corrected from round 1, which said "`sourceUrl` and inline `content` are mutually exclusive; supplying both
is a 400 naming both fields". That is not implementable at the backend as written. Enumerated:
`DataSourceRoutes` has two DISJOINT create paths — a JSON dispatch (`createStaticRoute`, branching on
`type` for static/text/pdf/image) and a multipart path. CSV has NO JSON branch, and there is NO `content`
field anywhere on the backend CSV surface: inline `content` is an MCP-side construct that
`helio-mcp/src/helioApi.ts` turns into a multipart `file` Blob. A single HTTP request is either multipart
or JSON and can never carry both, so the backend has no state in which both are present.

Mechanism, mirroring text exactly:
- Add `CsvSourceUrlConfigPayload(url: String)` and `CsvSourceUrlRequest(name, type, config, tag)` to
  `DataSourceProtocol`, matching `TextSourceUrlRequest`'s shape.
- Add a `csv` branch to `createStaticRoute` dispatching to a new
  `DataSourceService.createCsvUrl(name, url, user, tag)`, mirroring `createTextUrl`.
- The existing multipart CSV path is untouched.

**Mutual exclusion is enforced at the MCP tool layer**, which is the only place both arguments genuinely
coexist: `create_csv_data_source` receiving both `content` and `sourceUrl` fails with an error naming both
and stating they are mutually exclusive, before any HTTP call. Receiving neither fails the same way.

**No partial state on failure:** validate and fetch BEFORE persisting, so a failed fetch leaves no data
source row and no stored file. The executor must confirm that ordering in `createTextUrl` rather than
assuming it.

### Decision 6: No extension validation, and NO derived filename

`validateExtension` is NOT applied to CSV URLs. Verified: `filenameFromUrl("https://x/export?format=csv")`
returns `export`, whose extension is `""`, which `validateExtension` rejects — that is exactly the
public-dataset shape this ticket exists to support.

`filenameFromUrl` is ALSO not used. Corrected from round 1: `createCsv` stores at the fixed
`csv/${sourceId.value}.csv` (`DataSourceService.scala:167`) and CSV has no `filename` metadata field —
`ContentSourceSupport.metadataFields` is a text/pdf/image concern only. There is no consumer for a derived
filename, so introducing one would be dead code. URL-backed CSV uses the same fixed path as every other CSV.

### Decision 7: The CSV size limit applies to all three URL paths, not just the route

Corrected from round 1, which was silent on this. `csvMaxBytes` (`DataSourceRoutes.scala:33`) is a
ROUTE-layer check on the multipart part only; `DataSourceService.createCsv` and `refreshCsv` have no size
check at all. Without action, a URL-backed CSV would be bounded only by `ContentSourceSupport`'s 100 MiB
`toStrict` cap — on create, on every manual refresh, and on every unattended scheduled fire into the
engine's heap — while the byte-identical CSV by upload is capped at `csvMaxBytes`. That asymmetry is not
defensible, and the scheduled case is the dangerous one because nobody is watching.

The limit therefore lives inside `CsvUrlFetch.fetch` (Decision 2) and so applies to all three URL call sites by
construction, echoing text's re-checks (`ingestText:249`, `refreshText:622`) which exist precisely because the URL
path bypasses the route check. The existing route-layer multipart check stays where it is so an oversized upload
still fails early.

**Where the limit value comes from (corrected from round 2, which said only "must be readable from the service").**
The pattern text uses is duplication, not sharing: `DataSourceRoutes.scala:33-34` and `DataSourceService.scala:69-70`
each read their env var with their own literal default, so the two can silently diverge. Do not copy that. Define the
value ONCE as `CsvUrlFetch.maxFileSizeBytes`, reading `CSV_MAX_FILE_SIZE_BYTES` with default `52428800L` (the route's
current default — it must not change), and have the existing route check read that same val instead of its own.

**Failure shape differs by path, and that is deliberate (corrected from round 2).** On the two HTTP paths the
`TooLarge` case maps to `ServiceError.PayloadTooLarge` (413) naming the limit, per Decision 2's mapping table. The
run path has no HTTP response: `PayloadTooLarge` -> 413 is a route-layer mapping unreachable from `domain.engine`, so
the engine fails the run with an `IllegalArgumentException` naming the data source and the limit, matching the
engine's existing missing-`path` failure style (`InProcessPipelineEngine.scala:147-153`). A 413 must not be claimed
for the run path.

**What this limit does and does not buy (corrected from round 3 — round 2's rationale was not honest).**
`ContentSourceSupport.fetchUrl` calls `toStrict(30.seconds, 104857600L)` and then `entity.data.toArray`, so up to
100 MiB is fully buffered and then copied into a fresh array — transiently ~2x on the heap — BEFORE `CsvUrlFetch` can
measure anything. This check therefore REJECTS an oversize body; it does not PREVENT the allocation. Round 2 argued
for it from unattended scheduled-fire heap safety, which is not what the placement delivers, and Decision 2 forbids
modifying the shared guard, so the memory exposure is unchanged by this design.

The honest benefit is: parity with the uploaded-CSV limit, and refusal to ingest, persist, or parse an oversize
body — a URL-backed CSV must not be able to store or run something an upload of the same bytes would reject. The
residual is recorded under Risks below.

### Decision 8: Reject an obviously-non-CSV body

Corrected from round 1, which claimed "a non-CSV body fails schema inference with its own error". That was
FALSE: `SchemaInferenceEngine.fromCsv` has no failure path — it returns an empty schema for empty input and
otherwise treats line 1 as headers. `DataSourceCsvSupport.decodeUtf8` is the only other gate, and HTML
passes it. So an HTML interstitial, login page, or rate-limit notice returned with HTTP 200 — the single
most likely failure mode for a public-dataset URL — would silently become a CSV source with a garbage
one-column schema, and would then refresh into that garbage on a schedule forever.

Gate: applied to the fetched BYTES inside `CsvUrlFetch.fetch` (Decision 2), skipping a leading UTF-8 BOM
(`EF BB BF`) and any leading ASCII whitespace; if the next byte is `<`, reject with an error stating the URL returned
HTML/XML rather than CSV, and naming the URL. Deliberately narrow — it catches the real failure mode (`<!DOCTYPE`,
`<html`, `<?xml`) with no false positives against real CSV, since a CSV whose very first character is `<` is not a
thing worth supporting.

**The BOM skip is required, not incidental (corrected from round 2).** `Character.isWhitespace('\uFEFF')` is `false`,
so a BOM'd HTML body's first non-whitespace character is `U+FEFF`, not `<`, and a naive check would pass through
exactly the case this gate exists to catch. Nothing in the backend strips a BOM today.

**Applying it to bytes in one place also resolves a decode inconsistency**: the three CSV paths decode differently
today — `createCsv` via `DataSourceCsvSupport.decodeUtf8` (strict, `REPORT` on malformed), `refreshCsv` via
`new String(bytes, UTF_8)` (lossy), and the engine via `new String(bytes, UTF_8)` inside `loadCsvRowsFromBytes`.
Gating on bytes before any of those decodes gives all three identical behaviour without touching their decodes.

Content-Type would be the more precise signal, but `ContentSourceSupport.fetchUrl` returns only
`Array[Byte]` and does not expose response headers. Obtaining it would mean changing the shared guard, which
Decision 2 forbids. The body-shape check is the honest option available; this trade is recorded rather than
hidden.

### Decision 9: The MCP tool switches transport by argument

Corrected from round 1, which said only "add `sourceUrl` to the input schema and forward it" — not
implementable against the real transport. Today `createCsvDataSource` posts `multipart/form-data` and
`content` is required (`z.string().min(1)`). With a `sourceUrl` there is no file part to post.

- `content` becomes OPTIONAL in the tool's input schema; `sourceUrl` is added as optional.
- Exactly one of the two is required; zero or both is an error raised in the tool before any HTTP call
  (this is Decision 5's mutual-exclusion site).
- `content` present -> today's `multipart/form-data` POST, byte-for-byte unchanged.
- `sourceUrl` present -> a JSON POST of exactly `{name, type: "csv", config: {url}, tag?}` to the same
  `/api/data-sources` endpoint, hitting the new JSON branch from Decision 5. That body IS the contract; it is
  stated here rather than delegated to a reference.

**Corrected from round 2:** round 1 told the executor to "mirror how the MCP already creates URL-backed
text/pdf/image sources". No such code exists — `grep -rn "sourceUrl" helio-mcp/src` returns zero hits, and the MCP
registers no text/pdf/image source tool at all (its create tools are `create_data_source`,
`create_csv_data_source`, `create_rest_data_source`, `create_sql_data_source`). That instruction was itself a false
claim about code — the same class of error as round 1's CR6, which is sobering. For a real in-repo example of a JSON
`this.http.post` to `/api/data-sources`, see `createDataSource` in `helio-mcp/src/helioApi.ts`.

## Findings to report (do not silently fix)

**Finding 1 — text/pdf/image share this scheduled-path gap.** Enumerated, not assumed: in
`InProcessPipelineEngine.loadRowsWithStats`, `case t: TextSource`, `case p: PdfSource` and `case i: ImageSource` each
do `fileSystem.read(<config>.path)` with no `sourceUrl` branch, exactly like CSV. So a URL-backed text/PDF/image
source also serves stale snapshot content on a scheduled run; only an explicit manual refresh updates it. This is the
same defect in three more places. It is OUT OF SCOPE here per the Non-Goals; report it for a follow-up ticket.

**Finding 3 — the shared guard's 100 MiB buffer is not parameterisable.** `ContentSourceSupport.fetchUrl` hard-codes
`fetchSizeLimitBytes` in its `toStrict` call, so no caller can ask for a smaller ceiling; every caller (text, PDF,
image, and now CSV) buffers up to 100 MiB per fetch regardless of its own much smaller business limit. Threading an
optional `maxBytes` into `fetchUrl` would let each connector bound its own allocation. Out of scope here (Decision 2
forbids modifying the shared guard in this ticket); worth a follow-up.

**Finding 2 — `openspec` CLI version drift** (orchestrator-observed, independent of the code change). The workflow's documented CLI surface is v1.2.0; the installed binary is
1.10.0, where `openspec validate --change <name>` no longer exists (`--changes` validates all). The working form is
`openspec validate <name> --type change`. Worth a follow-up so the workflow prose matches the installed tool.

## Risks / Trade-offs

- **A fetch on every scheduled run** makes runs depend on upstream availability and latency. Mitigated by the guard's
  existing 10s connect / 30s idle timeouts and 100 MiB cap. A failing fetch fails the run loudly rather than silently
  serving stale rows, which is the correct trade for a feature whose entire purpose is freshness.
- **Repeated fetching is not cached or conditional** (no ETag/If-Modified-Since). Acceptable for now; noted as a
  future optimisation, not a correctness issue.
- **Up to 100 MiB is still buffered per fetch, on every path including unattended scheduled runs.** The size limit
  (Decision 7) rejects after the fact; it does not bound the allocation, because the shared guard's `toStrict` cap is
  what governs buffering and Decision 2 forbids changing it. The real fix is threading a `maxBytes` down into
  `fetchUrl`'s `toStrict` call, which would change behaviour for text/pdf/image and is therefore out of scope here.
  Recorded as Finding 3 rather than silently accepted.
- **The stored snapshot becomes a cache rather than the source of truth** for URL-backed sources. Kept deliberately:
  it preserves preview/refresh behaviour and gives a last-known-good body.

## Migration Plan

None required. `sourceUrl` is optional and absent in every existing row; decoding is absent-tolerant (Decision 1).
Existing CSV sources continue to read their snapshot on both refresh and run paths with no behavioural change.

## Open Questions

None outstanding — the three that existed (egress policy source, https-only scope, local-path acceptance) were
escalated before planning and resolved by the coordinator; they are recorded as Premise corrections above.
