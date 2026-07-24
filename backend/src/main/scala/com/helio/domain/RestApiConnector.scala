package com.helio.domain

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.settings.{ClientConnectionSettings, ConnectionPoolSettings}
import org.apache.pekko.stream.Materializer
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

class RestApiConnector(
    fetchOverride: Option[RestApiConfig => Future[Either[String, JsValue]]] = None
)(implicit system: ActorSystem[_])
    extends Connector[RestApiConfig] {

  private val log = LoggerFactory.getLogger(getClass)

  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "rest_api",
    displayName = "REST API",
    supportsIncremental = false,
    authKind = "configurable"
  )

  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer    = Materializer(system)

  private val poolSettings: ConnectionPoolSettings =
    ConnectionPoolSettings(system.classicSystem)
      .withConnectionSettings(
        ClientConnectionSettings(system.classicSystem)
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

  /** Builds the request shared by `doFetch` and `testConnection` — same URI/query-param injection,
   *  method, and auth/header pipeline for both, so "auth is valid" means the same thing in each. */
  private def buildRequest(config: RestApiConfig): HttpRequest = {
    val baseUri = Uri(config.url)
    val uri     = injectQueryParam(baseUri, config.auth)
    val method  = HttpMethods.getForKey(config.method.toUpperCase).getOrElse(HttpMethods.GET)

    val baseHeaders: List[HttpHeader] = config.headers.map { case (k, v) => RawHeader(k, v) }.toList
    val authHeaders: List[HttpHeader] = buildAuthHeaders(config.auth)
    val allHeaders = authHeaders ++ baseHeaders

    HttpRequest(method = method, uri = uri, headers = allHeaders)
  }

  private def doFetch(config: RestApiConfig): Future[Either[String, JsValue]] = {
    val request = buildRequest(config)

    Http(system.classicSystem)
      .singleRequest(request, settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(30.seconds).map { entity =>
          val body = entity.data.utf8String
          if (response.status.isSuccess()) {
            Try(body.parseJson).toEither.left.map { e =>
              // HEL-311: keep the curated category prefix, drop the raw
              // parser-exception tail; log the cause.
              log.error("Failed to parse JSON response from REST source", e)
              "Failed to parse JSON response"
            }
          } else {
            Left(s"HTTP ${response.status.intValue()}: $body")
          }
        }
      }
      .recover { case e =>
        // HEL-311: keep the "Request failed" category prefix, drop the raw
        // exception tail; log the cause.
        log.error("REST source request failed", e)
        Left("Request failed")
      }
  }

  // ── Connector[RestApiConfig] ──────────────────────────────────────────────

  /** Issues the same request/auth/header pipeline as `fetch`, but only inspects the response
   *  status — never calls `parseJson` on the body, so a non-JSON 200 response still succeeds. */
  def testConnection(config: RestApiConfig)(implicit ec: ExecutionContext): Future[Either[String, Unit]] = {
    val request = buildRequest(config)

    Http(system.classicSystem)
      .singleRequest(request, settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(30.seconds).map { entity =>
          if (response.status.isSuccess())
            Right(())
          else
            Left(s"HTTP ${response.status.intValue()}: ${entity.data.utf8String}")
        }
      }
      .recover { case e =>
        // HEL-311: keep the "Request failed" category prefix, drop the raw
        // exception tail; log the cause.
        log.error("REST source request failed", e)
        Left("Request failed")
      }
  }

  /** Forwards to the existing `fetch`/`toRows` methods, routing through the shared
   *  `SchemaInferenceEngine.inferSchemaFromRows` facade (HEL-473) instead of calling `fromJson`
   *  directly on the raw response. `toRows` case-matches the same three response shapes `fromJson`
   *  handles (JSON array, single object, non-object scalar), so this produces byte-for-byte
   *  identical output to the pre-change `fromJson(json)` call (design.md Decision 1). */
  def inferSchema(config: RestApiConfig)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    fetch(config).map(_.map(json => SchemaInferenceEngine.inferSchemaFromRows(toRows(json))))

  /** Forwards to the existing `fetch`/`toRows` methods, truncating to `maxRows` — matching
   *  `SourceService.previewRest`'s `connector.toRows(json).take(10)` pattern. */
  def fetch(config: RestApiConfig, maxRows: Int)(implicit ec: ExecutionContext): Future[Either[String, Vector[JsValue]]] =
    fetch(config).map(_.map(json => toRows(json).take(maxRows)))

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
