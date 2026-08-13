package com.helio.ai

import scala.util.Try

/** Env-sourced configuration for the Claude Messages API client (HEL-390, design.md D6/D7).
 *  Constructed once via [[ClaudeConfig.fromEnv]] — never hardcode a model id, temperature,
 *  token ceiling, or API key literal at a call site.
 *
 *  Fails fast at *construction*, not at `Main.scala` startup: this ticket wires no consumer
 *  into the route tree, so nothing should force every backend boot to require a key just
 *  because this library exists (design.md D6). The first real caller (HEL-341) owns the
 *  startup-fail-fast decision.
 *
 *  `toString` is overridden so `apiKey` can never leak via an incidental `log.info(config)` /
 *  string-interpolation call site — see design.md's "API key never appears in logs" requirement. */
final case class ClaudeConfig(
    apiKey: String,
    model: String,
    temperature: Double,
    maxOutputTokens: Int,
    maxInputTokens: Int
) {
  override def toString: String =
    s"ClaudeConfig(model=$model, temperature=$temperature, maxOutputTokens=$maxOutputTokens, " +
      s"maxInputTokens=$maxInputTokens, apiKey=<redacted>)"
}

object ClaudeConfig {
  val DefaultModel: String           = "claude-opus-4-8"
  val DefaultTemperature: Double     = 1.0
  val DefaultMaxOutputTokens: Int    = 4096
  val DefaultMaxInputTokens: Int     = 100000

  private val ApiKeyEnvVar: String = "ANTHROPIC_API_KEY"

  /** Reads `ANTHROPIC_API_KEY` (required, non-blank), `CLAUDE_MODEL` (default
   *  [[DefaultModel]]), `CLAUDE_TEMPERATURE` (default [[DefaultTemperature]]),
   *  `CLAUDE_MAX_TOKENS` (default [[DefaultMaxOutputTokens]]), and
   *  `CLAUDE_MAX_INPUT_TOKENS` (default [[DefaultMaxInputTokens]]) from the process
   *  environment. A missing/blank API key returns `Left` naming the variable; a
   *  non-numeric override for any of the numeric variables falls back to that
   *  variable's default rather than failing construction (tolerant-decode, matching
   *  this codebase's existing config-parsing convention). */
  def fromEnv(): Either[String, ClaudeConfig] =
    sys.env.get(ApiKeyEnvVar).map(_.trim).filter(_.nonEmpty) match {
      case None =>
        Left(s"Missing required environment variable $ApiKeyEnvVar")
      case Some(apiKey) =>
        Right(
          ClaudeConfig(
            apiKey = apiKey,
            model = sys.env.getOrElse("CLAUDE_MODEL", DefaultModel),
            temperature = doubleEnv("CLAUDE_TEMPERATURE", DefaultTemperature),
            maxOutputTokens = intEnv("CLAUDE_MAX_TOKENS", DefaultMaxOutputTokens),
            maxInputTokens = intEnv("CLAUDE_MAX_INPUT_TOKENS", DefaultMaxInputTokens)
          )
        )
    }

  private def intEnv(name: String, default: Int): Int =
    sys.env.get(name).flatMap(v => Try(v.trim.toInt).toOption).getOrElse(default)

  private def doubleEnv(name: String, default: Double): Double =
    sys.env.get(name).flatMap(v => Try(v.trim.toDouble).toOption).getOrElse(default)
}
