package com.helio.infrastructure.ai

/** User-facing text for [[ClaudeError.NoAnswer]] (HEL-1636 D6), shared by every consumer so the
 *  wording is identical on the assistant route, authoring, refinement and pipeline AI steps. */
object ClaudeErrorMessages {

  def noAnswerMessage(stopReason: Option[String], category: Option[String]): String =
    stopReason match {
      case Some("refusal") =>
        s"Claude declined this request (category: ${category.getOrElse("unspecified")}). Rephrase it and try again."
      case Some("pause_turn") =>
        "Claude paused a long search before answering. Send your message again to continue."
      case other =>
        s"Claude returned no answer (stop_reason: ${other.getOrElse("unknown")})."
    }
}
