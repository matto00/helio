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
 *  otherwise (e.g. a preview with no persisted run). HEL-1108's tier/quota gate is enforced at
 *  `ClaudeAiStepClient.complete` keyed on this field -- a `None` owner is treated as NOT
 *  permitted, never exempt (design.md D8). */
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
  /** HEL-1108 (design.md D6): the caller's daily AI budget (`HELIO_BETA_DAILY_MESSAGE_LIMIT`,
   *  shared with chat) is exhausted. `limit` is the configured cap, named in the surfaced
   *  message so a denied user can account for it. Distinct from `Guardrail` (a model-side
   *  content refusal) -- conflating the two would make an account quota indistinguishable from
   *  a model decision to any future consumer. */
  final case class QuotaExceeded(limit: Int) extends AiStepFailure
}

/** HEL-1108 (design.md D6/task 3.4): the ONE place both AI step files build a `QuotaExceeded`
 *  denial's user-facing message, so the limit/reset/shared-budget wording can't drift between
 *  `analyzewithai` and `generatetext`. */
object AiQuotaMessage {
  def apply(limit: Int): String =
    s"Daily AI call limit of $limit reached. This budget resets at midnight UTC and is shared " +
      "with the assistant chat -- both count against the same daily allowance."
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
