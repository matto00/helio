package com.helio.services.auth

/** Failure modes from the tier gate [[ChatAccessService]] enforces on every
 *  `AssistantConversationRoutes` endpoint (HEL-703, design.md D7). Kept separate from the generic
 *  [[ServiceError]] set (mirrors `AuthoringError`'s own reasoning) because `LimitReached` maps to
 *  `429 Too Many Requests`, a status `ServiceError` has no case for -- `AssistantConversationRoutes`
 *  maps each case directly to its status + `TierErrorResponse` body, rather than routing either
 *  case through `ServiceResponse.run`. */
sealed trait ChatAccessError {
  def message: String
}

object ChatAccessError {

  val ForbiddenMessage: String =
    "Chat access is limited during this rollout. Contact the workspace owner to request access."

  /** `free`-tier denial -- every endpoint in the family, before any handler logic runs. */
  final case class TierForbidden(message: String = ForbiddenMessage) extends ChatAccessError

  /** `beta`-tier over the configured daily cap -- converse only. */
  final case class LimitReached(limit: Int, weight: Int = 1, modelLabel: Option[String] = None) extends ChatAccessError {
    // HEL-1755 D7: a weighted send over the cap names the model so the user can pick a lighter one.
    val message: String =
      if (weight > 1)
        s"Daily chat limit reached: ${modelLabel.getOrElse("This model")} needs $weight of today's $limit units. " +
          "A lighter model may still fit. The limit resets at the start of the next UTC day."
      else
        s"Daily chat message limit reached ($limit messages). The limit resets at the start of the next UTC day."
  }
}
