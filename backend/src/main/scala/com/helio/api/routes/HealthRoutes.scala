package com.helio.api.routes

import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api._

final class HealthRoutes extends Directives with JsonProtocols {

  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    }
}