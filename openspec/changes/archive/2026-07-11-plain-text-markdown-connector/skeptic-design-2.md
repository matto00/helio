## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Finding #1 (multipart re-consumption) — fixed and technically sound.** Re-read
   `design.md`'s "Route dispatch" decision (now: single `createMultipartUploadRoute`,
   no `createCsvRoute`) and `tasks.md` 4.1. Cross-checked against the actual current
   `DataSourceRoutes.scala:79-110` `createCsvRoute` — its existing `Sink.seq` collection
   over `formData.parts.mapAsync(1)(p => p.toStrict(...))` into a `partsMap` is exactly
   what the design proposes to extend with an optional `type` part, branching via a plain
   Scala conditional with no second `entity(as[Multipart.FormData])` anywhere. This
   eliminates the double-unmarshal risk entirely — credible fix, no remaining multipart
   re-consumption risk.

2. **Finding #2 (`DataSourceService.update` closure point) — fixed.** Re-read
   `design.md`'s Context (now explicitly names `DataSourceService.update` lines 148-153
   as a fourth closure point) and `tasks.md` task 1.5 (`case t: TextSource => t.copy(...)`).
   Confirmed against current `DataSourceService.scala:148-153` (still the un-patched
   4-case match, as expected pre-implementation) that this is exactly the match in
   question and the planned fix slots in correctly alongside the existing
   `CsvSource|RestSource|SqlSource|StaticSource` cases.

3. **Finding #3 (413 mechanism) — fixed and consistent with the existing pattern.**
   Read `services/ServiceError.scala` (current 8-variant closed set, explicitly
   documented as intentionally closed) and `api/routes/ServiceResponse.scala`'s
   `completeError` (exhaustive match, one arm per variant, `StatusCodes.X` +
   `ErrorResponse(m)`). The new `ServiceError.PayloadTooLarge(message: String)` +
   `case ServiceError.PayloadTooLarge(m) => complete(StatusCodes.RequestEntityTooLarge, ...)`
   (design.md Decisions, tasks.md 1.6) follows this exact one-case-class-per-variant /
   one-match-arm-per-variant shape — no structural inconsistency. tasks.md 3.2/3.5 wire
   `ingestText`'s size checks to return it for both upload and URL-fetch, correctly closing
   the gap round 1 found (route layer never sees fetched bytes for the URL case).

4. **DataSource-subtype closure-point sweep (own pass, beyond the 3 required fixes).**
   `grep -rln "CsvSource" backend/src/main/scala/com/helio` → 7 files. For each, checked
   whether the match is exhaustive (MatchError risk) or has a catch-all:
   - `InProcessPipelineEngine.loadRows` (line 47-62): exhaustive-by-design, has
     `case other => Future.failed(...)` — task 5.1 adds the `TextSource` case; not a hidden
     closure point, already planned.
   - `DataSourceConfigCodec.scala`: per-type functions (`decodeCsv`/`decodeSql`/etc.), not a
     shared exhaustive match — task 1.3 adds `decodeText`/`encodeText`; no other match to miss.
   - `DataSourceProtocol.scala` — **found two additional exhaustive/near-exhaustive matches**:
     `fromDomain` (lines 138-170, exhaustive, **no catch-all**, MatchError risk) and the
     `dataSourceResponseFormat.write` match (lines 296-301, exhaustive, no catch-all). Both
     are already explicitly covered by `tasks.md` 3.1 ("extend the `DataSourceResponse`
     discriminated-union format (write/read) for `type = "text"`") and by `proposal.md`'s
     Impact list, which already names `DataSourceProtocol.scala`. Not a missed closure point —
     confirmed correctly planned, just not itemized line-by-line the way `DataSourceService.update`
     was (acceptable; task 3.1's wording unambiguously implies touching `fromDomain` +
     both `write`/`read` arms of the format).
   - `DataSourceRepository.scala`: `rowToDomain`/`domainToRow`/`update` — all three named in
     task 1.4, matches round-1 finding and design.md.
   - `SparkJobSubmitter.scala`: has `case other =>` catch-alls at both match sites (already
     verified in round 1); a `TextSource` reaching Spark fails gracefully, not via MatchError.
   - `DataSourceService.scala` `refresh` (182-201) and `preview` (265-277): both have a
     `case Some(_) => Left(ServiceError.BadRequest(...))` catch-all — **not** MatchError risks;
     `update` (149-152, Finding #2) is the only one of this file's DataSource-subtype matches
     without a catch-all, and that's the one already fixed.
   No missed closure point found beyond what round 1 already surfaced and what's now planned.

### New issue found (round 2, not previously raised)

**Design's JSON-body dispatch for URL-based text creation (task 4.2) reintroduces the same
double-unmarshal-of-a-live-entity risk that Finding #1 eliminated for multipart — for a
different, newly-added route pair.** `design.md`'s "Route dispatch" decision states: "URL-based
text creation is a separate JSON body... added to the existing JSON `concat` alongside Static's
— spray-json's per-shape `entity(as[X])` unmarshalling naturally disambiguates by required
fields, matching the existing Static/CSV dispatch pattern (no re-consumption risk there since
JSON bodies are strictified, not streamed)."

This claim is not accurate as a blanket justification, and the "existing Static/CSV dispatch
pattern" it invokes is not actually analogous:

- The *current* `createStaticRoute` (`entity(as[StaticDataSourceRequest])`, JSON) and
  `createCsvRoute` (`entity(as[Multipart.FormData])`) are disambiguated by **Content-Type**
  (`application/json` vs `multipart/form-data`) — Pekko HTTP's `Unmarshaller.forContentTypes`
  rejects on Content-Type mismatch *before ever touching `dataBytes`*, so no entity draining
  happens on the "wrong" route. That's why it's safe regardless of Strict/streamed semantics.
  It is **not** evidence that two *JSON* `entity(as[X])` directives can safely share one request.
- The other existing precedent I checked, `DataSourcePreviewRoutes.scala:38-43` (Static-refresh
  JSON body with a bodyless CSV-refresh fallback), is safe for a different reason: the fallback
  route never calls `entity(as[...])` at all, so there's nothing to re-materialize.
- I confirmed from `pekko-http-core` sources (`HttpEntity.scala:401,409-411` and
  `HttpRequestParser.scala:222-239`) that whether an incoming request entity is
  `HttpEntity.Strict` (re-readable — `dataBytes` returns a fresh `Source.single(data)` every
  call) or `HttpEntity.Default`/`Chunked` (single-materialization — `dataBytes` returns the
  *same* connection-backed `Source` instance every call) is decided by
  `contentLength <= input.size - bodyStart`, i.e. whether the **entire body happened to
  arrive in the same initial read as the headers**. This is a real-world-timing-dependent
  condition, not a property of "being JSON." `PredefinedFromEntityUnmarshallers.scala:23-26`
  confirms the non-Strict branch calls `entity.dataBytes.runFold(...)`, draining the
  connection-backed stream once.
- `task 4.2`'s new text-URL route and the existing `createStaticRoute` **both** declare
  `application/json`, so the Content-Type short-circuit that makes the existing Static/CSV
  split safe does not apply between them — both would attempt full unmarshalling of the same
  body if tried in sequence. For a request whose body doesn't arrive fully within the first
  read (larger bodies, network/proxy fragmentation, HTTP/1.1 slow-start, etc.), the first
  route's failed unmarshal attempt (e.g. `createStaticRoute` failing on a `type=text` body
  missing `columns`/`rows`) would drain the entity, and the second route's
  `entity(as[TextSourceUrlRequest])` attempt on the same already-drained `Default`/`Chunked`
  entity would itself fail to unmarshal (Akka/Pekko Streams substream sources throw
  `IllegalStateException` on re-materialization) — surfacing as a spurious 400 for a
  legitimately-shaped URL-ingestion request, not the intended 201.
- This codebase already has the safe, established pattern for exactly this situation:
  `SourceRoutes.scala:31-53` (`entity(as[JsValue])` — single unmarshal into a generic JSON
  value — then branch on the `type` discriminator field via `json.convertTo[X]`, a pure
  in-memory conversion requiring no further entity materialization). `SourcePreviewRoutes.scala`
  uses the same shape. Design's own fix for Finding #1 (collect once, branch internally) is
  this exact principle applied to multipart; task 4.2 should apply it symmetrically to the new
  JSON route instead of adding a second sibling `entity(as[X])` directive.

**Required**: rewrite task 4.2 (and the corresponding "Route dispatch" paragraph in design.md)
to fold URL-based text creation into a single `entity(as[JsValue])`-based JSON create route
(alongside/replacing `createStaticRoute`), inspecting the `type` discriminator once and then
`convertTo[StaticDataSourceRequest]` or `convertTo[TextSourceUrlRequest]` accordingly — mirroring
`SourceRoutes.scala`'s existing pattern — rather than two sibling `entity(as[X])` directives on
the same Content-Type. Remove or correct the "spray-json... matching the existing Static/CSV
dispatch pattern" justification, since that pattern's safety comes from a Content-Type mismatch
that does not exist between Static and Text-URL bodies.

### Verdict: REFUTE

### Change Requests

1. Rework `design.md`'s "Route dispatch" decision and `tasks.md` task 4.2: replace the sibling
   `entity(as[TextSourceUrlRequest])` JSON route with a single `entity(as[JsValue])` route that
   branches on the `type` discriminator (as `SourceRoutes.scala:31-53` already does elsewhere in
   this codebase) before converting to `StaticDataSourceRequest` or a new
   `TextSourceUrlRequest`/equivalent payload type. Correct the design's justification text, which
   currently misattributes safety to "JSON bodies are strictified" — that is a
   best-effort/timing-dependent property (confirmed via `pekko-http-core`'s
   `HttpMessageParser.scala:222-239`/`HttpEntity.scala:401,409-411`), not a guarantee, and the
   existing Static/CSV split it cites is actually safe for an unrelated reason (Content-Type
   mismatch short-circuit), which doesn't hold between two `application/json` routes.

### Non-blocking notes

- Findings #1, #2, #3 from round 1 are all correctly and soundly resolved in the current
  `design.md`/`tasks.md` — no further changes needed on those three.
- The closure-point sweep found no additional missed cases beyond what's already planned;
  `DataSourceProtocol.scala`'s `fromDomain`/`write` exhaustive matches are covered by task 3.1's
  wording, just not itemized as explicitly as `DataSourceService.update` was — worth a one-line
  mention in design.md's Context for symmetry, but not blocking given task 3.1 already implies it.
