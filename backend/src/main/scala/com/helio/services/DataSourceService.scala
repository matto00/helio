package com.helio.services

import org.apache.pekko.stream.Materializer
import com.helio.api.protocols.{
  CsvPreviewResponse,
  FieldOverridePayload,
  InferredFieldResponse,
  InferredSchemaResponse,
  StaticColumnPayload,
  StaticDataPayload,
  StaticDataSourceRequest,
  UpdateDataSourceRequest
}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, FileSystem}
import SourceConfigParsing._
import spray.json._

import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** Business logic for CSV + Static data sources.
 *
 *  CSV inserts and previews carry raw bytes (already unmarshalled by the route
 *  layer from `Multipart.FormData`) so the service stays free of Pekko HTTP
 *  types. `Materializer` is passed explicitly because the CSV write path uses
 *  `fileSystem.write` which may internally stream. */
final class DataSourceService(
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo:   DataTypeRepository,
    fileSystem:     FileSystem
)(implicit ec: ExecutionContext, @annotation.unused mat: Materializer) {

  private val staticMaxRows = 500

  // ── Read ──────────────────────────────────────────────────────────────────

  def findAll(user: AuthenticatedUser): Future[Vector[DataSource]] =
    dataSourceRepo.findAll(user.id)

  // ── Create (Static) ───────────────────────────────────────────────────────

  def createStatic(req: StaticDataSourceRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (req.rows.size > staticMaxRows)
      Future.successful(Left(ServiceError.BadRequest(s"Payload exceeds the maximum of $staticMaxRows rows")))
    else {
      val now      = Instant.now()
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val source   = StaticSource(
        id        = sourceId,
        name      = req.name.trim,
        ownerId   = user.id,
        createdAt = now,
        updatedAt = now
      )
      // StaticSource is identity-only in the ADT; the {columns, rows} payload
      // is written to the `config` column directly via a static-payload-aware
      // update so the engine + Spark submitter (which consume the raw blob)
      // continue to work without further changes.
      val payload = JsObject("columns" -> req.columns.toJson, "rows" -> req.rows.toJson)
      dataSourceRepo.insert(source, user).flatMap { _ =>
        dataSourceRepo.updateStaticPayload(sourceId, source.name, payload, now, user).flatMap {
          case None => Future.failed(new RuntimeException("Static source disappeared between insert and update"))
          case Some(ds) =>
            val dataType = DataType(
              id        = DataTypeId(UUID.randomUUID().toString),
              sourceId  = Some(ds.id),
              name      = req.name.trim,
              fields    = req.columns.map(col => DataField(col.name, col.name, col.`type`, nullable = true)),
              version   = 1,
              createdAt = now,
              updatedAt = now,
              ownerId   = user.id
            )
            dataTypeRepo.insert(dataType, user).map(_ => Right(ds))
        }
      }
    }

  // ── Create (CSV) ──────────────────────────────────────────────────────────

  def createCsv(
      name: String,
      bytes: Array[Byte],
      overrides: Vector[FieldOverridePayload],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, DataSource]] =
    DataSourceCsvSupport.decodeUtf8(bytes) match {
      case None =>
        Future.successful(Left(ServiceError.BadRequest("File must be UTF-8 encoded")))
      case Some(csvContent) =>
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
          config    = CsvSourceConfig(filePath)
        )
        fileSystem.write(filePath, bytes).flatMap { _ =>
          dataSourceRepo.insert(source, user).flatMap { ds =>
            val dt = DataType(
              id        = DataTypeId(UUID.randomUUID().toString),
              sourceId  = Some(ds.id),
              name      = name,
              fields    = schema.fields.map { f =>
                val ov = overridesMap.get(f.name)
                DataField(
                  f.name,
                  ov.map(_.displayName).getOrElse(f.displayName),
                  ov.map(_.dataType).getOrElse(DataFieldType.asString(f.dataType)),
                  f.nullable
                )
              }.toVector,
              version   = 1,
              createdAt = now,
              updatedAt = now,
              ownerId   = user.id
            )
            dataTypeRepo.insert(dt, user).map(_ => Right(ds))
          }
        }
    }

  // ── Update / delete ───────────────────────────────────────────────────────

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
            }
            dataSourceRepo.update(updated, user).map {
              case None     => Left(ServiceError.NotFound("Data source not found"))
              case Some(ds) => Right(ds)
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
          case _ => Future.successful(())
        }
        deleteFileF.flatMap(_ => dataSourceRepo.delete(source.id, user)).map(_ => Right(()))
    }

  // ── Refresh ───────────────────────────────────────────────────────────────

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
      case Some(_) =>
        Future.successful(Left(ServiceError.BadRequest("refresh is only supported for csv and static sources")))
    }

  private def applyStaticRefresh(source: StaticSource, payload: StaticDataPayload, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] = {
    val now     = Instant.now()
    val payloadJson = JsObject("columns" -> payload.columns.toJson, "rows" -> payload.rows.toJson)
    val fields = payload.columns.map(col => DataField(col.name, col.name, col.`type`, nullable = true))
    dataSourceRepo.updateStaticPayload(source.id, source.name, payloadJson, now, user).flatMap {
      case None     => Future.failed(new RuntimeException("Source disappeared during update"))
      case Some(ds) => upsertSourceDataType(ds, fields, user, now).map(_ => Right(ds))
    }
  }

  private def refreshCsv(source: CsvSource, user: AuthenticatedUser): Future[Either[ServiceError, DataSource]] =
    if (source.config.path.isEmpty)
      Future.successful(Left(ServiceError.InternalError("Source config is missing path")))
    else
      fileSystem.read(source.config.path).flatMap { bytes =>
        val csv    = new String(bytes, StandardCharsets.UTF_8)
        val schema = SchemaInferenceEngine.fromCsv(csv)
        val now    = Instant.now()
        val fields = schema.fields.map(f =>
          DataField(f.name, f.displayName, DataFieldType.asString(f.dataType), f.nullable)
        ).toVector
        upsertSourceDataType(source, fields, user, now).map(_ => Right(source))
      }.recover {
        case _: java.nio.file.NoSuchFileException =>
          Left(ServiceError.BadRequest(
            "Source file is missing on disk; the source can no longer be refreshed. Delete this source and re-upload the file."
          ))
      }

  /** Update the source's auto-inferred DataType in place, or insert a fresh
   *  one if no DT exists for the source. Inserts preserve the link via
   *  `sourceId = Some(source.id)`. This is the recovery primitive that lets
   *  the Sources page "Refresh" affordance heal orphan state introduced by
   *  pre-Fix-B′ DT deletions (HEL-256). */
  private def upsertSourceDataType(
      source: DataSource,
      fields: Vector[DataField],
      user: AuthenticatedUser,
      now: Instant
  ): Future[DataType] =
    dataTypeRepo.findBySourceId(source.id, user.id).flatMap { types =>
      types.headOption match {
        case Some(dt) =>
          val updated = dt.copy(fields = fields, updatedAt = now)
          dataTypeRepo.update(updated, user).map(_.getOrElse(updated))
        case None =>
          val fresh = DataType(
            id        = DataTypeId(UUID.randomUUID().toString),
            sourceId  = Some(source.id),
            name      = source.name,
            fields    = fields,
            version   = 1,
            createdAt = now,
            updatedAt = now,
            ownerId   = user.id
          )
          dataTypeRepo.insert(fresh, user)
      }
    }

  // ── Preview ───────────────────────────────────────────────────────────────

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

  // ── Infer ─────────────────────────────────────────────────────────────────

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
