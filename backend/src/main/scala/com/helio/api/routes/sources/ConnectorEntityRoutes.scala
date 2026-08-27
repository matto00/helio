package com.helio.api.routes.sources

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.api.protocols.IdParsing.ConnectorIdSegment
import com.helio.domain.model._
import com.helio.services.sources.ConnectorEntityService
import spray.json._

import scala.concurrent.ExecutionContextExecutor
import scala.util.{Failure, Success, Try}

/** Thin HTTP shell for `/api/connectors` (HEL-821) -- the Connector *entity*
 *  CRUD surface. Distinct from [[ConnectorRoutes]] (`GET /api/connector-types`,
 *  HEL-484/825): that class is untouched, this one is new and separately
 *  named (design.md Decision 7). All logic in [[ConnectorEntityService]]. */
final class ConnectorEntityRoutes(
    connectorService: ConnectorEntityService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  /** Field names task 3.3 / design.md Decision 3 rejects on update -- a
   *  request that includes any of these is refused with 400 rather than
   *  silently ignored, so a caller can never believe a credential rotation
   *  happened via PATCH when it didn't. */
  private val forbiddenUpdateFields = Set("credential", "secret", "credentialValue", "apiKey", "password")

  val routes: Route =
    pathPrefix("connectors") {
      concat(
        pathEndOrSingleSlash {
          concat(
            get {
              onSuccess(connectorService.findAll(user)) { connectors =>
                complete(ConnectorsResponse(connectors.map(ConnectorMeta.fromDomain)))
              }
            },
            post {
              entity(as[CreateConnectorRequest]) { request =>
                ServiceResponse.run(connectorService.create(request, user)) { connector =>
                  StatusCodes.Created -> ConnectorMeta.fromDomain(connector)
                }
              }
            }
          )
        },
        path(ConnectorIdSegment) { id =>
          concat(
            get {
              ServiceResponse.run(connectorService.findById(id, user))(ConnectorMeta.fromDomain)
            },
            patch {
              entity(as[JsValue]) { json =>
                val presentForbidden = json.asJsObject.fields.keySet.intersect(forbiddenUpdateFields)
                if (presentForbidden.nonEmpty)
                  complete(
                    StatusCodes.BadRequest,
                    ErrorResponse(
                      s"Credential rotation is not supported via update; got forbidden field(s): ${presentForbidden.mkString(", ")}"
                    )
                  )
                else
                  Try(json.convertTo[UpdateConnectorRequest]) match {
                    case Success(request) =>
                      ServiceResponse.run(connectorService.update(id, request, user))(ConnectorMeta.fromDomain)
                    case Failure(e) =>
                      complete(StatusCodes.BadRequest, ErrorResponse(e.getMessage))
                  }
              }
            },
            delete {
              ServiceResponse.runNoContent(connectorService.delete(id, user))
            }
          )
        }
      )
    }
}
