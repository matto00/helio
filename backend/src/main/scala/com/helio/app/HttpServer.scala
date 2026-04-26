package com.helio.app

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.Http.ServerBinding

import scala.concurrent.Future

object HttpServer {
  def start(routes: Route, host: String, port: Int)(implicit system: ActorSystem[_]): Future[ServerBinding] =
    Http()(system.classicSystem).newServerAt(host, port).bind(routes)
}
