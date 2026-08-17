package com.helio.email

/** Env-sourced configuration for the outbound email capability (HEL-704, design.md D6) --
 *  backed by the Resend REST API. Constructed once via [[EmailConfig.fromEnv]] -- never hardcode
 *  `apiKey`/`from` at a call site; mirrors `ClaudeConfig`'s fromEnv-once-inject-explicitly
 *  convention.
 *
 *  Fails at *construction*, not at `Main.scala` startup -- `ApiRoutes` wires the result as an
 *  `Option[EmailSender]` (design.md D6), so a missing key degrades only the endpoints that need
 *  email (request-access), never the whole backend boot (mirrors `ClaudeConfig`'s own
 *  no-forced-startup-requirement precedent).
 *
 *  `toString` is overridden so `apiKey` can never leak via an incidental `log.info(config)` /
 *  string-interpolation call site -- see the owner-notification-email spec's "API key never
 *  appears in logs" requirement. */
final case class EmailConfig(apiKey: String, from: String) {
  override def toString: String = s"EmailConfig(from=$from, apiKey=<redacted>)"
}

object EmailConfig {
  private val ApiKeyEnvVar: String = "RESEND_API_KEY"
  private val FromEnvVar: String   = "HELIO_EMAIL_FROM"

  /** Reads `RESEND_API_KEY` and `HELIO_EMAIL_FROM` (both required, non-blank) from the process
   *  environment. Either missing/blank returns `Left` naming the first missing variable. */
  def fromEnv(): Either[String, EmailConfig] =
    for {
      apiKey <- sys.env
        .get(ApiKeyEnvVar)
        .map(_.trim)
        .filter(_.nonEmpty)
        .toRight(s"Missing required environment variable $ApiKeyEnvVar")
      from <- sys.env
        .get(FromEnvVar)
        .map(_.trim)
        .filter(_.nonEmpty)
        .toRight(s"Missing required environment variable $FromEnvVar")
    } yield EmailConfig(apiKey, from)
}
