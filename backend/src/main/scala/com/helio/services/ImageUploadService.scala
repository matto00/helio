package com.helio.services

import com.helio.domain.{AuthenticatedUser, ImageUpload, ImageUploadId}
import com.helio.infrastructure.{FileSystem, ImageUploadRepository}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for standalone panel-literal image uploads (HEL-246):
 *  extension validation, size enforcement, `FileSystem` write at
 *  `images/<uuid>.<ext>`, metadata persistence, and the read path for
 *  serving.
 *
 *  Deliberately does NOT reuse [[ImageSourceSupport.dimensionsAndMime]]
 *  (HEL-216's connector helper) for MIME derivation: its `ImageIO.read`
 *  decode path has no WebP reader on this JVM toolchain (`build.sbt` pulls in
 *  no WebP-capable plugin such as TwelveMonkeys) and would reject every valid
 *  `.webp` upload as "corrupt" — see design.md Decision 4. This service
 *  derives `mimeType` from its own small extension-keyed literal map instead
 *  and never decodes the image; no width/height is needed for a
 *  panel-literal upload. */
final class ImageUploadService(
    repo: ImageUploadRepository,
    fileSystem: FileSystem
)(implicit ec: ExecutionContext) {

  /** Narrower than `ContentSourceSupport.ImageExtensions` (which also permits
   *  `bmp`) — see design.md Decision 4. */
  val allowedExtensions: Set[String] = Set("png", "jpg", "jpeg", "gif", "webp")

  private val mimeTypeByExtension: Map[String, String] = Map(
    "png"  -> "image/png",
    "jpg"  -> "image/jpeg",
    "jpeg" -> "image/jpeg",
    "gif"  -> "image/gif",
    "webp" -> "image/webp"
  )

  /** Authoritative size check — see design.md Decision 5. The route layer
   *  performs the same check as a fast pre-rejection; this is the one
   *  guaranteed enforcement point. */
  private val maxBytes: Long =
    sys.env.get("IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(10485760L)

  def upload(bytes: Array[Byte], filename: String, user: AuthenticatedUser): Future[Either[ServiceError, ImageUpload]] =
    ContentSourceSupport.validateExtension(filename, allowedExtensions) match {
      case Left(msg) =>
        Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(ext) =>
        if (bytes.length.toLong > maxBytes)
          Future.successful(
            Left(ServiceError.PayloadTooLarge(s"File exceeds the maximum allowed size of $maxBytes bytes"))
          )
        else {
          val id         = ImageUploadId(UUID.randomUUID().toString)
          val storageKey = s"images/${id.value}.$ext"
          val mimeType   = mimeTypeByExtension.getOrElse(ext, "application/octet-stream")
          val upload = ImageUpload(
            id         = id,
            ownerId    = user.id,
            storageKey = storageKey,
            mimeType   = mimeType,
            filename   = filename,
            sizeBytes  = bytes.length.toLong,
            createdAt  = Instant.now()
          )
          fileSystem.write(storageKey, bytes).flatMap { _ =>
            repo.insert(upload).map(Right(_))
          }
        }
    }

  /** Serve path backing `GET /api/uploads/image/:id`: privileged metadata
   *  lookup (see [[ImageUploadRepository.findById]]) followed by a
   *  `FileSystem.read`. `None` (no matching id) maps to `404` at the route. */
  def find(id: ImageUploadId): Future[Option[(ImageUpload, Array[Byte])]] =
    repo.findById(id).flatMap {
      case None => Future.successful(None)
      case Some(upload) =>
        fileSystem.read(upload.storageKey).map(bytes => Some((upload, bytes)))
    }
}
