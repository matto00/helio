package com.helio.app

import akka.actor.typed.ActorSystem
import akka.http.scaladsl.Http
import akka.http.scaladsl.server.Route
import akka.http.scaladsl.Http.ServerBinding

import scala.concurrent.Future

object HttpServer {
  def start(routes: Route, host: String, port: Int)(implicit system: ActorSystem[_]): Future[ServerBinding] =
    Http()(system.classicSystem).newServerAt(host, port).bind(routes)
}
