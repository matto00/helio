package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._
import com.helio.domain._

/** Thin HTTP shell for `GET /api/connectors` (HEL-484). No repository or service dependency — it
 *  wraps the static `ConnectorRegistry.all` in the wire response type. `user` is unused but kept
 *  for signature parity with every other route class in the authenticated tree (`ApiRoutes.scala`
 *  mounts this alongside `DataSourceRoutes`/`SourceRoutes`, all of which take the authenticated
 *  caller even where per-user filtering doesn't apply). */
final class ConnectorRoutes(user: AuthenticatedUser) extends Directives with JsonProtocols {

  val routes: Route =
    pathPrefix("connectors") {
      pathEndOrSingleSlash {
        get {
          complete(ConnectorRegistry.all.map(ConnectorMetadataResponse.fromDomain))
        }
      }
    }
}
