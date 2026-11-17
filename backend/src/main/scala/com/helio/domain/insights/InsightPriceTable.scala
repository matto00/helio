package com.helio.domain.insights

import java.math.{BigDecimal => JBigDecimal, RoundingMode}

/** Micro-USD per million tokens (1 USD = 1,000,000). */
final case class ModelPrice(input: Long, output: Long, cacheWrite5m: Long, cacheRead: Long)

/** HEL-1741 D9: cost is recorded from API usage times this table, never enforced. An unknown model yields
 *  `None`, never a guess. */
final case class InsightPriceTable(prices: Map[String, ModelPrice], sourceUrl: String, readOn: String) {

  /** sum(tokens x price) / 1e6 micro-USD, HALF_UP. */
  def costMicros(model: String, usage: InsightUsage): Option[Long] =
    prices.get(model).map { p =>
      val total = JBigDecimal.valueOf(usage.inputTokens.toLong * p.input) add
        JBigDecimal.valueOf(usage.outputTokens.toLong * p.output) add
        JBigDecimal.valueOf(usage.cacheCreationInputTokens.toLong * p.cacheWrite5m) add
        JBigDecimal.valueOf(usage.cacheReadInputTokens.toLong * p.cacheRead)
      total.divide(JBigDecimal.valueOf(1000000L), 0, RoundingMode.HALF_UP).longValueExact()
    }
}

object InsightPriceTable {
  private def usd(input: Double, output: Double, cacheWrite: Double, cacheRead: Double): ModelPrice =
    ModelPrice(micro(input), micro(output), micro(cacheWrite), micro(cacheRead))

  private def micro(usd: Double): Long = Math.round(usd * 1000000.0)

  val SourceUrl: String = "https://platform.claude.com/docs/en/about-claude/pricing"
  val ReadOn: String    = "2026-11-17"

  /** Insight input is capped at 8k tokens, so the haiku-5-5 <= 100k-prompt rate always applies. */
  val Default: InsightPriceTable = InsightPriceTable(
    Map(
      "claude-opus-4-8"   -> usd(5, 25, 6.25, 0.50),
      "claude-haiku-5-5"  -> usd(0.10, 0.50, 0.125, 0.01),
      "claude-sonnet-5-5" -> usd(2, 10, 2.50, 0.10),
      "claude-opus-5-5"   -> usd(4, 20, 5, 0.20),
      "claude-sonnet-5"   -> usd(2, 10, 2.50, 0.20)
    ),
    SourceUrl,
    ReadOn
  )
}
