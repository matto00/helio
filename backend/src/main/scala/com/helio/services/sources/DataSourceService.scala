package com.helio.services.sources

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.domain.engine.{PipelineRowJson, SchemaField, SchemaInferenceEngine}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.stream.Materializer
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.sources.{CsvPreviewResponse, FieldOverridePayload, InferredFieldResponse, InferredSchemaResponse, StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import SourceConfigParsing._
import spray.json._

import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Paths
import java.time.Instant
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
      val now      = Instant.now()
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val source   = StaticSource(
        id        = sourceId,
        name      = req.name.trim,
        ownerId   = user.id,
        createdAt = now,
        updatedAt = now,
        tag       = tag
      )
      // StaticSource is identity-only in the ADT; the {columns, rows} payload
      // is written to the `config` column directly via a static-payload-aware
      // update so the engine + Spark submitter (which consume the raw blob)
      // continue to work without further changes.
      val payload = JsObject("columns" -> req.columns.toJson, "rows" -> req.rows.toJson)
      // HEL-893 design D2: the registered schema reports the type the stored rows actually
      // materialize (via `PipelineRowJson.staticColumnRuntimeType`, the same conversion
      // `parseStaticRows` applies), not the caller-declared `columns[].type` -- that declared
      // type was never consulted when materializing rows and could disagree with every cell.
      val fields  = req.columns.zipWithIndex.map { case (col, i) =>
        val cells = req.rows.map(_.lift(i).getOrElse(JsNull))
        SchemaField(col.name, PipelineRowJson.staticColumnRuntimeType(col.`type`, cells))
      }.toVector
      dataSourceRepo.insert(source, user).flatMap { _ =>
        dataSourceRepo.updateStaticPayload(sourceId, source.name, payload, now, user).flatMap {
          case None => Future.failed(new RuntimeException("Static source disappeared between insert and update"))
          case Some(ds) =>
            dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user).map { updated =>
              audit("data_source.create", Some(ds.id.value), user)
              Right(updated.getOrElse(ds))
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
              case s: StaticSource => s.copy(name = newName, updatedAt = now)
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

  def delete(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(source) =>
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
        }
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
      case Some(s: StaticSource) =>
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

  private def applyStaticRefresh(source: StaticSource, payload: StaticDataPayload, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
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
      val now     = Instant.now()
      val payloadJson = JsObject("columns" -> payload.columns.toJson, "rows" -> payload.rows.toJson)
      // HEL-893 design D4/tasks.md 2.3: refresh must correct the schema exactly like create --
      // without this, a static source's declared-vs-runtime disagreement survives every refresh,
      // making D4's "corrected on next refresh" promise false for static sources.
      val fields = payload.columns.zipWithIndex.map { case (col, i) =>
        val cells = payload.rows.map(_.lift(i).getOrElse(JsNull))
        val runtimeType = PipelineRowJson.staticColumnRuntimeType(col.`type`, cells)
        DataField(col.name, col.name, runtimeType, nullable = true)
      }
      dataSourceRepo.updateStaticPayload(source.id, source.name, payloadJson, now, user).flatMap {
        case None     => Future.failed(new RuntimeException("Source disappeared during update"))
        case Some(ds) => upsertSourceDataType(ds, fields, user, now).map(_ => Right(ds))
      }
    }
  }

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
      case Some(s: StaticSource) =>
        previewStatic(s).map(Right(_))
      case Some(c: CsvSource) =>
        previewCsv(c, clampedLimit)
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("preview is only supported for csv and static sources")))
    }
  }

  private def previewStatic(source: StaticSource): Future[CsvPreviewResponse] =
    dataSourceRepo.readRawConfig(source.id).map {
      case None => CsvPreviewResponse(Vector.empty, Vector.empty)
      case Some(raw) =>
        val obj     = DataSourceRepository.parseStaticPayload(raw)
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
