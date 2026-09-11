package com.helio.services.sources

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.domain.engine.{DatasetRowValidator, DatasetSchemaMigration, PipelineRowJson, SchemaField, SchemaInferenceEngine}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.stream.Materializer
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.sources.{CsvPreviewResponse, DatasetFieldResponse, DatasetSchemaResponse, DatasetSchemaUpdateResponse, FieldOverridePayload, InferredFieldResponse, InferredSchemaResponse, SchemaFieldRejection, SchemaUpdateConflictResponse, StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest, UpdateDataSourceRequest, UpdateDatasetSchemaRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository.{BlockingPipeline, DatasetRowRow, RowListPage, RowMutationFailure}
import com.helio.infrastructure.storage.FileSystem
import SourceConfigParsing._
import spray.json._

import org.postgresql.util.PSQLException
import org.slf4j.LoggerFactory

import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Paths
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Business logic for CSV + Static + Text (HEL-215) + Pdf (HEL-214) +
 *  Image (HEL-216) data
 *  sources.
 *
 *  CSV inserts and previews carry raw bytes (already unmarshalled by the route
 *  layer from `Multipart.FormData`) so the service stays free of Pekko HTTP
 *  types. `Materializer` is passed explicitly because the CSV write path uses
 *  `fileSystem.write` which may internally stream. `ActorSystem` is passed
 *  explicitly for `ContentSourceSupport.fetchUrl` (text-source and
 *  image-source URL ingestion).
 *
 *  `resolveHost` defaults to [[ContentSourceSupport.defaultResolveHost]] (real
 *  DNS) and `isBlocked` defaults to [[ContentSourceSupport.isBlockedAddress]]
 *  (host-agnostic); both are forwarded to every `ContentSourceSupport.fetchUrl`
 *  call this service makes — production (`ApiRoutes`/`Main`) never overrides
 *  either, so the SSRF guard (including the cycle-3 DNS-rebinding pin — see
 *  `ContentSourceSupport.fetchUrl`) is always strict in production. The
 *  overrides exist solely so tests can exercise this service's URL-ingestion
 *  business logic (DataType registration, refresh-and-overwrite, etc.)
 *  against a local test HTTP server without weakening the guard for any
 *  other host: `isBlocked` (keyed on hostname) is the intended seam for
 *  admitting a single known-safe test hostname, since `resolveHost` alone no
 *  longer needs overriding when the test server binds to a hostname
 *  (`"localhost"`) that already resolves correctly via real DNS. */
final class DataSourceService(
    dataSourceRepo: DataSourceRepository,
    fileSystem:     FileSystem,
    resolveHost:    String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost,
    isBlocked:      (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr),
    // HEL-477: nullable-optional wiring mirrors this file's other DI.
    auditService: AuditService = null
)(implicit ec: ExecutionContext, @annotation.unused mat: Materializer, system: ActorSystem[_]) {

  private val log = LoggerFactory.getLogger(getClass)

  private val staticMaxRows = 500

  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "data_source", resourceId, JsObject.empty)

  /** Max upload / URL-fetch size for text/PDF/image sources (HEL-215/214/216).
   *  HEL-881: hoisted to `ContentSourceSupport` so this manual-refresh path and
   *  the pipeline-engine run-path seam (`PipelineRunService`) read the same
   *  values rather than each keeping its own literal default that could
   *  silently diverge — unchanged in value from the pre-existing defaults
   *  defined here. */
  private def textMaxBytes: Long  = ContentSourceSupport.textMaxBytes
  private def pdfMaxBytes: Long   = ContentSourceSupport.pdfMaxBytes
  private def imageMaxBytes: Long = ContentSourceSupport.imageMaxBytes


  /** `tag`, when given, exact-matches (HEL-366 tasks.md 2.5) — `None` is the
   *  pre-existing unfiltered behavior. */
  def findAll(user: AuthenticatedUser, page: Page, tag: Option[String] = None): Future[PagedResult[DataSource]] =
    dataSourceRepo.findAll(user.id, page, tag)

  /** Owner-scoped single-resource read (HEL-661 design.md D3), mirroring `DataTypeService.findById`'s
   *  exact shape over `DataSourceRepository.findByIdOwned` — needed because `WorkspaceSearchService.
   *  getResource` must fetch a single owned resource, and today only `DataTypeService`/`MetricService`/
   *  `PipelineService` (via `findSummaryById`) expose that at the service layer. */
  def findById(id: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    dataSourceRepo.findByIdOwned(id, user).map {
      case Some(ds) => Right(ds)
      case None     => Left(ServiceError.NotFound("Data source not found"))
    }


  def createStatic(req: StaticDataSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (req.rows.size > staticMaxRows)
      Future.successful(Left(ServiceError.BadRequest(s"Payload exceeds the maximum of $staticMaxRows rows")))
    else RequestValidation.validateTag(req.tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(tag) =>
      // HEL-906 cycle 5 (coordinator ruling, AC-3 "boundary validation"): every column's
      // caller-supplied `type` (POST /api/data-sources/static) must resolve to a canonical
      // DataFieldType or the whole request is rejected with a 400 naming the valid types --
      // `canonicalizeLegacy` alone (cycle 4) only normalized KNOWN synonyms and silently passed
      // an unrecognized string (e.g. "banana") straight through, which is exactly the gap this
      // closes. Collected up front (not per-field .map) so every bad column is named at once.
      val invalidColumns = req.columns.flatMap { col =>
        DataFieldType.validateAndCanonicalize(col.`type`) match {
          case Left(_)  => Some(col.name -> col.`type`)
          case Right(_) => None
        }
      }
      if (invalidColumns.nonEmpty) {
        val detail = invalidColumns.map { case (name, badType) => s"'$name': '$badType'" }.mkString(", ")
        Future.successful(Left(ServiceError.BadRequest(
          s"Invalid column type(s): $detail. Valid types: ${DataFieldType.CanonicalWireValues.mkString(", ")}"
        )))
      } else {
      // HEL-1076 design.md Decision 1/6: build the richer declaration (name/type/required/
      // default) from the wire payload -- `col.\`type\`` is validated above (a legacy synonym
      // like "double" is ACCEPTED, not rejected) but not yet canonicalized, so canonicalize here.
      val declaredColumns = req.columns.map { c =>
        val fieldType = DataFieldType.fromString(
          DataFieldType.validateAndCanonicalize(c.`type`).getOrElse(c.`type`)
        ).getOrElse(DataFieldType.StringType)
        DatasetFieldDeclaration(c.name, fieldType, c.required.getOrElse(false), c.default)
      }.toVector
      // design.md Decision 6: a field's default must itself satisfy its declared type, checked
      // at declaration time, before any row is validated or persisted.
      val defaultErrors = declaredColumns.flatMap(f => DatasetRowValidator.validateDefault(f).left.toOption)
      if (defaultErrors.nonEmpty) {
        Future.successful(Left(ServiceError.BadRequest(defaultErrors.map(DatasetRowValidator.renderDefaultError).mkString("; "))))
      } else {
      DatasetRowValidator.validate(declaredColumns, req.rows) match {
        case Left(errors) =>
          Future.successful(Left(ServiceError.BadRequest(errors.mkString("; "))))
        case Right(validatedRows) =>
      val now      = Instant.now()
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val source   = DatasetSource(
        id        = sourceId,
        name      = req.name.trim,
        ownerId   = user.id,
        createdAt = now,
        updatedAt = now,
        tag       = tag
      )
      // HEL-1074: the {columns, rows} payload is written into `dataset_rows` +
      // `dataset_schema` (declared columns), atomically alongside the `data_sources` insert
      // (design.md Decision 7) -- `config` is no longer used for `dataset`-kind sources.
      // HEL-893 design D2: the registered schema reports the type the stored rows actually
      // materialize (via `PipelineRowJson.staticColumnRuntimeType`, the same conversion
      // `parseStaticRows` applies), not the caller-declared `columns[].type` -- that declared
      // type was never consulted when materializing rows and could disagree with every cell.
      val fields  = req.columns.zipWithIndex.map { case (col, i) =>
        val cells = validatedRows.map(_.lift(i).getOrElse(JsNull))
        SchemaField(col.name, PipelineRowJson.staticColumnRuntimeType(col.`type`, cells))
      }.toVector
      dataSourceRepo.insertDatasetSource(source, declaredColumns, validatedRows, fields, user).map { ds =>
        audit("data_source.create", Some(ds.id.value), user)
        Right(ds)
      }
        }
      }
      }
    }


  def createCsv(
      name: String,
      bytes: Array[Byte],
      overrides: Vector[FieldOverridePayload],
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    RequestValidation.validateTag(tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(validTag) =>
    DataSourceCsvSupport.decodeUtf8(bytes) match {
      case None =>
        Future.successful(Left(ServiceError.BadRequest("File must be UTF-8 encoded")))
      case Some(csvContent) =>
        // HEL-893 design D3/tasks.md 3.1: a CSV column materializes as `String`, always -- a
        // field override asking for anything else would re-create the exact declared-vs-runtime
        // defect this change removes, in one click. Reject loudly (naming the `cast` step) rather
        // than silently coercing to `string`, since silently discarding an explicit instruction
        // is the failure mode this whole ticket exists to close. This is the ONE real CSV
        // override-application site -- `createCsvUrl`/`finishCsvRefresh`/`infer` accept no
        // overrides at all, and `SchemaInferenceFacade.toSchemaFields` serves only the generic
        // REST/SQL/JSON `ConnectorDriver` path and must NOT be touched (it would regress those).
        val nonStringOverrides = overrides.filterNot(o => DataFieldType.canonicalizeLegacy(o.dataType) == "string")
        if (nonStringOverrides.nonEmpty) {
          val names = nonStringOverrides.map(_.name).mkString(", ")
          Future.successful(Left(ServiceError.BadRequest(
            s"CSV columns always materialize as string; cannot override type for: $names. " +
              "Use a 'cast' pipeline step to convert values after ingestion."
          )))
        } else {
        val overridesMap = overrides.map(o => o.name -> o).toMap
        val schema       = SchemaInferenceEngine.fromCsv(csvContent)
        val now          = Instant.now()
        val sourceId     = DataSourceId(UUID.randomUUID().toString)
        val filePath     = s"csv/${sourceId.value}.csv"
        val source = CsvSource(
          id        = sourceId,
          name      = name,
          ownerId   = user.id,
          createdAt = now,
          updatedAt = now,
          config    = CsvSourceConfig(filePath),
          tag       = validTag
        )
        fileSystem.write(filePath, bytes).flatMap { _ =>
          dataSourceRepo.insert(source, user).flatMap { ds =>
            val fields = schema.fields.map { f =>
              val ov = overridesMap.get(f.name)
              // Every override was already validated as `string` above; `dataType` is retained
              // only so a `displayName`-only override still applies without dropping the type.
              SchemaField(f.name, ov.map(o => DataFieldType.canonicalizeLegacy(o.dataType)).getOrElse(DataFieldType.asString(f.dataType)))
            }.toVector
            dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
              audit("data_source.create", Some(ds.id.value), user)
              Right(updated.getOrElse(ds))
            }
          }
        }
        }
    }
    }


  /** Map a [[CsvUrlFetchError]] to its `ServiceError` per design.md
   *  Decision 2's mapping table — deliberately NOT `createTextUrl`/
   *  `refreshText`'s uniform `BadGateway` mapping, which would emit 502 for a
   *  rejected scheme and for an oversize body. */
  private def csvUrlErrorToServiceError(err: CsvUrlFetchError): ServiceError = err match {
    case CsvUrlFetchError.InvalidScheme(msg) => ServiceError.BadRequest(msg)
    case CsvUrlFetchError.Upstream(msg)      => ServiceError.BadGateway(msg)
    case CsvUrlFetchError.TooLarge(msg)      => ServiceError.PayloadTooLarge(msg)
    case CsvUrlFetchError.NotCsv(msg)        => ServiceError.BadRequest(msg)
  }

  /** URL path (HEL-862): fetches the URL via the shared [[CsvUrlFetch]]
   *  helper — https-only, SSRF-guarded, size-limited, non-CSV-body-gated —
   *  then stores the bytes exactly like an upload at the fixed
   *  `csv/<id>.csv` path and persists `sourceUrl` so refresh/run can
   *  re-fetch. Validates and fetches BEFORE persisting (design.md Decision 5)
   *  so a failed fetch leaves no data source row and no stored file. No
   *  `filenameFromUrl`/`validateExtension` — CSV has no filename metadata
   *  field and an extensionless/query-driven CSV endpoint is the target use
   *  case (design.md Decision 6). */
  def createCsvUrl(name: String, url: String, user: AuthenticatedUser, tag: Option[String] = None): Future[Either[ServiceError, DataSource]] =
    if (name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else RequestValidation.validateTag(tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(validTag) =>
        CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost, isBlocked).flatMap {
          case Left(err) =>
            Future.successful(Left(csvUrlErrorToServiceError(err)))
          case Right(bytes) =>
            DataSourceCsvSupport.decodeUtf8(bytes) match {
              case None =>
                Future.successful(Left(ServiceError.BadRequest("File must be UTF-8 encoded")))
              case Some(csvContent) =>
                val schema   = SchemaInferenceEngine.fromCsv(csvContent)
                val now      = Instant.now()
                val sourceId = DataSourceId(UUID.randomUUID().toString)
                val filePath = s"csv/${sourceId.value}.csv"
                val source = CsvSource(
                  id        = sourceId,
                  name      = name.trim,
                  ownerId   = user.id,
                  createdAt = now,
                  updatedAt = now,
                  config    = CsvSourceConfig(filePath, sourceUrl = Some(url)),
                  tag       = validTag
                )
                fileSystem.write(filePath, bytes).flatMap { _ =>
                  dataSourceRepo.insert(source, user).flatMap { ds =>
                    val fields = schema.fields.map(f =>
                      SchemaField(f.name, DataFieldType.asString(f.dataType))
                    ).toVector
                    dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
                      audit("data_source.create", Some(ds.id.value), user)
                      Right(updated.getOrElse(ds))
                    }
                  }
                }
            }
        }
    }


  /** Upload path: `filename` is the original uploaded file's name (used only
   *  to determine + validate the extension; the stored `path`'s basename is
   *  what's reported as the `filename` field value at pipeline-run time). */
  def createTextUpload(
      name: String,
      bytes: Array[Byte],
      filename: String,
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    ingestText(name, filename, bytes, sourceUrl = None, user, tag)

  /** URL path: fetches the URL's raw bytes via `ContentSourceSupport.fetchUrl`
   *  and stores them exactly like an upload (`config.sourceUrl` set so
   *  refresh re-fetches instead of re-reading). */
  def createTextUrl(name: String, url: String, user: AuthenticatedUser, tag: Option[String] = None): Future[Either[ServiceError, DataSource]] =
    ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(bytes) =>
        ingestText(name, ContentSourceSupport.filenameFromUrl(url), bytes, sourceUrl = Some(url), user, tag)
    }

  /** Shared ingestion path for both text-source creation modes: extension
   *  validation, size enforcement, UTF-8 validation, `FileSystem` write at
   *  `text/<sourceId>.<ext>`, and `DataType` registration via
   *  `ContentSourceSupport.metadataFields(StringBodyType, ...)`. */
  private def ingestText(
      name: String,
      filename: String,
      bytes: Array[Byte],
      sourceUrl: Option[String],
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    if (name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else RequestValidation.validateTag(tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(validTag) =>
      ContentSourceSupport.validateExtension(filename, ContentSourceSupport.TextExtensions) match {
        case Left(msg) =>
          Future.successful(Left(ServiceError.BadRequest(msg)))
        case Right(ext) =>
          if (bytes.length.toLong > textMaxBytes)
            Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $textMaxBytes bytes")))
          else
            DataSourceCsvSupport.decodeUtf8(bytes) match {
              case None =>
                Future.successful(Left(ServiceError.BadRequest("File must be UTF-8 encoded")))
              case Some(_) =>
                val now      = Instant.now()
                val sourceId = DataSourceId(UUID.randomUUID().toString)
                val filePath = s"text/${sourceId.value}.$ext"
                val source = TextSource(
                  id        = sourceId,
                  name      = name.trim,
                  ownerId   = user.id,
                  createdAt = now,
                  updatedAt = now,
                  config    = TextSourceConfig(filePath, sourceUrl),
                  tag       = validTag
                )
                fileSystem.write(filePath, bytes).flatMap { _ =>
                  dataSourceRepo.insert(source, user).flatMap { ds =>
                    val fields = ContentSourceSupport.metadataFields(DataFieldType.StringBodyType, filename, bytes.length.toLong)
                      .map(f => SchemaField(f.name, f.dataType))
                    dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
                      audit("data_source.create", Some(ds.id.value), user)
                      Right(updated.getOrElse(ds))
                    }
                  }
                }
            }
      }
    }


  /** Upload path: `filename` is the original uploaded file's name (used only
   *  to determine + validate the extension; the stored `path`'s basename is
   *  what's reported as the `filename` field value at pipeline-run time). */
  def createPdfUpload(
      name: String,
      bytes: Array[Byte],
      filename: String,
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    ingestPdf(name, filename, bytes, sourceUrl = None, user, tag)

  /** URL path: fetches the URL's raw bytes via `ContentSourceSupport.fetchUrl`
   *  and stores them exactly like an upload (`config.sourceUrl` set so
   *  refresh re-fetches instead of re-reading). */
  def createPdfUrl(name: String, url: String, user: AuthenticatedUser, tag: Option[String] = None): Future[Either[ServiceError, DataSource]] =
    ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(bytes) =>
        ingestPdf(name, ContentSourceSupport.filenameFromUrl(url), bytes, sourceUrl = Some(url), user, tag)
    }

  /** The PDF connector's `DataType` field list: the shared `{content,
   *  filename, sizeBytes}` triple from `ContentSourceSupport.metadataFields`
   *  (untouched signature — see design.md's rebase-surface rationale) plus
   *  the PDF-specific `pageNumber`/`pageCount`/`characterCount` fields
   *  appended at this connector layer. */
  private def pdfFields(filename: String, sizeBytes: Long): Vector[DataField] =
    ContentSourceSupport.metadataFields(DataFieldType.StringBodyType, filename, sizeBytes) ++ Vector(
      DataField("pageNumber", "Page Number", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
      DataField("pageCount", "Page Count", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
      DataField("characterCount", "Character Count", DataFieldType.asString(DataFieldType.IntegerType), nullable = false)
    )

  /** Shared ingestion path for both PDF-source creation modes: extension
   *  validation, size enforcement, `PdfTextSupport.validate` (rejects
   *  corrupt/encrypted PDFs at ingest without doing a full text walk),
   *  `FileSystem` write at `pdf/<sourceId>.pdf`, and `DataType` registration
   *  via [[pdfFields]]. */
  private def ingestPdf(
      name: String,
      filename: String,
      bytes: Array[Byte],
      sourceUrl: Option[String],
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    if (name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else RequestValidation.validateTag(tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(validTag) =>
      ContentSourceSupport.validateExtension(filename, ContentSourceSupport.PdfExtensions) match {
        case Left(msg) =>
          Future.successful(Left(ServiceError.BadRequest(msg)))
        case Right(ext) =>
          if (bytes.length.toLong > pdfMaxBytes)
            Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $pdfMaxBytes bytes")))
          else
            PdfTextSupport.validate(bytes) match {
              case Left(msg) =>
                Future.successful(Left(ServiceError.BadRequest(msg)))
              case Right(_) =>
                val now      = Instant.now()
                val sourceId = DataSourceId(UUID.randomUUID().toString)
                val filePath = s"pdf/${sourceId.value}.$ext"
                val source = PdfSource(
                  id        = sourceId,
                  name      = name.trim,
                  ownerId   = user.id,
                  createdAt = now,
                  updatedAt = now,
                  config    = PdfSourceConfig(filePath, sourceUrl),
                  tag       = validTag
                )
                fileSystem.write(filePath, bytes).flatMap { _ =>
                  dataSourceRepo.insert(source, user).flatMap { ds =>
                    val fields = pdfFields(filename, bytes.length.toLong).map(f => SchemaField(f.name, f.dataType))
                    dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
                      audit("data_source.create", Some(ds.id.value), user)
                      Right(updated.getOrElse(ds))
                    }
                  }
                }
            }
      }
    }


  /** Upload path: `filename` is the original uploaded file's name (used only
   *  to determine + validate the extension; the stored `path`'s basename is
   *  what's reported as the `filename` field value at pipeline-run time). */
  def createImageUpload(
      name: String,
      bytes: Array[Byte],
      filename: String,
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    ingestImage(name, filename, bytes, sourceUrl = None, user, tag)

  /** URL path: fetches the URL's raw bytes via `ContentSourceSupport.fetchUrl`
   *  and stores them exactly like an upload (`config.sourceUrl` set so
   *  refresh re-fetches instead of re-reading). */
  def createImageUrl(name: String, url: String, user: AuthenticatedUser, tag: Option[String] = None): Future[Either[ServiceError, DataSource]] =
    ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
      case Left(err) =>
        Future.successful(Left(ServiceError.BadGateway(err)))
      case Right(bytes) =>
        ingestImage(name, ContentSourceSupport.filenameFromUrl(url), bytes, sourceUrl = Some(url), user, tag)
    }

  /** Shared ingestion path for both image-source creation modes: extension
   *  validation, size enforcement, dimensions/MIME derivation via
   *  `ImageSourceSupport.dimensionsAndMime`, `FileSystem` write at
   *  `image/<sourceId>.<ext>`, and `DataType` registration via
   *  `ContentSourceSupport.metadataFields(BinaryRefType, ...)` plus
   *  `width`/`height`/`mimeType` appended locally (image-specific, not part
   *  of the generic content contract). */
  private def ingestImage(
      name: String,
      filename: String,
      bytes: Array[Byte],
      sourceUrl: Option[String],
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[ServiceError, DataSource]] =
    if (name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else RequestValidation.validateTag(tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(validTag) =>
      ContentSourceSupport.validateExtension(filename, ContentSourceSupport.ImageExtensions) match {
        case Left(msg) =>
          Future.successful(Left(ServiceError.BadRequest(msg)))
        case Right(ext) =>
          if (bytes.length.toLong > imageMaxBytes)
            Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $imageMaxBytes bytes")))
          else
            ImageSourceSupport.dimensionsAndMime(bytes, filename) match {
              case Left(msg) =>
                Future.successful(Left(ServiceError.BadRequest(msg)))
              case Right((width, height, mimeType)) =>
                val now      = Instant.now()
                val sourceId = DataSourceId(UUID.randomUUID().toString)
                val filePath = s"image/${sourceId.value}.$ext"
                val source = ImageSource(
                  id        = sourceId,
                  name      = name.trim,
                  ownerId   = user.id,
                  createdAt = now,
                  updatedAt = now,
                  config    = ImageSourceConfig(filePath, sourceUrl),
                  tag       = validTag
                )
                fileSystem.write(filePath, bytes).flatMap { _ =>
                  dataSourceRepo.insert(source, user).flatMap { ds =>
                    val fields = (ContentSourceSupport.metadataFields(DataFieldType.BinaryRefType, filename, bytes.length.toLong) ++
                      Vector(
                        DataField("width", "Width", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
                        DataField("height", "Height", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
                        DataField("mimeType", "MIME Type", DataFieldType.asString(DataFieldType.StringType), nullable = false)
                      )).map(f => SchemaField(f.name, f.dataType))
                    dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
                      audit("data_source.create", Some(ds.id.value), user)
                      Right(updated.getOrElse(ds))
                    }
                  }
                }
            }
      }
    }


  def update(sourceId: DataSourceId, req: UpdateDataSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    req.name match {
      case Some(n) if n.trim.isEmpty =>
        Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
      case _ =>
        dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound("Data source not found")))
          case Some(source) =>
            val newName = req.name.map(_.trim).getOrElse(source.name)
            val now     = Instant.now()
            val updated = source match {
              case c: CsvSource    => c.copy(name = newName, updatedAt = now)
              case r: RestSource   => r.copy(name = newName, updatedAt = now)
              case s: SqlSource    => s.copy(name = newName, updatedAt = now)
              case s: DatasetSource => s.copy(name = newName, updatedAt = now)
              case t: TextSource   => t.copy(name = newName, updatedAt = now)
              case p: PdfSource    => p.copy(name = newName, updatedAt = now)
              case i: ImageSource  => i.copy(name = newName, updatedAt = now)
            }
            dataSourceRepo.update(updated, user).map {
              case None     => Left(ServiceError.NotFound("Data source not found"))
              case Some(ds) =>
                audit("data_source.update", Some(ds.id.value), user)
                Right(ds)
            }
        }
    }

  /** HEL-987 design.md Decision 1/2: 409s (naming the blocking pipeline) instead of the bare
   *  500 that used to escape when `sourceId` is a pipeline's SOLE root -- deleting it would
   *  cascade `pipeline_roots.data_source_id ON DELETE CASCADE` (V98) into a still-existing
   *  pipeline with zero roots, which V99's `hel913_prevent_zero_root_pipelines` trigger raises
   *  (P0001) rather than allow (R1: "a zero-root pipeline is not a representable state"). A
   *  source that is one of SEVERAL roots, or referenced by no pipeline at all, is unaffected
   *  (HEL-989 owns the adjacent multi-root silent-panel-loss risk; out of scope here).
   *
   *  Decision 2's two layers: the pre-check below (task 3.1a) gives the good message and runs
   *  BEFORE `deleteFileF` (task 3.4) so a rejected delete no longer destroys the source's
   *  backing file; `classifyDeleteFailure` (task 3.2) is the race-path backstop for the
   *  TOCTOU window between the pre-check and the actual delete -- neither alone is sufficient. */
  def delete(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[DataSourceDeleteError, Unit]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(DataSourceDeleteError.plain(ServiceError.NotFound("Data source not found"))))
      case Some(source) =>
        dataSourceRepo.soleRootDependentPipelines(sourceId, user).flatMap {
          case blocking if blocking.nonEmpty =>
            Future.successful(Left(DataSourceDeleteError.conflict(soleRootConflict(source, blocking))))
          case _ =>
            // HEL-974 design.md D9: the RLS-scoped check above returned empty, but after V100
            // makes the DB trigger BYPASSRLS-aware it can still see (and refuse-on) a pipeline
            // invisible to this caller. Check the privileged, count-only pool BEFORE
            // `deleteFileF` runs below -- a refusal here must never destroy the file. Count-only:
            // no id/name is ever available to leak into the 409 this branch produces.
            dataSourceRepo.soleRootDependentPipelineCountPrivileged(sourceId).flatMap {
              case count if count > 0 =>
                Future.successful(Left(DataSourceDeleteError.conflict(soleRootConflict(source, Vector.empty))))
              case _ =>
                deleteAfterPrecheck(sourceId, user, source)
            }
        }
    }

  /** Extracted from `delete` (HEL-974): the actual delete, run once BOTH the RLS-scoped
   *  pre-check and the privileged count-only companion check (design.md D9) have cleared. */
  private def deleteAfterPrecheck(sourceId: DataSourceId, user: AuthenticatedUser, source: DataSource): Future[Either[DataSourceDeleteError, Unit]] = {
    val deleteFileF: Future[Unit] = source match {
      case c: CsvSource =>
        fileSystem.delete(c.config.path).recover { case _ => () }
      case t: TextSource =>
        fileSystem.delete(t.config.path).recover { case _ => () }
      case p: PdfSource =>
        fileSystem.delete(p.config.path).recover { case _ => () }
      case i: ImageSource =>
        fileSystem.delete(i.config.path).recover { case _ => () }
      case _ => Future.successful(())
    }
    deleteFileF.flatMap(_ => dataSourceRepo.delete(source.id, user)).map { _ =>
      audit("data_source.delete", Some(source.id.value), user)
      Right(())
    }.recover {
      case ex: PSQLException if isZeroRootViolation(ex) =>
        log.warn(s"DataSourceService.delete: race-path P0001 for source ${sourceId.value}, mapping to conflict", ex)
        Left(DataSourceDeleteError.conflict(soleRootConflict(source, Vector.empty)))
    }
  }

  /** Task 3.2's defensive mapping: matches on SQLSTATE `P0001` (`raise_exception`) PLUS the
   *  `hel913_prevent_zero_root_pipelines` message signature, never on message text alone --
   *  a bare `P0001` could be raised by an unrelated future trigger, and matching only that would
   *  silently swallow it as this specific conflict. */
  private def isZeroRootViolation(ex: PSQLException): Boolean =
    Option(ex.getSQLState).contains("P0001") &&
      Option(ex.getMessage).exists(_.contains("HEL-913")) &&
      Option(ex.getMessage).exists(_.contains("zero roots"))

  /** HEL-987 evaluation-1.md CR1: `resourceKind`/`resourceId`/`resourceName` identify the
   *  SOURCE being deleted -- matching `specs/datasource-edit-delete/spec.md` and the teardown
   *  precedent (`WorkspaceTeardownRepository.sourceDependentPipelineConflict`, whose own
   *  `resourceKind` is `"data_source"` with the dependent pipeline named only in `reason`), NOT
   *  the blocking pipeline. `reason`/`message` names every blocking pipeline by name and id
   *  (task 3.1a). When the race-path mapping (no pre-check result in hand) fires this instead,
   *  `blocking` is empty and the reason falls back to a still-accurate, non-leaky generic
   *  sentence -- naming the pipeline there would require re-querying after the delete already
   *  failed, which is not worth the extra round trip for what design.md documents as a rare
   *  TOCTOU window. Because `resourceId`/`resourceName` are always the source's OWN identity
   *  (never the pipeline's), this race path is consistent by construction -- CR2's identifier
   *  substitution can't recur here. */
  private def soleRootConflict(source: DataSource, blocking: Vector[BlockingPipeline]): DataSourceDeleteConflict = {
    val reason =
      if (blocking.isEmpty)
        "this delete would leave a pipeline with zero roots; remove the pipeline itself instead of its last root, or add another root first"
      else {
        val names = blocking.map(p => s"'${p.name}' (${p.id})").mkString(", ")
        s"deleting this source would leave pipeline(s) $names with zero roots; remove the pipeline itself instead of its last root, or add another root first"
      }
    DataSourceDeleteConflict(resourceKind = "data_source", resourceId = source.id.value, resourceName = source.name, reason = reason)
  }

  /** Unified refresh entry point. The route provides:
   *  - `None` for CSV — service re-reads the stored file.
   *  - `Some(payload)` for Static — service rewrites the stored config.
   *
   *  Mismatches (CSV with a payload, Static without one, other types) all map
   *  back to the same `400 BadRequest` shape that the pre-CS2b routes emitted. */
  def refresh(
      sourceId: DataSourceId,
      staticPayload: Option[StaticDataPayload],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DataSource]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(s: DatasetSource) =>
        staticPayload match {
          case Some(payload) if payload.rows.size > staticMaxRows =>
            Future.successful(Left(ServiceError.BadRequest(s"Payload exceeds the maximum of $staticMaxRows rows")))
          case Some(payload) => applyStaticRefresh(s, payload, user)
          case None          => Future.successful(Left(ServiceError.BadRequest("refresh is only supported for csv and static sources")))
        }
      case Some(c: CsvSource) =>
        refreshCsv(c, user)
      case Some(t: TextSource) =>
        refreshText(t, user)
      case Some(p: PdfSource) =>
        refreshPdf(p, user)
      case Some(i: ImageSource) =>
        refreshImage(i, user)
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("refresh is only supported for csv, static, text, pdf, and image sources")))
    }.map {
      case r @ Right(ds) =>
        audit("data_source.refresh", Some(ds.id.value), user)
        r
      case l => l
    }

  private def applyStaticRefresh(source: DatasetSource, payload: StaticDataPayload, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
    // HEL-906 cycle 5 (coordinator ruling, AC-3 "boundary validation"): a static refresh
    // accepts the SAME caller-supplied column-`type` shape `createStatic` does -- found live
    // (via a 500, not silently) while running this cycle's full test suite after adding
    // `SchemaField`'s structural guard. Same validation, same 400 contract, for the same reason.
    val invalidColumns = payload.columns.flatMap { col =>
      DataFieldType.validateAndCanonicalize(col.`type`) match {
        case Left(_)  => Some(col.name -> col.`type`)
        case Right(_) => None
      }
    }
    if (invalidColumns.nonEmpty) {
      val detail = invalidColumns.map { case (name, badType) => s"'$name': '$badType'" }.mkString(", ")
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid column type(s): $detail. Valid types: ${DataFieldType.CanonicalWireValues.mkString(", ")}"
      )))
    } else {
      // HEL-1076 design.md Decision 8: an incoming refresh's rows are validated against the NEW
      // declaration being written, not the old one -- there is no "editing declaration with
      // existing rows" window on this path (the whole declaration+rows are replaced together).
      val declaredColumns = payload.columns.map { c =>
        val fieldType = DataFieldType.fromString(
          DataFieldType.validateAndCanonicalize(c.`type`).getOrElse(c.`type`)
        ).getOrElse(DataFieldType.StringType)
        DatasetFieldDeclaration(c.name, fieldType, c.required.getOrElse(false), c.default)
      }.toVector
      val defaultErrors = declaredColumns.flatMap(f => DatasetRowValidator.validateDefault(f).left.toOption)
      if (defaultErrors.nonEmpty) {
        Future.successful(Left(ServiceError.BadRequest(defaultErrors.map(DatasetRowValidator.renderDefaultError).mkString("; "))))
      } else {
      // skeptic-final-1.md CR1: truncated to microseconds -- Postgres' `timestamp` column stores
      // microsecond precision, but JDK 21's `Instant.now()` carries nanosecond precision; without
      // truncating, the in-memory value handed to `RowWriteResponse.fromDomain` disagrees with
      // what a subsequent read of the same row actually returns.
      val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
      // HEL-1077 design.md D1 (round-2 correction): validation, the delete-then-insert, and the
      // `inferred_schema` recompute all now happen INSIDE `replaceRows`'s own locked transaction
      // (`declaration = Some(...)` -- write this new schema) -- the pre-call `DatasetRowValidator
      // .validate` this method used to run here is removed to avoid validating twice against two
      // possibly-inconsistent reads (tasks.md 1.4).
      dataSourceRepo.replaceRows(source.id, Some(declaredColumns), payload.rows, staticMaxRows, now, user).map {
        case None                => Left(ServiceError.NotFound("Data source not found"))
        case Some(Left(errMsg))  => Left(ServiceError.BadRequest(errMsg))
        case Some(Right((ds, _))) => Right(ds)
      }
      }
    }
  }

  /** HEL-1077 design.md D4: `dataset` kind check first (no lock/write for the wrong kind).
   *  Empty-array semantics (D6): `POST` rejects `rows: []` as a 400 before any repository call;
   *  `PUT` accepts it (a valid "clear all rows" request), so this guard is append-only. Schema
   *  validation and the row-count limit (D5) run INSIDE `DataSourceRepository.appendRows`'s locked
   *  transaction, not here -- a concurrent schema/row-count change can't race a pre-lock check. */
  def appendRows(id: DataSourceId, rows: Vector[Vector[JsValue]], user: AuthenticatedUser): Future[Either[ServiceError, RowWriteResult]] =
    if (rows.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("at least one row is required")))
    else
      dataSourceRepo.findByIdOwned(id, user).flatMap {
        case None                    => Future.successful(Left(ServiceError.NotFound("Data source not found")))
        case Some(_: DatasetSource)  =>
          // skeptic-final-1.md CR1: truncated to microseconds -- see `applyStaticRefresh`'s
          // identical comment; without this, the per-row `updatedAt` this method hands back to
          // `RowWriteResponse.fromDomain` disagrees with what's actually stored in Postgres.
          val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
          dataSourceRepo.appendRows(id, rows, staticMaxRows, now, user).map {
            case None                     => Left(ServiceError.NotFound("Data source not found"))
            case Some(Left(errMsg))       => Left(ServiceError.BadRequest(errMsg))
            case Some(Right((ds, added))) =>
              audit("data_source.rows.append", Some(ds.id.value), user)
              Right(RowWriteResult.fromRepositoryRows(ds, added))
          }
        case Some(_) => Future.successful(Left(ServiceError.BadRequest("row writes are only supported for dataset sources")))
      }

  /** HEL-1077 design.md D1/D6: PUT is a full-set atomic replace that never touches the declared
   *  schema (`declaration = None` -- `replaceRows` reads+keeps whatever schema is current AT LOCK
   *  TIME, never a pre-lock copy). `rows: []` is valid here (clears the source), unlike append. */
  def replaceRows(id: DataSourceId, rows: Vector[Vector[JsValue]], user: AuthenticatedUser): Future[Either[ServiceError, RowWriteResult]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(_: DatasetSource) =>
        // skeptic-final-1.md CR1: truncated to microseconds -- see `applyStaticRefresh`'s
        // identical comment.
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        dataSourceRepo.replaceRows(id, None, rows, staticMaxRows, now, user).map {
          case None                     => Left(ServiceError.NotFound("Data source not found"))
          case Some(Left(errMsg))       => Left(ServiceError.BadRequest(errMsg))
          case Some(Right((ds, all)))   =>
            audit("data_source.rows.replace", Some(ds.id.value), user)
            Right(RowWriteResult.fromRepositoryRows(ds, all))
        }
      case Some(_) => Future.successful(Left(ServiceError.BadRequest("row writes are only supported for dataset sources")))
    }

  /** HEL-1078 design.md D6: precedence order, fully applied here -- (1) malformed/missing
   *  `updatedAt` is checked FIRST, before any DB call; (2)/(3) the ACL-scoped source lookup and
   *  kind check reuse `findByIdOwned` exactly like `appendRows`/`replaceRows` (404 before 400,
   *  same order those methods already use); (4)-(6) are the repository's own outcome ordering
   *  (`patchRow`), mapped here to the matching `ServiceError`. */
  def patchRow(id: DataSourceId, rowId: String, updatedAtRaw: String, data: Vector[JsValue], user: AuthenticatedUser): Future[Either[ServiceError, RowMutationResult]] =
    parseInstant(updatedAtRaw) match {
      case None => Future.successful(Left(ServiceError.BadRequest(s"updatedAt is missing or not a valid ISO-8601 instant: '$updatedAtRaw'")))
      case Some(expectedUpdatedAt) =>
        dataSourceRepo.findByIdOwned(id, user).flatMap {
          case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
          case Some(_: DatasetSource) =>
            val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
            dataSourceRepo.patchRow(id, rowId, data, expectedUpdatedAt, now, user).map {
              case Left(RowMutationFailure.SourceNotFound)          => Left(ServiceError.NotFound("Data source not found"))
              case Left(RowMutationFailure.RowNotFound)             => Left(ServiceError.NotFound("Row not found"))
              case Left(RowMutationFailure.ValidationFailed(msg))   => Left(ServiceError.BadRequest(msg))
              case Left(RowMutationFailure.StalePrecondition(cur))  =>
                Left(ServiceError.Conflict(s"row $rowId was modified concurrently: expected updatedAt '$expectedUpdatedAt', current is '$cur'"))
              case Right((ds, row)) =>
                audit("data_source.rows.patch", Some(ds.id.value), user)
                Right(RowMutationResult.fromRepositoryRow(ds, row))
            }
          case Some(_) => Future.successful(Left(ServiceError.BadRequest("row writes are only supported for dataset sources")))
        }
    }

  /** HEL-1078 design.md D6: same precedence order as `patchRow`, minus the validation step (there
   *  is no submitted row to validate on DELETE). */
  def deleteRow(id: DataSourceId, rowId: String, updatedAtRaw: String, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    parseInstant(updatedAtRaw) match {
      case None => Future.successful(Left(ServiceError.BadRequest(s"updatedAt is missing or not a valid ISO-8601 instant: '$updatedAtRaw'")))
      case Some(expectedUpdatedAt) =>
        dataSourceRepo.findByIdOwned(id, user).flatMap {
          case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
          case Some(_: DatasetSource) =>
            val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
            dataSourceRepo.deleteRow(id, rowId, expectedUpdatedAt, now, user).map {
              case Left(RowMutationFailure.SourceNotFound)          => Left(ServiceError.NotFound("Data source not found"))
              case Left(RowMutationFailure.RowNotFound)             => Left(ServiceError.NotFound("Row not found"))
              case Left(RowMutationFailure.ValidationFailed(msg))   => Left(ServiceError.BadRequest(msg))
              case Left(RowMutationFailure.StalePrecondition(cur))  =>
                Left(ServiceError.Conflict(s"row $rowId was modified concurrently: expected updatedAt '$expectedUpdatedAt', current is '$cur'"))
              case Right(ds) =>
                audit("data_source.rows.delete", Some(ds.id.value), user)
                Right(())
            }
          case Some(_) => Future.successful(Left(ServiceError.BadRequest("row writes are only supported for dataset sources")))
        }
    }

  /** HEL-1121 design.md D6: precedence -- (1) a malformed `cursor`/`limit` query parameter is
   *  `400`, before any DB call; (2) the ACL-scoped source lookup (`findByIdOwned`, same as every
   *  other row route) is `404`; (3) the `dataset`-kind check is `400`; (4) success. `limit` is
   *  clamped to `Page.MaxLimit` (never rejected above the ceiling) and defaults to
   *  `Page.Default.limit` when absent (D3); a non-numeric, negative, or exactly-zero `limit` is
   *  rejected outright (D3: a `limit` of `0` would return zero rows per page while still
   *  reporting `nextCursor`/`total`, an infinite-loop trap). `cursor`, if present, must be a
   *  non-negative integer -- `0` is a valid `seq` value, not a sentinel for "unset" (D2 CR1). */
  def listRows(
      id:        DataSourceId,
      cursorRaw: Option[String],
      limitRaw:  Option[String],
      user:      AuthenticatedUser
  ): Future[Either[ServiceError, RowListResult]] =
    parseCursor(cursorRaw) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(cursor) =>
        parseLimit(limitRaw) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(limit) =>
            dataSourceRepo.findByIdOwned(id, user).flatMap {
              case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
              case Some(_: DatasetSource) =>
                dataSourceRepo.listRows(id, cursor, limit, user).map {
                  case None       => Left(ServiceError.NotFound("Data source not found"))
                  case Some(page) => Right(RowListResult.fromRepositoryPage(page))
                }
              case Some(_) => Future.successful(Left(ServiceError.BadRequest("row listing is only supported for dataset sources")))
            }
        }
    }

  /** HEL-1122 design.md Decision 1: 404 via `findByIdOwned` (not found/not owned, same ACL
   *  convention as every other row route), 400 naming the actual kind for a non-`dataset`-kind
   *  source, 200 with the declared field list otherwise. */
  def getDatasetSchema(id: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DatasetSchemaResponse]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(_: DatasetSource) =>
        dataSourceRepo.getDeclaredSchema(id, user).map {
          case None             => Left(ServiceError.NotFound("Data source not found"))
          case Some(declaration) => Right(DatasetSchemaResponse(declaration.map(DatasetFieldResponse.fromDomain)))
        }
      case Some(ds) => Future.successful(Left(ServiceError.BadRequest(s"declared schema is only available for dataset sources (this source is '${ds.kind}')")))
    }

  /** HEL-1124 design.md Decision 1/6: ACL via `findByIdOwned` (HEL-1002 404 shape, same as every
   *  sibling route), `400` for a non-`dataset`-kind source, delegates the actual
   *  migration/classification to `DataSourceRepository.updateDatasetSchema`, and maps its result
   *  to `200`/`400`(structural)/`409`(data-integrity). */
  def updateDatasetSchema(
      id:   DataSourceId,
      req:  UpdateDatasetSchemaRequest,
      user: AuthenticatedUser
  ): Future[Either[DataSourceSchemaUpdateError, DatasetSchemaUpdateResponse]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case None => Future.successful(Left(DataSourceSchemaUpdateError.plain(ServiceError.NotFound("Data source not found"))))
      case Some(_: DatasetSource) =>
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        dataSourceRepo.updateDatasetSchema(id, req.fields, req.confirmDrop, now, user).map {
          case None => Left(DataSourceSchemaUpdateError.plain(ServiceError.NotFound("Data source not found")))
          case Some(Left(DatasetSchemaMigration.SchemaUpdateRejection.Structural(messages))) =>
            Left(DataSourceSchemaUpdateError.plain(ServiceError.BadRequest(messages.mkString("; "))))
          case Some(Left(DatasetSchemaMigration.SchemaUpdateRejection.DataIntegrity(rejectedFields))) =>
            val body = SchemaUpdateConflictResponse(
              rejectedFields = rejectedFields.map(r => SchemaFieldRejection(r.name, r.reason)),
              message        = rejectedFields.map(r => s"${r.name}: ${r.reason}").mkString("; ")
            )
            Left(DataSourceSchemaUpdateError.conflict(body))
          case Some(Right(migration)) =>
            audit("data_source.schema.update", Some(id.value), user)
            Right(DatasetSchemaUpdateResponse(migration.newDeclaration.map(DatasetFieldResponse.fromDomain), migration.rowsMigrated))
        }
      case Some(_) =>
        Future.successful(Left(DataSourceSchemaUpdateError.plain(ServiceError.BadRequest("declared schema updates are only supported for dataset sources"))))
    }

  private def parseCursor(raw: Option[String]): Either[String, Option[Long]] = raw match {
    case None => Right(None)
    case Some(s) =>
      Try(s.toLong).toOption match {
        case Some(v) if v >= 0 => Right(Some(v))
        case _                 => Left(s"cursor must be a non-negative integer: '$s'")
      }
  }

  private def parseLimit(raw: Option[String]): Either[String, Int] = raw match {
    case None => Right(Page.Default.limit)
    case Some(s) =>
      Try(s.toInt).toOption match {
        case Some(v) if v > 0 => Right(math.min(v, Page.MaxLimit))
        case _                => Left(s"limit must be a positive integer: '$s'")
      }
  }

  /** Parses a request-supplied `updatedAt` value with the same `Instant.parse` convention every
   *  row-write response's `updatedAt` field round-trips through (design.md D4) -- `None` on any
   *  parse failure, mapped by callers to `400` before any DB call (D6 step 1). */
  private def parseInstant(raw: String): Option[Instant] =
    Try(Instant.parse(raw)).toOption

  /** Refresh a CSV source (HEL-862): re-read the stored file when it was
   *  upload/inline-created (`sourceUrl` is `None`, byte-for-byte the
   *  pre-existing behaviour including the `NoSuchFileException` message), or
   *  re-fetch via the shared [[CsvUrlFetch]] helper and overwrite the stored
   *  snapshot when it was URL-created (`sourceUrl` is `Some(url)`). */
  private def refreshCsv(source: CsvSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    source.config.sourceUrl match {
      case None =>
        if (source.config.path.isEmpty)
          Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
        else
          fileSystem.read(source.config.path).flatMap { bytes =>
            finishCsvRefresh(source, bytes, user)
          }.recover {
            case _: java.nio.file.NoSuchFileException =>
              Left(ServiceError.BadRequest(
                "Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."
              ))
          }
      case Some(url) =>
        CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost, isBlocked).flatMap {
          case Left(err) =>
            Future.successful(Left(csvUrlErrorToServiceError(err)))
          case Right(bytes) =>
            fileSystem.write(source.config.path, bytes).flatMap(_ => finishCsvRefresh(source, bytes, user))
        }
    }

  private def finishCsvRefresh(source: CsvSource, bytes: Array[Byte], user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
    val csv    = new String(bytes, StandardCharsets.UTF_8)
    val schema = SchemaInferenceEngine.fromCsv(csv)
    val now    = Instant.now()
    val fields = schema.fields.map(f =>
      DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
    ).toVector
    upsertSourceDataType(source, fields, user, now).map(_ => Right(source))
  }

  /** Refresh a text source (HEL-215): re-read the stored file when it was
   *  upload-created (`sourceUrl` is `None`), or re-fetch and overwrite the
   *  stored file when it was URL-created (`sourceUrl` is `Some(url)`). Either
   *  way, the linked DataType's fixed `{content, filename, sizeBytes}` schema
   *  is re-upserted (values only change on the next pipeline run, per the
   *  pipeline-only-bindings invariant). */
  private def refreshText(source: TextSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    source.config.sourceUrl match {
      case None =>
        if (source.config.path.isEmpty)
          Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
        else
          fileSystem.read(source.config.path).flatMap { bytes =>
            finishTextRefresh(source, bytes, user)
          }.recover {
            case _: java.nio.file.NoSuchFileException =>
              Left(ServiceError.BadRequest(
                "Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."
              ))
          }
      case Some(url) =>
        ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(err)))
          case Right(bytes) =>
            if (bytes.length.toLong > textMaxBytes)
              Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $textMaxBytes bytes")))
            else
              fileSystem.write(source.config.path, bytes).flatMap(_ => finishTextRefresh(source, bytes, user))
        }
    }

  private def finishTextRefresh(source: TextSource, bytes: Array[Byte], user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
    val now      = Instant.now()
    val filename = Paths.get(source.config.path).getFileName.toString
    val fields   = ContentSourceSupport.metadataFields(DataFieldType.StringBodyType, filename, bytes.length.toLong)
    upsertSourceDataType(source, fields, user, now).map(_ => Right(source))
  }

  /** Refresh a PDF source (HEL-214): re-read the stored file when it was
   *  upload-created (`sourceUrl` is `None`), or re-fetch and overwrite the
   *  stored file when it was URL-created (`sourceUrl` is `Some(url)`). Either
   *  way, the refreshed bytes are re-validated via `PdfTextSupport.validate`
   *  (catches a file that's become corrupt/encrypted on disk/upstream since
   *  ingest-time validation) before the linked DataType's fixed field schema
   *  is re-upserted. */
  private def refreshPdf(source: PdfSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    source.config.sourceUrl match {
      case None =>
        if (source.config.path.isEmpty)
          Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
        else
          fileSystem.read(source.config.path).flatMap { bytes =>
            finishPdfRefresh(source, bytes, user)
          }.recover {
            case _: java.nio.file.NoSuchFileException =>
              Left(ServiceError.BadRequest(
                "Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."
              ))
          }
      case Some(url) =>
        ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(err)))
          case Right(bytes) =>
            if (bytes.length.toLong > pdfMaxBytes)
              Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $pdfMaxBytes bytes")))
            else
              fileSystem.write(source.config.path, bytes).flatMap(_ => finishPdfRefresh(source, bytes, user))
        }
    }

  private def finishPdfRefresh(source: PdfSource, bytes: Array[Byte], user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    PdfTextSupport.validate(bytes) match {
      case Left(msg) =>
        Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(_) =>
        val now      = Instant.now()
        val filename = Paths.get(source.config.path).getFileName.toString
        val fields   = pdfFields(filename, bytes.length.toLong)
        upsertSourceDataType(source, fields, user, now).map(_ => Right(source))
    }

  /** Refresh an image source (HEL-216): re-read the stored file when it was
   *  upload-created (`sourceUrl` is `None`), or re-fetch and overwrite the
   *  stored file when it was URL-created (`sourceUrl` is `Some(url)`). Either
   *  way, the linked DataType's fixed schema is re-upserted and
   *  `width`/`height`/`mimeType` are re-derived from the (re-read or
   *  re-fetched) bytes. */
  private def refreshImage(source: ImageSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    source.config.sourceUrl match {
      case None =>
        if (source.config.path.isEmpty)
          Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
        else
          fileSystem.read(source.config.path).flatMap { bytes =>
            finishImageRefresh(source, bytes, user)
          }.recover {
            case _: java.nio.file.NoSuchFileException =>
              Left(ServiceError.BadRequest(
                "Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."
              ))
          }
      case Some(url) =>
        ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked).flatMap {
          case Left(err) =>
            Future.successful(Left(ServiceError.BadGateway(err)))
          case Right(bytes) =>
            if (bytes.length.toLong > imageMaxBytes)
              Future.successful(Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $imageMaxBytes bytes")))
            else
              fileSystem.write(source.config.path, bytes).flatMap(_ => finishImageRefresh(source, bytes, user))
        }
    }

  private def finishImageRefresh(source: ImageSource, bytes: Array[Byte], user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
    val filename = Paths.get(source.config.path).getFileName.toString
    ImageSourceSupport.dimensionsAndMime(bytes, filename) match {
      case Left(msg) =>
        Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right((_, _, _)) =>
        val now    = Instant.now()
        val fields = ContentSourceSupport.metadataFields(DataFieldType.BinaryRefType, filename, bytes.length.toLong) ++
          Vector(
            DataField("width", "Width", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
            DataField("height", "Height", DataFieldType.asString(DataFieldType.IntegerType), nullable = false),
            DataField("mimeType", "MIME Type", DataFieldType.asString(DataFieldType.StringType), nullable = false)
          )
        upsertSourceDataType(source, fields, user, now).map(_ => Right(source))
    }
  }

  /** HEL-904 (design.md line 92): writes the re-inferred schema straight onto the source's own
   *  `inferred_schema` column — there is no companion `DataType` row to find-or-create anymore,
   *  so this is a plain upsert onto `source.id` via `DataSourceRepository.upsertInferredSchema`.
   *  Still the recovery primitive that lets the Sources page "Refresh" affordance heal orphan
   *  state (HEL-256's original motivation), just against a column instead of a linked row. */
  private def upsertSourceDataType(
      source: DataSource,
      fields: Vector[DataField],
      user: AuthenticatedUser,
      now: Instant
  ): Future[DataSource] =
    dataSourceRepo.upsertInferredSchema(source.id, fields.map(f => SchemaField(f.name, f.dataType)), now, user)
      .map(_.getOrElse(source))


  def preview(sourceId: DataSourceId, limit: Int, user: AuthenticatedUser): Future[Either[ServiceError, CsvPreviewResponse]] = {
    val clampedLimit = math.max(1, math.min(500, limit))
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(s: DatasetSource) =>
        previewStatic(s).map(Right(_))
      case Some(c: CsvSource) =>
        previewCsv(c, clampedLimit)
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("preview is only supported for csv and static sources")))
    }
  }

  // HEL-1074: swapped off `readRawConfig`/`config` onto `dataset_rows` (Decision 9) -- `config`
  // is cleared to `{}` for every migrated `dataset`-kind source.
  private def previewStatic(source: DatasetSource): Future[CsvPreviewResponse] =
    dataSourceRepo.readDatasetRows(source.id).map {
      case None => CsvPreviewResponse(Vector.empty, Vector.empty)
      case Some(obj) =>
        val headers = obj.fields.get("columns")
          .map(_.convertTo[Vector[StaticColumnPayload]].map(_.name))
          .getOrElse(Vector.empty)
        val rows = obj.fields.get("rows")
          .map(_.convertTo[Vector[Vector[JsValue]]].map(_.map {
            case JsString(s)  => s
            case JsNumber(n)  => n.toString
            case JsBoolean(b) => b.toString
            case JsNull       => ""
            case other        => other.compactPrint
          }))
          .getOrElse(Vector.empty)
        CsvPreviewResponse(headers, rows)
    }

  private def previewCsv(source: CsvSource, limit: Int): Future[Either[ServiceError, CsvPreviewResponse]] =
    if (source.config.path.isEmpty)
      Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
    else
      fileSystem.read(source.config.path).map { bytes =>
        val csv             = new String(bytes, StandardCharsets.UTF_8)
        val (headers, rows) = SchemaInferenceEngine.parseCsvRows(csv, maxRows = limit)
        Right(CsvPreviewResponse(headers, rows)): Either[ServiceError, CsvPreviewResponse]
      }.recover {
        case _: java.nio.file.NoSuchFileException =>
          Left(ServiceError.NotFound("Data file not found; the source may need to be re-uploaded"))
        case _ =>
          Left(ServiceError.InternalError("Failed to read data file"))
      }


  /** Schema inference from a raw CSV byte array. The route layer is
   *  responsible for unmarshalling the multipart form. */
  def infer(bytes: Array[Byte]): Either[ServiceError, InferredSchemaResponse] =
    DataSourceCsvSupport.decodeUtf8(bytes) match {
      case None =>
        Left(ServiceError.BadRequest("File must be UTF-8 encoded"))
      case Some(csvContent) =>
        val schema = SchemaInferenceEngine.fromCsv(csvContent)
        val fields = schema.fields.map(f =>
          InferredFieldResponse(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
        ).toVector
        Right(InferredSchemaResponse(fields))
    }
}

object DataSourceService {
  /** Parse a Vector[FieldOverridePayload] from raw JSON bytes (sent in the
   *  CSV upload multipart). Returns an empty vector on parse failure to
   *  match the pre-CS2b behaviour. */
  def parseFieldOverrides(jsonBytes: String): Vector[FieldOverridePayload] =
    Try(jsonBytes.parseJson.convertTo[Vector[FieldOverridePayload]]).toOption.getOrElse(Vector.empty)
}

/** HEL-1077 design.md D6: one persisted row's `id`/`seq`/`updatedAt` -- deliberately NOT the raw
 *  `DatasetRowRow` (never leaks the infra row's `data`/`dataSourceId` fields to the route layer)
 *  and never includes row `data` itself (design.md D6: HEL-1080's grid reads rows through the
 *  existing read path; echoing the request back adds nothing this ticket's consumers need). */
final case class RowWriteRow(id: String, seq: Long, updatedAt: Instant)

/** Result of `DataSourceService.appendRows`/`replaceRows`: the affected rows (append: only the
 *  newly appended ones; replace: the full new set) plus the source, so the route can read both
 *  the per-row and the source-level `updatedAt` (design.md D6). */
final case class RowWriteResult(source: DataSource, rows: Vector[RowWriteRow])

object RowWriteResult {
  def fromRepositoryRows(source: DataSource, rows: Vector[DatasetRowRow]): RowWriteResult =
    RowWriteResult(source, rows.map(r => RowWriteRow(r.id, r.seq, r.updatedAt)))
}

/** HEL-1121 design.md D1/D4: one page of `DataSourceService.listRows` -- the trimmed, in-order
 *  `DatasetRowRow`s (raw infra rows; the route/protocol layer projects them into `RowResponseRow`
 *  per D4), the seq-cursor for the next request (`None` at the end of the row set, D2), and the
 *  source's total row count (D7). */
final case class RowListResult(rows: Vector[DatasetRowRow], nextCursor: Option[Long], total: Int)

object RowListResult {
  def fromRepositoryPage(page: RowListPage): RowListResult =
    RowListResult(page.rows, page.nextCursor, page.total)
}

/** HEL-1078 design.md D8: result of a successful `patchRow` -- the edited row's `id`/`seq`/
 *  `updatedAt`/full `data` (unlike `RowWriteRow`, PATCH's response DOES echo `data` back, since
 *  the caller submitted the full row and the response confirms exactly what was persisted --
 *  design.md D8) plus the source, so the route can build `RowResponse`'s `sourceUpdatedAt`. */
final case class RowMutationResult(source: DataSource, rowId: String, seq: Long, rowUpdatedAt: Instant, data: Vector[JsValue])

object RowMutationResult {
  def fromRepositoryRow(source: DataSource, row: DatasetRowRow): RowMutationResult =
    RowMutationResult(source, row.id, row.seq, row.updatedAt, row.data.parseJson.asInstanceOf[JsArray].elements)
}
