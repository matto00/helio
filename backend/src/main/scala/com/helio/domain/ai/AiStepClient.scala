package com.helio.domain.ai

import scala.concurrent.Future

/** HEL-1106 (design.md D2) -- the reusable, injectable seam every AI-backed pipeline step calls
 *  the model through. Lives in `com.helio.domain` (not `com.helio.ai`) so step files never need
 *  to import `ClaudeClient`/`ClaudeConfig` -- tests inject a fake implementation directly, and
 *  production wires [[ClaudeAiStepClient]] over the real `ClaudeClient`. `analyzewithai` is the
 *  first caller; HEL-1107 `generatetext` reuses `complete` unchanged. */
trait AiStepClient {
  def complete(request: AiStepRequest): Future[Either[AiStepFailure, String]]
}

/** `ownerUserId` (design.md D4): populated when the engine knows the run's owning user, `None`
 *  otherwise (e.g. a preview with no persisted run). HEL-1108's tier/quota check is the first
 *  consumer of this field -- not implemented here, this ticket only carries it through. */
final case class AiStepRequest(instruction: String, content: String, ownerUserId: Option[String] = None)

/** Closed failure set an [[AiStepClient]] may return, mirroring [[com.helio.ai.ClaudeError]]'s
 *  "sealed trait + object of case classes" convention -- deliberately a DIFFERENT type (not a
 *  re-export of `ClaudeError`) so a step's enforcement code never needs `com.helio.ai` in scope. */
sealed trait AiStepFailure

object AiStepFailure {
  final case class Unavailable(reason: String) extends AiStepFailure
  final case class Guardrail(reason: String) extends AiStepFailure
  final case class Api(status: Int, body: String) extends AiStepFailure
  final case class Transport(message: String) extends AiStepFailure
}

object AiStepClient {

  /** The context default (design.md D2/D3): every existing direct construction of
   *  [[com.helio.domain.model.PipelineExecutionContext]] keeps compiling, and a run that never
   *  wires a real client degrades to a named `ai-unavailable` failure rather than skipping the
   *  step or emitting null columns. */
  val Unavailable: AiStepClient = new AiStepClient {
    override def complete(request: AiStepRequest): Future[Either[AiStepFailure, String]] =
      Future.successful(Left(AiStepFailure.Unavailable("ANTHROPIC_API_KEY is not configured")))
  }
}
