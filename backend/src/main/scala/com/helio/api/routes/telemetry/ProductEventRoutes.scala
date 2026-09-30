package com.helio.api.routes.telemetry

import com.helio.api._
import com.helio.api.http.RateLimitDirective
import com.helio.api.routes.ServiceResponse
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.telemetry.ProductEventService
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import spray.json._

/** Thin HTTP shell for `POST /api/events` (HEL-1208). Write-only: there is deliberately no read
 *  endpoint. The rate limit is applied INSIDE the matched `pathPrefix`, never wrapped around the
 *  whole route value, so a request this class rejects never consumes budget (same reasoning as
 *  `SourcePreviewRoutes`). `rateLimitDirective` is its own instance, separate from the general
 *  `/api` limiter, so the two budgets do not share a bucket. */
final class ProductEventRoutes(
    service: ProductEventService,
    user: AuthenticatedUser,
    rateLimitDirective: RateLimitDirective,
    rateLimitPerWindow: Int
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  val routes: Route =
    pathPrefix("events") {
      pathEndOrSingleSlash {
        post {
          rateLimitDirective.rateLimit(rateLimitPerWindow) {
            entity(as[JsValue]) { body =>
              ServiceResponse.run(service.ingest(user.id, body))(accepted =>
                StatusCodes.Accepted -> JsObject("accepted" -> JsNumber(accepted))
              )
            }
          }
        }
      }
    }
}
