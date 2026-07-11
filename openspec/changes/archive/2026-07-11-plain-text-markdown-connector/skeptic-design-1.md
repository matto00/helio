## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **DataSource ADT closure points.** Read `backend/src/main/scala/com/helio/domain/DataSource.scala` —
   confirmed the sealed trait has exactly 4 subtypes (`CsvSource | RestSource | SqlSource | StaticSource`)
   and `DataSourceKind.All` is the parse/unparse discriminator set, matching design.md's Context claim.
   Read `DataSourceRepository.scala` — confirmed `rowToDomain` (line 24), `domainToRow` (line 47), and
   `update` (line 121, which independently re-derives `configJson` via its own match) are three closed
   matches over the 4 subtypes, matching design.md and tasks.md 1.4.

2. **Pipeline-only-bindings invariant.** Read `InProcessPipelineEngine.loadRows` (line 47) — confirmed a
   closed dispatch: `StaticSource`, `CsvSource`, then `case other => Future.failed(...)`. Read
   `PipelineRunService.runPipeline`/`previewStep` (lines 86-98, 116-129) — confirmed both explicitly
   reject `RestSource | SqlSource` and otherwise proceed to `executeRun`/preview, which calls
   `loadRows`. A `TextSource` would fall into `loadRows`'s `case other` failure branch unless task 5.1
   adds a case — design's claim is accurate and the plan (task 5.1) addresses it.

3. **V13 migration / CHECK constraint reference.** `ls backend/src/main/resources/db/migration` +
   `grep data_sources_source_type_check` confirms `V13__add_sql_source_type.sql` exists and is the
   migration that drops/recreates the constraint. Design's reference is accurate.

4. **Reusable seams — plausibility check.** Read `RestApiConnector.doFetch` (confirms the
   pooled-connection-settings pattern `ContentSourceSupport.fetchUrl` is meant to reuse exists and is a
   reasonable template) and `FileSystem` trait (`read`/`delete`/`write` signatures exist as assumed).
   Read `DataSourceCsvSupport.decodeUtf8` — confirmed it is already content-agnostic
   (`Array[Byte] => Option[String]`), so reusing it as-is (rather than renaming) is sound. Read
   `DataFieldType` in `domain/model.scala` — confirmed `StringBodyType`/`BinaryRefType`/`StringType`/
   `IntegerType` exist with the exact wire strings (`string-body`, `binary-ref`, `string`, `integer`)
   the spec assumes.

5. **DataSourceService precedent for create/refresh/delete.** Read `DataSourceService.scala` in full —
   `createCsv`, `refresh`/`refreshCsv`, `delete`, and `upsertSourceDataType` confirm the create → write
   file → insert source → insert/upsert linked `DataType` pattern the design's `ingestText`/
   `createTextUpload`/`createTextUrl` plan intends to mirror.

### Issues found (ground-truthed, not present in design/tasks)

**A. Route-dispatch decision has an unaddressed multipart re-consumption risk.**
`DataSourceRoutes.createCsvRoute` (lines 79-110) currently drains the *entire* multipart body via
`formData.parts.mapAsync(1)(p => p.toStrict(...)).runWith(Sink.seq)` before it can know what any part
contains. The design's fix (task 4.1) requires this same route to inspect an optional `type` part and,
if it isn't `"csv"`, `reject` so `createTextUploadRoute` (task 4.2) — a **second**,
sibling `entity(as[Multipart.FormData])` directive in the same `concat` chain — can pick up the request.
For a real (non-test-harness) incoming HTTP request, the request entity's `dataBytes` is a live,
connection-backed stream that is materializable **once**; the CSV route's `Sink.seq` run already drains
it in order to read the `type` part. A second `entity(as[Multipart.FormData])` unmarshalling attempt on
the same, already-drained request entity is not the same situation as the existing JSON-body
disambiguation pattern in this codebase (`DataSourcePreviewRoutes`'s `entity(as[StaticDataPayload])`
fallback works because spray-json's unmarshaller strictifies a *small* JSON body up front via
`toStrict`, and a `MalformedRequestContentRejection` on a still-untouched request lets the next route
re-attempt cleanly) — multipart streaming exists specifically to *avoid* buffering the whole body, so
there is no equivalent "the entity is still fully available" guarantee here. I found no existing
precedent anywhere in the route tree (`grep -rn "reject" backend/.../routes` for multipart-adjacent
fallthrough came up empty) for two sibling routes each independently unmarshalling
`Multipart.FormData` from the same request. This is exactly the seam HEL-214/HEL-216 are meant to reuse,
so getting it wrong here compounds. Design.md does not mention or test this risk at all.
**Required**: before implementation, either (a) restructure to a *single* multipart route that reads the
`type` part once and then branches internally (plain Scala conditional) to CSV-handling vs.
text-handling logic — avoiding any cross-route re-unmarshalling of the same entity — or (b) if keeping
two routes, the design must state how/why re-unmarshalling the already-drained entity is safe in
Pekko HTTP 1.1.0 (with a concrete citation/test), not merely assert it as "rejects to the next route."

**B. `DataSourceService.update`'s exhaustive match is not in the design's or tasks' list of
closure points.** `DataSourceService.scala` lines 148-153 has its own closed match over all 4
`DataSource` subtypes (independent of `DataSourceRepository`'s matches) to build the renamed copy for
`PATCH /api/data-sources/:id`:
```scala
val updated = source match {
  case c: CsvSource    => c.copy(name = newName, updatedAt = now)
  case r: RestSource   => r.copy(name = newName, updatedAt = now)
  case s: SqlSource    => s.copy(name = newName, updatedAt = now)
  case s: StaticSource => s.copy(name = newName, updatedAt = now)
}
```
There is no `case t: TextSource` planned anywhere (design.md's Context section names only
`DataSourceRepository`'s "both closed matches" as touch points; tasks.md's task 1.4 also only names
`DataSourceRepository`). `build.sbt` has no `scalacOptions`/`-Xfatal-warnings`, so this would compile
with an unexhaustive-match *warning*, not fail the build — but at runtime, `PATCH
/api/data-sources/:id` (rename) on a text source throws an uncaught `scala.MatchError`, surfacing as an
unhandled 500 instead of the same rename behavior every other source type gets. This is a basic CRUD
path, not a documented non-goal. **Required**: add a task (and update design.md's closure-point list)
to add a `TextSource` case to this match.

**C. The plan has no mechanism to produce the spec-mandated 413 response.** `spec.md` requires
"Oversized upload is rejected... 413" and "Oversized URL fetch is rejected... 413; no DataSource is
created." Design's Decisions section states extension/size/UTF-8 validation for uploads and URL
fetches lives in the **service** layer (`ingestText`, called by `createTextUpload`/`createTextUrl`,
returning `ServiceError`) — this is necessarily true for the URL-fetch case, since the route layer
never sees the fetched bytes, only the URL. However, `ServiceError` (`services/ServiceError.scala`) is
explicitly documented as "intentionally a small, closed set" with variants `BadRequest, Unauthorized,
NotFound, Forbidden, Conflict, UnprocessableEntity, BadGateway, InternalError` — **none maps to 413**.
`ServiceResponse.completeError` (`api/routes/ServiceResponse.scala`) is an exhaustive match over exactly
those 8 cases with no fallback. The existing CSV size check bypasses this problem entirely by living in
the *route* (`DataSourceRoutes.scala` line 95-99, `complete(StatusCodes.RequestEntityTooLarge, ...)`
directly, no `ServiceError` involved) — precisely the layer the design says it is *not* using for text.
Neither design.md nor tasks.md mentions adding a `ServiceError` variant (e.g. `PayloadTooLarge`) or
otherwise wiring a 413 path from the service layer. As planned, an oversized URL fetch would currently
have no way to surface as 413 through the existing `ServiceResponse` bridge. **Required**: add a
`ServiceError.PayloadTooLarge` (or equivalent) variant, wire it into `ServiceResponse.completeError` as
413, and reference it explicitly in tasks.md's 3.2/3.5.

### Verdict: REFUTE

### Change Requests

1. Resolve the multipart-route dispatch risk (Issue A) before implementation — either collapse
   `createCsvRoute`/`createTextUploadRoute` into one route that branches internally on the `type` part
   without a second `entity(as[Multipart.FormData])` unmarshalling attempt on the same request, or
   explicitly justify (with a concrete Pekko-HTTP mechanism/citation) why rejecting from an
   already-drained multipart route safely falls through to a sibling multipart route. Update design.md's
   "Route dispatch" decision accordingly.

2. Add `case t: TextSource => t.copy(name = newName, updatedAt = now)` (or equivalent) to
   `DataSourceService.update`'s match at lines 148-153, and add this closure point explicitly to
   design.md's Context/Decisions and to tasks.md (currently only `DataSourceRepository`'s matches are
   named).

3. Add a `ServiceError` variant that maps to HTTP 413 (e.g. `PayloadTooLarge`), wire it into
   `ServiceResponse.completeError`, and have `ingestText`'s size check return it — otherwise the spec's
   two 413 scenarios (oversized upload, oversized URL fetch) have no implementable path given the
   design's stated service-layer validation placement. Reference this explicitly in tasks.md (3.2/3.5).

### Non-blocking notes

- Frontend design detail (task 6.x) is thin relative to backend detail, but consistent with the
  ticket's non-goal framing ("mirrors CsvForm.tsx/RestApiForm.tsx structure") — acceptable for a
  design gate; flag if `TextSourceForm.tsx`'s upload/URL sub-mode UX diverges from those siblings during
  implementation review.
- Consider explicitly noting in design.md that `SparkJobSubmitter.loadDataFrame`'s match has a
  catch-all (`case other =>`), so `TextSource` reaching the Spark path (if it ever does) fails
  gracefully rather than via `MatchError` — verified this is already true, just undocumented.
