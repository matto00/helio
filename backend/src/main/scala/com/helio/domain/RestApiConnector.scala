package com.helio.domain

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.settings.ConnectionPoolSettings
import org.apache.pekko.stream.Materializer
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

class RestApiConnector(
    fetchOverride: Option[RestApiConfig => Future[Either[String, JsValue]]] = None
)(implicit system: ActorSystem[_]) {

  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer    = Materializer(system)

  private val poolSettings: ConnectionPoolSettings =
    ConnectionPoolSettings(system.classicSystem)
      .withConnectionSettings(
        org.apache.pekko.http.scaladsl.settings.ClientConnectionSettings(system.classicSystem)
          .withConnectingTimeout(10.seconds)
          .withIdleTimeout(30.seconds)
      )

  def fetch(config: RestApiConfig): Future[Either[String, JsValue]] =
    fetchOverride.fold(doFetch(config))(fn => fn(config))

  def toRows(json: JsValue): Vector[JsValue] = json match {
    case JsArray(elements) => elements.toVector
    case obj: JsObject     => Vector(obj)
    case other             => Vector(other)
  }

  private def doFetch(config: RestApiConfig): Future[Either[String, JsValue]] = {
    val baseUri = Uri(config.url)
    val uri     = injectQueryParam(baseUri, config.auth)
    val method  = HttpMethods.getForKey(config.method.toUpperCase).getOrElse(HttpMethods.GET)

    val baseHeaders: List[HttpHeader] = config.headers.map { case (k, v) => RawHeader(k, v) }.toList
    val authHeaders: List[HttpHeader] = buildAuthHeaders(config.auth)
    val allHeaders = authHeaders ++ baseHeaders

    val request = HttpRequest(method = method, uri = uri, headers = allHeaders)

    Http(system.classicSystem)
      .singleRequest(request, settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(30.seconds).map { entity =>
          val body = entity.data.utf8String
          if (response.status.isSuccess()) {
            Try(body.parseJson).toEither.left.map(e => s"Failed to parse JSON response: ${e.getMessage}")
          } else {
            Left(s"HTTP ${response.status.intValue()}: $body")
          }
        }
      }
      .recover { case e => Left(s"Request failed: ${e.getMessage}") }
  }

  private def buildAuthHeaders(auth: RestApiAuth): List[HttpHeader] = auth match {
    case RestApiAuth.NoAuth                          => Nil
    case RestApiAuth.BearerAuth(token)               => List(Authorization(OAuth2BearerToken(token)))
    case RestApiAuth.ApiKeyAuth(name, value, ApiKeyPlacement.Header) => List(RawHeader(name, value))
    case RestApiAuth.ApiKeyAuth(_, _, ApiKeyPlacement.Query)         => Nil
  }

  private def injectQueryParam(uri: Uri, auth: RestApiAuth): Uri = auth match {
    case RestApiAuth.ApiKeyAuth(name, value, ApiKeyPlacement.Query) =>
      uri.withQuery(Uri.Query(uri.query().toMap + (name -> value)))
    case _ => uri
  }
}
