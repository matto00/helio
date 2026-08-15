package com.helio.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.settings.{ClientConnectionSettings, ConnectionPoolSettings}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Source
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Production [[ClaudeTransport]] (design.md D2) — mirrors `RestApiConnector`'s
 *  `Http(system.classicSystem).singleRequest` + `ConnectionPoolSettings`-with-timeouts shape.
 *
 *  Never logs `apiKey`: it is placed only on the outbound `x-api-key` header and is never
 *  interpolated into a log statement, request-object `toString`, or thrown exception message
 *  anywhere in this class (see the "API key never appears in logs" requirement). */
class HttpClaudeTransport(apiKey: String)(implicit system: ActorSystem[_]) extends ClaudeTransport {
  import ClaudeProtocol._
  import HttpClaudeTransport._

  private val log = LoggerFactory.getLogger(getClass)

  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer    = Materializer(system)

  private val poolSettings: ConnectionPoolSettings =
    ConnectionPoolSettings(system.classicSystem)
      .withConnectionSettings(
        ClientConnectionSettings(system.classicSystem)
          .withConnectingTimeout(10.seconds)
          .withIdleTimeout(60.seconds)
      )

  private def buildHttpRequest(request: ClaudeApiRequest): HttpRequest =
    HttpRequest(
      method = HttpMethods.POST,
      uri = MessagesUri,
      headers = List(
        RawHeader("x-api-key", apiKey),
        RawHeader("anthropic-version", AnthropicVersion)
      ),
      entity = HttpEntity(ContentTypes.`application/json`, request.toJson.compactPrint)
    )

  /** `private[ai]`, not `private`, so `HttpClaudeTransportSpec` can assert on the serialized
   *  `tools`/block-content request shape directly — without ever invoking [[sendTool]] itself,
   *  which would require a real (or bound-local) HTTP round trip. */
  private[ai] def buildHttpRequest(request: ClaudeApiToolRequest): HttpRequest =
    HttpRequest(
      method = HttpMethods.POST,
      uri = MessagesUri,
      headers = List(
        RawHeader("x-api-key", apiKey),
        RawHeader("anthropic-version", AnthropicVersion)
      ),
      entity = HttpEntity(ContentTypes.`application/json`, request.toJson.compactPrint)
    )

  override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
    Http(system.classicSystem)
      .singleRequest(buildHttpRequest(request.copy(stream = false)), settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(ResponseReadTimeout).flatMap { entity =>
          val body = entity.data.utf8String
          if (response.status.isSuccess()) {
            Try(body.parseJson.convertTo[ClaudeApiResponse]) match {
              case Success(parsed) => Future.successful(parsed)
              case Failure(e) =>
                log.error("Failed to parse Claude API response", e)
                Future.failed(ClaudeApiException(response.status.intValue(), "Failed to parse Claude API response"))
            }
          } else {
            Future.failed(ClaudeApiException(response.status.intValue(), body))
          }
        }
      }

  /** Real end-to-end wiring for the tool-use loop (design.md D4) — same `/v1/messages` endpoint as
   *  [[send]], a request-shape variant (block-content messages + `tools`) of the same Anthropic
   *  API, not a different endpoint. Non-streaming, mirroring [[send]] not [[stream]] (design.md
   *  D3). */
  override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] =
    Http(system.classicSystem)
      .singleRequest(buildHttpRequest(request), settings = poolSettings)
      .flatMap { response =>
        response.entity.toStrict(ResponseReadTimeout).flatMap { entity =>
          val body = entity.data.utf8String
          if (response.status.isSuccess()) {
            Try(body.parseJson.convertTo[ClaudeApiResponse]) match {
              case Success(parsed) => Future.successful(parsed)
              case Failure(e) =>
                log.error("Failed to parse Claude API tool-use response", e)
                Future.failed(ClaudeApiException(response.status.intValue(), "Failed to parse Claude API response"))
            }
          } else {
            Future.failed(ClaudeApiException(response.status.intValue(), body))
          }
        }
      }

  override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
    val eventsFuture: Future[Source[ClaudeStreamEvent, Any]] =
      Http(system.classicSystem)
        .singleRequest(buildHttpRequest(request.copy(stream = true)), settings = poolSettings)
        .flatMap { response =>
          if (response.status.isSuccess()) {
            Future.successful(ClaudeSseAssembler.assemble(response.entity.dataBytes))
          } else {
            response.entity.toStrict(ResponseReadTimeout).map { entity =>
              Source.single(ClaudeStreamEvent.Error(ClaudeError.ApiError(response.status.intValue(), entity.data.utf8String)))
            }
          }
        }
        .recover { case e =>
          log.error("Claude streaming request failed", e)
          Source.single(ClaudeStreamEvent.Error(ClaudeError.TransportFailure("Streaming request failed")))
        }

    Source.futureSource(eventsFuture).mapMaterializedValue(_ => NotUsed)
  }
}

object HttpClaudeTransport {
  private val MessagesUri: Uri         = Uri("https://api.anthropic.com/v1/messages")
  private val AnthropicVersion: String = "2023-06-01"
  private val ResponseReadTimeout      = 60.seconds
}
