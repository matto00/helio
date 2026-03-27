package com.helio.api.routes

import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.server.Route
import com.helio.api._

final class HealthRoutes extends Directives with JsonProtocols {

  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    }
}