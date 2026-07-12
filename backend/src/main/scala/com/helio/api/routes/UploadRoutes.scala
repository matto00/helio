package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{Multipart, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.apache.pekko.stream.scaladsl.Sink
import com.helio.api._
import com.helio.domain.AuthenticatedUser
import com.helio.services.ImageUploadService

import scala.concurrent.ExecutionContextExecutor
import scala.concurrent.duration.DurationInt

/** Authenticated multipart upload for standalone panel-literal images
 *  (HEL-246). Mirrors `DataSourceRoutes.createMultipartUploadRoute`'s
 *  `Multipart.FormData` collection pattern, scoped to a single `file` part —
 *  no `name`/`type` discriminator is needed since every upload through this
 *  endpoint is an image. The byte-serving counterpart is
 *  [[PublicUploadRoutes]] (unauthenticated). */
final class UploadRoutes(
    imageUploadService: ImageUploadService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext
  private implicit val mat: Materializer                         = SystemMaterializer(system).materializer

  /** Early route-layer rejection, mirroring `DataSourceRoutes`'s per-connector
   *  `xMaxBytes` checks. `ImageUploadService.upload`'s own check is the
   *  authoritative one — see design.md Decision 5. */
  private val imageUploadMaxBytes: Long =
    sys.env.get("IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(10485760L)

  val routes: Route =
    pathPrefix("uploads" / "image") {
      pathEndOrSingleSlash {
        post {
          entity(as[Multipart.FormData]) { formData =>
            val collectedF =
              formData.parts
                .mapAsync(1)(p => p.toStrict(60.seconds).map(s => (p.name, s.entity.data, p.filename)))
                .runWith(Sink.seq)
            onSuccess(collectedF) { parts =>
              val filePart = parts.collectFirst { case ("file", data, filenameOpt) => (data, filenameOpt) }
              filePart match {
                case None =>
                  complete(StatusCodes.BadRequest, ErrorResponse("file is required"))
                case Some((data, filenameOpt)) =>
                  val bytes    = data.toArray
                  val filename = filenameOpt.getOrElse("")
                  if (bytes.length.toLong > imageUploadMaxBytes)
                    complete(
                      StatusCodes.RequestEntityTooLarge,
                      ErrorResponse(s"File exceeds the maximum allowed size of $imageUploadMaxBytes bytes")
                    )
                  else
                    ServiceResponse.run(imageUploadService.upload(bytes, filename, user)) { upload =>
                      StatusCodes.Created -> ImageUploadResponse(upload.id.value, s"/api/uploads/image/${upload.id.value}")
                    }
              }
            }
          }
        }
      }
    }
}
