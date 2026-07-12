package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{ContentType, ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.protocols.IdParsing.ImageUploadIdSegment
import com.helio.services.ImageUploadService

import scala.concurrent.ExecutionContextExecutor

/** Unauthenticated byte-serving endpoint for uploaded panel-literal images
 *  (HEL-246): `GET /api/uploads/image/:id`. Mounted alongside
 *  `PublicDashboardRoutes` under `optionalAuthenticate` in `ApiRoutes` —
 *  a plain `<img src>` cannot carry the Bearer token the rest of the API
 *  requires, so the UUID id itself is the access capability (matching the
 *  pre-existing trust model where any external `imageUrl` was already
 *  fetched with no auth check). See design.md Decision 2. */
final class PublicUploadRoutes(
    imageUploadService: ImageUploadService
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("uploads" / "image" / ImageUploadIdSegment) { id =>
      get {
        onSuccess(imageUploadService.find(id)) {
          case None =>
            complete(StatusCodes.NotFound, ErrorResponse("Not found"))
          case Some((upload, bytes)) =>
            complete(HttpEntity(parseContentType(upload.mimeType), bytes))
        }
      }
    }

  /** `mimeType` always comes from `ImageUploadService`'s own controlled
   *  literal map (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), so
   *  this always parses — the fallback exists only as a defensive default. */
  private def parseContentType(mimeType: String): ContentType =
    ContentType.parse(mimeType).getOrElse(ContentTypes.`application/octet-stream`)
}
