package com.helio.domain.insights

import scala.concurrent.Future

/** HEL-1741 D1: the replaceable seam every insight render calls the model through (the `AiStepClient`
 *  pattern). Domain-only types: callers never see an infrastructure type. */
trait InsightModelClient {
  def render(request: InsightModelRequest): Future[Either[InsightModelFailure, InsightModelResponse]]
}

/** `model` is the resolved catalog id to request, or `None` for the server default (`CLAUDE_MODEL`). */
final case class InsightModelRequest(system: String, user: String, maxOutputTokens: Int, model: Option[String] = None)

final case class InsightUsage(inputTokens: Int, outputTokens: Int, cacheCreationInputTokens: Int = 0, cacheReadInputTokens: Int = 0) {
  def +(other: InsightUsage): InsightUsage =
    InsightUsage(
      inputTokens + other.inputTokens,
      outputTokens + other.outputTokens,
      cacheCreationInputTokens + other.cacheCreationInputTokens,
      cacheReadInputTokens + other.cacheReadInputTokens
    )
}

object InsightUsage {
  val Zero: InsightUsage = InsightUsage(0, 0)
}

final case class InsightModelResponse(text: String, usage: InsightUsage, model: String)

sealed trait InsightModelFailure

object InsightModelFailure {
  final case class Unavailable(reason: String)    extends InsightModelFailure
  final case class Guardrail(reason: String)      extends InsightModelFailure
  final case class Api(status: Int, body: String) extends InsightModelFailure
  final case class Transport(message: String)     extends InsightModelFailure
  /** The model produced no usable answer (a refusal, an out-of-tokens stop, or an unexpected tool request). */
  final case class NoAnswer(reason: String, usage: InsightUsage = InsightUsage.Zero, model: Option[String] = None) extends InsightModelFailure
}

object InsightModelClient {

  /** The default when no model is configured: every render fails with a named `Unavailable`. */
  val Unavailable: InsightModelClient = new InsightModelClient {
    override def render(request: InsightModelRequest): Future[Either[InsightModelFailure, InsightModelResponse]] =
      Future.successful(Left(InsightModelFailure.Unavailable("ANTHROPIC_API_KEY is not configured")))
  }
}
