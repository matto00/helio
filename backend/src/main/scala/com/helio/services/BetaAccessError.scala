package com.helio.services

/** Failure modes from [[BetaAccessService]] (HEL-704, design.md D5) -- mirrors `ChatAccessError`'s
 *  own reasoning: kept separate from the generic [[ServiceError]] set because `EmailUnconfigured`
 *  (503) and `Cooldown` (429) have no `ServiceError` counterpart. `BetaAccessRoutes` maps each
 *  case directly to its status + `ErrorResponse` body, rather than routing through
 *  `ServiceResponse.run`. */
sealed trait BetaAccessError {
  def message: String
}

object BetaAccessError {

  /** The email capability is unusable for this request -- either no `EmailSender` is configured
   *  (missing `RESEND_API_KEY`/`HELIO_EMAIL_FROM`), or it is configured but there are no
   *  configured recipients (`HELIO_OWNER_EMAILS` empty/unset) -- design.md D4 treats the two
   *  identically: both mean "nobody would ever receive the notification". */
  final case class EmailUnconfigured(
      message: String = "Beta access requests are not available right now. Please try again later."
  ) extends BetaAccessError

  /** The caller's persisted tier makes the requested action inapplicable -- a non-`free` caller
   *  hitting request-access or redeem. */
  final case class NotEligible(message: String) extends BetaAccessError

  /** Per-user request-access cooldown has not yet elapsed (design.md D4, best-effort/in-memory,
   *  MAY reset on restart). */
  final case class Cooldown(
      message: String = "A Beta access request was already sent recently. Please wait before trying again."
  ) extends BetaAccessError

  /** The email provider rejected or failed the send -- no state is persisted. */
  final case class SendFailed(
      message: String = "Failed to notify the workspace owner. Please try again later."
  ) extends BetaAccessError

  /** Unknown, already-used, or foreign invite code -- deliberately ONE message for all three
   *  (invite-code-redemption spec: "no validity oracle"). */
  final case class InvalidCode(
      message: String = "Invalid or already-used invite code"
  ) extends BetaAccessError
}
