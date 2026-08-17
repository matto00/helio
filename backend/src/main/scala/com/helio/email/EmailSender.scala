package com.helio.email

import scala.concurrent.Future

/** Outbound email capability (HEL-704, design.md D6) -- mirrors `com.helio.ai.ClaudeTransport`'s
 *  trait-over-HTTP-implementation shape so callers/tests can inject a stub instead of ever
 *  making a real network call (`HttpResendEmailSender` is the sole production implementation).
 *
 *  `Right(())` iff the provider ACCEPTED the message; `Left(reason)` for a provider rejection or
 *  transport failure -- never thrown, never retried automatically (owner-notification-email
 *  spec's "Send outcomes are explicit" requirement). `reason` is a caller-safe message; it never
 *  contains the configured API key. */
trait EmailSender {
  def send(to: Seq[String], subject: String, text: String): Future[Either[String, Unit]]
}
