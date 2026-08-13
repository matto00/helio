package com.helio.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Non-blocking, guardrail-enforcing wrapper over a [[ClaudeTransport]] (design.md D2-D4). Never
 *  performs a blocking network/I/O call on the calling thread: `send` returns immediately with a
 *  `Future`, `stream` returns immediately with a `Source`.
 *
 *  Never logs `apiKey`: this class never holds one — it only holds `config.model`/
 *  `config.temperature`/token ceilings and a [[ClaudeTransport]] (which encapsulates the key, if
 *  any, entirely on its own side of the SPI boundary). */
class ClaudeClient(config: ClaudeConfig, transport: ClaudeTransport)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** Estimates input tokens → rejects (`GuardrailExceeded`) over `config.maxInputTokens` *before*
   *  any network call; clamps requested `maxTokens` down to `config.maxOutputTokens` (never
   *  rejects for requesting too much output); delegates to `transport.send`; maps transport/API
   *  failures to a typed [[ClaudeError]] (design.md D3/D4). */
  def send(request: ClaudeRequest): Future[Either[ClaudeError, ClaudeResponse]] =
    guardrailReject(request) match {
      case Some(reason) =>
        Future.successful(Left(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport
          .send(toApiRequest(request, stream = false))
          .transform {
            case Success(apiResponse) =>
              Success(Right(toClaudeResponse(apiResponse)))
            case Failure(ClaudeApiException(status, body)) =>
              log.warn(s"Claude API request failed with status $status")
              Success(Left(ClaudeError.ApiError(status, body)))
            case Failure(e) =>
              log.error("Claude API request failed", e)
              Success(Left(ClaudeError.TransportFailure("Request failed")))
          }
    }

  /** Runs the identical pre-flight guardrail check as [[send]]. On rejection, returns
   *  `Source.single(ClaudeStreamEvent.Error(GuardrailExceeded(reason)))` and completes — reusing
   *  the same error-event handling path a stream consumer already needs for mid-stream API
   *  errors — with zero `ClaudeTransport.stream` invocations (design.md D4a). */
  def stream(request: ClaudeRequest): Source[ClaudeStreamEvent, NotUsed] =
    guardrailReject(request) match {
      case Some(reason) =>
        Source.single(ClaudeStreamEvent.Error(ClaudeError.GuardrailExceeded(reason)))
      case None =>
        transport.stream(toApiRequest(request, stream = true))
    }

  private def guardrailReject(request: ClaudeRequest): Option[String] = {
    val estimated = ClaudeTokenEstimator.estimate(request.messages)
    if (estimated > config.maxInputTokens)
      Some(s"Estimated input tokens ($estimated) exceed the configured limit (${config.maxInputTokens})")
    else
      None
  }

  private def toApiRequest(request: ClaudeRequest, stream: Boolean): ClaudeApiRequest = {
    val clampedMaxTokens = math.min(request.maxTokens.getOrElse(config.maxOutputTokens), config.maxOutputTokens)
    ClaudeApiRequest(
      model = config.model,
      maxTokens = clampedMaxTokens,
      messages = request.messages.map(m => ClaudeApiMessage(m.role, m.content)),
      temperature = request.temperature.getOrElse(config.temperature),
      stream = stream
    )
  }

  private def toClaudeResponse(apiResponse: ClaudeApiResponse): ClaudeResponse = {
    val text = apiResponse.content.flatMap(_.text).mkString
    ClaudeResponse(
      id = apiResponse.id,
      text = text,
      stopReason = apiResponse.stopReason,
      usage = TokenUsage(apiResponse.usage.inputTokens, apiResponse.usage.outputTokens)
    )
  }
}
