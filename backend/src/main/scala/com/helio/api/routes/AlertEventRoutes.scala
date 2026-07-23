package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.AlertEventIdSegment
import com.helio.domain._
import com.helio.services.AlertEventService

import java.time.Instant
import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/alerts`. All logic in [[AlertEventService]].
 *  `ServiceError.Conflict` (an illegal state-machine transition) is mapped to
 *  409 by `ServiceResponse` generically — no special-casing needed here. */
final class AlertEventRoutes(
    alertEventService: AlertEventService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    pathPrefix("alerts") {
      concat(
        pathEndOrSingleSlash {
          get {
            parameter("state".optional) { stateParam =>
              ServiceResponse.run(alertEventService.findAll(user, stateParam)) { events =>
                AlertEventsResponse(events.map(AlertEventResponse.fromDomain))
              }
            }
          }
        },
        path(AlertEventIdSegment) { id =>
          get {
            ServiceResponse.run(alertEventService.findById(id, user))(AlertEventResponse.fromDomain)
          }
        },
        path(AlertEventIdSegment / "acknowledge") { id =>
          post {
            ServiceResponse.run(alertEventService.acknowledge(id, user))(AlertEventResponse.fromDomain)
          }
        },
        path(AlertEventIdSegment / "snooze") { id =>
          post {
            entity(as[SnoozeAlertEventRequest]) { request =>
              Try(Instant.parse(request.snoozedUntil)) match {
                case Success(until) =>
                  ServiceResponse.run(alertEventService.snooze(id, until, user))(AlertEventResponse.fromDomain)
                case Failure(_) =>
                  complete(StatusCodes.BadRequest, ErrorResponse("snoozedUntil must be an ISO-8601 instant"))
              }
            }
          }
        },
        path(AlertEventIdSegment / "resolve") { id =>
          post {
            ServiceResponse.run(alertEventService.resolve(id, user))(AlertEventResponse.fromDomain)
          }
        }
      )
    }
}
