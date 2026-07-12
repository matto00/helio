package com.helio.infrastructure

import com.helio.domain.{ImageUpload, ImageUploadId, UserId}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for standalone panel-literal image upload metadata (HEL-246).
 *
 *  Pool selection per method is intentionally asymmetric — see design.md
 *  Decisions 2 and 3:
 *
 *  - `insert` is a request-bound user action and runs under
 *    [[DbContext.withUserContext]], so the `image_uploads_owner` RLS policy's
 *    implicit WITH CHECK rejects any row whose `owner_id` is not the caller.
 *  - `findById` backs the unauthenticated byte-serving GET route, which has
 *    no `AuthenticatedUser` to scope a read with. It runs under
 *    [[DbContext.withSystemContext]] (privileged pool), intentionally
 *    bypassing the owner policy so the endpoint stays servable without auth. */
class ImageUploadRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import ImageUploadRepository._

  private val uploads = TableQuery[ImageUploadTable]

  /** Insert a new upload row for its owner. */
  def insert(upload: ImageUpload): Future[ImageUpload] =
    ctx.withUserContext(upload.ownerId.value)(uploads += toRow(upload)).map(_ => upload)

  /** Privileged callsite: backs `GET /api/uploads/image/:id`, which is
   *  deliberately unauthenticated (see design.md Decision 2) — no
   *  `AuthenticatedUser` exists at this point in the request to scope the
   *  read, so bypassing the owner policy via the privileged pool is correct. */
  def findById(id: ImageUploadId): Future[Option[ImageUpload]] =
    ctx.withSystemContext(uploads.filter(_.id === id.value).result.headOption).map(_.map(rowToDomain))

  private def toRow(upload: ImageUpload): ImageUploadRow =
    ImageUploadRow(
      id         = upload.id.value,
      ownerId    = UUID.fromString(upload.ownerId.value),
      storageKey = upload.storageKey,
      mimeType   = upload.mimeType,
      filename   = upload.filename,
      sizeBytes  = upload.sizeBytes,
      createdAt  = upload.createdAt
    )

  private def rowToDomain(row: ImageUploadRow): ImageUpload =
    ImageUpload(
      id         = ImageUploadId(row.id),
      ownerId    = UserId(row.ownerId.toString),
      storageKey = row.storageKey,
      mimeType   = row.mimeType,
      filename   = row.filename,
      sizeBytes  = row.sizeBytes,
      createdAt  = row.createdAt
    )
}

object ImageUploadRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  final case class ImageUploadRow(
      id: String,
      ownerId: UUID,
      storageKey: String,
      mimeType: String,
      filename: String,
      sizeBytes: Long,
      createdAt: Instant
  )

  class ImageUploadTable(tag: Tag) extends Table[ImageUploadRow](tag, "image_uploads") {
    def id         = column[String]("id", O.PrimaryKey)
    def ownerId    = column[UUID]("owner_id")
    def storageKey = column[String]("storage_key")
    def mimeType   = column[String]("mime_type")
    def filename   = column[String]("filename")
    def sizeBytes  = column[Long]("size_bytes")
    def createdAt  = column[Instant]("created_at")
    def * = (id, ownerId, storageKey, mimeType, filename, sizeBytes, createdAt) <> (ImageUploadRow.tupled, ImageUploadRow.unapply)
  }
}
