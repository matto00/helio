## Context

`TextSource` (HEL-215, `domain/DataSource.scala`) is the connector template this ticket extends:
a closed 5-kind `DataSource` ADT with a `kind` discriminator under a Postgres CHECK constraint
(latest: `V47__add_text_source_type.sql`), four closed matches to extend
(`DataSourceRepository.rowToDomain`/`domainToRow`/`update`, `DataSourceService.update`), plus
`DataSourceConfigCodec`, `DataSourceProtocol`, `DataSourceRoutes`, and
`InProcessPipelineEngine.loadRows`. HEL-215 left two reusable helpers in
`services/ContentSourceSupport.scala` (`metadataFields`, guarded `fetchUrl`/`validateUrl`)
explicitly for this ticket and HEL-214 (PDF) to reuse rather than reimplement.

HEL-217 added `DataFieldType.BinaryRefType` (row value shape `{storageKey, mimeType, filename,
sizeBytes}`) and a `binary_refs` table + `BinaryRefRepository.overwriteForDataType` — a
row-correlated secondary index over the same metadata already inline in `data_type_rows.data`.
Per HEL-217's design (Decision 4), no call site was wired: "a connector/pipeline run that calls
`overwriteRows` to replace a DataType's row snapshot SHALL call `overwriteForDataType` with the
same run's binary refs in the same operation." The only place `overwriteRows` is ever called
today is `PipelineRunService.onRunSuccess` (`dataTypeRowRepo.overwriteRows(outputDataTypeId.value,
jsRows)`), reached for every source kind (text/CSV/static/image alike) once a pipeline run
succeeds — this is the sole write path any connector's rows go through; `DataSourceService`
itself never writes rows, only registers the source's own auto-inferred `DataType` schema
(mirroring `TextSource`, which also writes no rows at creation time).

## Goals / Non-Goals

**Goals:**
- `ImageSource` kind: file upload + URL ingestion of image files, in-process pipeline-bindable.
- `content` field as `BinaryRefType`; `filename`/`sizeBytes`/`mimeType`/`width`/`height` as their
  own metadata fields (the ticket's explicit ask, beyond `TextSource`'s 3-field shape).
- Wire `BinaryRefRepository.overwriteForDataType` into the one real row-write call site
  (`PipelineRunService.onRunSuccess`), generically — not image-specific — closing the gap HEL-217
  intentionally left open.
- Reuse `ContentSourceSupport.fetchUrl`/`validateUrl`/`metadataFields` and the `binary_refs`
  table/repository exactly as HEL-217/HEL-215 built them; no new HTTP client, no new storage.

**Non-Goals:**
- Image resize/thumbnail/transcode. Spark-path row-loading (in-process is sufficient, same as
  text). A preview affordance (`DataSourceService.preview` stays csv/static-only).
- Fixing `upsertFieldsFromRows`'s pre-existing loss of content-type fidelity on pipeline *output*
  `DataType`s (applies equally to `TextSource` today; not this ticket's regression to fix).

## Decisions

**New `ImageSource` kind, config shape identical to `TextSourceConfig`.**
`ImageSourceConfig(path: String, sourceUrl: Option[String])` — same relative-`FileSystem`-key
convention (`image/<sourceId>.<ext>`), same `sourceUrl` semantics (refresh re-fetches vs.
re-reads). No divergence from the established template; the divergence is entirely in the
metadata-field set and the content `DataFieldType`.

**Metadata fields: reuse `ContentSourceSupport.metadataFields` for the base triple, append
image-specific fields locally.** `ContentSourceSupport.metadataFields(BinaryRefType, filename,
sizeBytes)` still returns `{content, filename, sizeBytes}` unchanged (shared with HEL-214/PDF —
not touched). `DataSourceService.ingestImage` appends `width`/`height`
(`DataFieldType.IntegerType`) and `mimeType` (`DataFieldType.StringType`) itself, since these are
image-specific, not part of the generic content contract. Alternative considered: generalize
`metadataFields` to accept an `extraFields: Vector[DataField]` parameter — rejected as premature
generalization for a single caller; can be revisited if HEL-214 (PDF) needs the same shape.

**Dimensions + MIME type: new `services/ImageSourceSupport.scala`, mirroring
`DataSourceCsvSupport`'s per-connector-helper precedent.** `dimensionsAndMime(bytes, filename):
Either[String, (width: Int, height: Int, mimeType: String)]` — reads width/height via
`javax.imageio.ImageIO.read` (JDK-standard, zero new dependency); `ImageIO.read` returning `null`
(corrupt file / unsupported codec) maps to `Left("Unable to read image dimensions...")`. MIME type
is derived from the validated extension via a fixed map (`png/jpg/jpeg/gif/webp/bmp` ->
canonical `image/*` strings) — same extension-driven approach as
`ContentSourceSupport.validateExtension`, not `Content-Type`-header sniffing (consistent with
`TextSource`'s upload path, which also trusts the filename, not headers).

**`ContentSourceSupport.ImageExtensions` added alongside `TextExtensions`** — same shape, no
change to `validateExtension`/`filenameFromUrl` themselves.

**`BinaryRefRepository.overwriteForDataType` wired into `PipelineRunService.onRunSuccess`,
generically over row shape, not gated on source kind.** After `dataTypeRowRepo.overwriteRows`
succeeds, scan `resultRows` for any field value matching the `BinaryRef` shape (a `Map` with the
four required string/long keys) and build one `BinaryRef` per match (`id` = fresh UUID,
`dataTypeId` = `outputDataTypeId.value`, `rowIndex` = the row's index, `fieldName` = the map key),
then call `binaryRefRepo.overwriteForDataType(outputDataTypeId.value, refs)` in the same
`for`-comprehension as `rowsUpsert`, guarded by the same `if (binaryRefRepo != null)` nullable-repo
convention `dataTypeRowRepo`/`pipelineRunRepo` already use. Alternative considered: have
`DataSourceService`/`InProcessPipelineEngine` call `overwriteForDataType` directly at row-load
time — rejected because `loadRows`' output is pre-pipeline-step-execution (steps like
`SelectStep`/`RenameStep` can still touch the row before it reaches `onRunSuccess`), so extracting
refs from the *final* `resultRows` (post-step) is the only place the value guaranteed to match
what actually lands in `data_type_rows` is available — matching HEL-217's "same run's binary refs
in the same operation" contract literally.
`PipelineRunService` gains a new `binaryRefRepo: BinaryRefRepository = null` constructor param
(nullable default, matching every other optional repo on this class); `ApiRoutes` constructs a
`new BinaryRefRepository(dbContext)` and threads it through (`ApiRoutes` currently has no
`BinaryRefRepository` at all — HEL-217 shipped the class with no wired caller, as its design
explicitly notes).

**`InProcessPipelineEngine.loadRows` gets its own `case i: ImageSource`,** not shared with
`TextSource`'s loader (per HEL-215's design note: this dispatch is deliberately per-connector, not
generalized over three data points). Builds the single row: `content` = the `BinaryRef` map
(`storageKey` = `i.config.path`, `mimeType`, `filename`, `sizeBytes`), plus top-level `filename`,
`sizeBytes`, `width`, `height`, `mimeType` fields.

**`PipelineRowJson.anyToJsValue` must gain a nested-`Map` case (skeptic design-gate round 1,
probe-confirmed).** This is the first row value this codebase ever nests a `Map[String, Any]`
inside a `Row = Map[String, Any]` (the `content` field's `BinaryRef` shape) — every prior source
kind's row values are flat scalars. `anyToJsValue`'s current match
(`backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:26-37`) has no case for `Map` and
falls to `case _ => JsString(v.toString)`, which would stringify the nested map into unusable text
(e.g. `"Map(storageKey -> ..., mimeType -> ...)"`) instead of a real JSON object — silently
corrupting `data_type_rows.data.content`, the sole row-read path per HEL-217's design, even though
the separate `binary_refs` extraction below (which reads pre-serialization `resultRows`, not the
corrupted JSON) would still produce correct secondary-index rows, leaving the two inconsistent.
Fix: add `case m: Map[String, Any] @unchecked => JsObject(m.map { case (k, v) => k ->
anyToJsValue(v) })` immediately before the catch-all, so nested maps recursively convert to
`JsObject` instead of falling through. This is a small, shared-helper fix (also used by
`previewStep`'s row projection and `status`'s cached-run projection) — not scoped to image rows
specifically, but this ticket is what first exercises the gap and is responsible for closing it
before any image-source row can be correctly persisted.

**Route dispatch mirrors `TextSource` exactly**: `createMultipartUploadRoute`'s `typeStr` branch
gains an `Image` case (own max-bytes env var, `IMAGE_MAX_FILE_SIZE_BYTES`, default 20 MB — between
text's 10 MB and CSV's 50 MB, images being typically larger than markdown but smaller than bulk
CSV); `createStaticRoute`'s JSON dispatch gains an `Image` branch for
`ImageSourceUrlRequest`/`createImageUrl`.

## Risks / Trade-offs

- [Risk] `ImageIO.read` support is JVM/platform-dependent for some codecs (e.g. WebP support
  varies by JDK build) → Mitigation: validate extension first (rejects unsupported formats before
  attempting decode); a `null` `ImageIO.read` result is treated as a clean `BadRequest`, not a
  500.
- [Risk] `onRunSuccess`'s row-shape scan for `BinaryRef`-like maps is structural, not
  schema-driven (it doesn't consult the `DataType`'s declared field types) → Mitigation: matches
  exactly what HEL-217 anticipated ("connectors...call `overwriteForDataType`...when writing
  ingested rows"); the shape check (4 required keys, correct value types) is specific enough that
  a false-positive match on an unrelated JSON object is very unlikely, and a false negative only
  means a missing secondary-index entry (non-fatal — `binary_refs` is explicitly a derived index,
  never the row read path, per HEL-217 design).
- [Risk] `binaryRefRepo` threading touches `PipelineRunService`'s constructor (shared with every
  pipeline run, not just image) → Mitigation: nullable-default param, same pattern as
  `pipelineRunRepo`/`dataTypeRowRepo`; existing tests that construct it without the new param are
  unaffected (skipped, matching those repos' existing null-checked behavior).
- [Risk] The `anyToJsValue` nested-`Map` fix is a shared helper also used by `ComputeStep`'s
  expression evaluator (`jsValueToAny`, the inverse direction) and ordinary structured-row
  serialization → Mitigation: the fix only adds a case before the existing catch-all and does not
  change behavior for any value that isn't a `Map` (every existing scalar case is untouched), so
  no regression risk for CSV/static/text/REST/SQL rows; a regression test asserts existing scalar
  serialization is unchanged alongside the new nested-object test.

## Planner Notes

- Self-approved: 20 MB default `IMAGE_MAX_FILE_SIZE_BYTES` (between text's 10 MB and CSV's 50 MB).
- Self-approved: `width`/`height`/`mimeType` appended locally in `DataSourceService` rather than
  generalizing `ContentSourceSupport.metadataFields`'s signature — minimal, single-caller change.
- Self-approved: wiring `overwriteForDataType` into `PipelineRunService.onRunSuccess` generically
  (not adding an image-specific hook) since that is the only real row-write call site and HEL-217
  already framed this as the intended, source-kind-agnostic write contract.
