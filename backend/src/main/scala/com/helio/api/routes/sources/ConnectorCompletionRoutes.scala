package com.helio.api.routes.sources

import com.helio.api.routes.ServiceResponse
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.server.{Directives, Route}
import com.helio.api._
import com.helio.api.protocols.IdParsing.ConnectorIdSegment
import com.helio.api.protocols.sources.{CompletionRequest, CompletionTokenResponse, CreatePendingConnectorRequest, PendingConnectorAuthShapeResponse}
import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model.AuthenticatedUser
import com.helio.services.sources.ConnectorCompletionService

import scala.concurrent.ExecutionContextExecutor

/** `POST /api/connectors/completion` -- anonymous/optional-auth submission of a completion
 *  token + credential (HEL-955 design.md D5). Mounted beside `PublicDashboardRoutes` inside
 *  `authDirectives.optionalAuthenticate`, so it stays behind rate-limiting and CSRF but does not
 *  require a session -- that's the whole point of an out-of-band handoff. Token and credential
 *  travel in the body only, never the query string. */
final class ConnectorCompletionRoutes(
    completionService: ConnectorCompletionService,
    userOpt: Option[AuthenticatedUser]
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    path("connectors" / "completion") {
      concat(
        post {
          entity(as[CompletionRequest]) { request =>
            ServiceResponse.runNoContent(completionService.complete(request.token, request.credential, userOpt))
          }
        },
        // HEL-955 evaluation-1.md CR4: backs the completion page's form -- lets it render from
        // the pending Connector's actual intended auth shape (design.md D9) instead of asking
        // the human to guess-and-discard a selection. Same token, same query-param carrying
        // (never the credential -- there isn't one yet), same byte-identical refusal shape.
        get {
          parameter("token") { token =>
            ServiceResponse.run(completionService.describePending(token, userOpt)) { shape =>
              PendingConnectorAuthShapeResponse(shape.authType, shape.apiKeyName, shape.apiKeyPlacement)
            }
          }
        }
      )
    }
}

/** `POST /api/connectors/:id/completion-token` -- authenticated, owner-scoped re-mint
 *  (HEL-955 design.md D9). Mounted alongside `ConnectorEntityRoutes` in the authenticated tree. */
final class ConnectorCompletionTokenRoutes(
    completionService: ConnectorCompletionService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    path("connectors" / ConnectorIdSegment / "completion-token") { id =>
      post {
        ServiceResponse.run(completionService.ownerRemint(id, user)) { minted =>
          CompletionTokenResponse(minted.connectorId.value, minted.rawToken, minted.expiresAt.toString)
        }
      }
    }
}

/** `POST /api/connectors/pending` -- `create_connector`'s credentialed-host path (HEL-955 task
 *  5.1): creates (or re-mints onto, design.md D9) a pending Connector and mints its completion
 *  token in one call. Authenticated -- the agent's own session owns the resulting Connector. */
final class ConnectorPendingRoutes(
    completionService: ConnectorCompletionService,
    user: AuthenticatedUser
)(implicit system: ActorSystem[_])
    extends Directives
    with JsonProtocols {

  private implicit val executionContext: ExecutionContextExecutor = system.executionContext

  val routes: Route =
    path("connectors" / "pending") {
      post {
        entity(as[CreatePendingConnectorRequest]) { request =>
          val authShape = ConnectorAuthShape(
            authType        = request.authType,
            apiKeyName      = request.apiKeyName,
            apiKeyPlacement = request.apiKeyPlacement
          )
          ServiceResponse.run(completionService.createOrRemintPending(request.name, request.kind, request.baseUrl, authShape, user)) {
            minted => CompletionTokenResponse(minted.connectorId.value, minted.rawToken, minted.expiresAt.toString)
          }
        }
      }
    }
}
