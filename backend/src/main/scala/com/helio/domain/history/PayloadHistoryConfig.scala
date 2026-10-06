package com.helio.domain.history

import com.helio.domain.model.UserTier
import org.slf4j.LoggerFactory

import java.time.Duration

/** Per-tier payload retention: keep at most `maxRuns` payloads per node, none older than `maxAge`.
 *  A limit with either value at zero stores nothing. */
final case class PayloadTierLimit(maxRuns: Int, maxAge: Duration) {
  def allowsPayloads: Boolean = maxRuns > 0 && !maxAge.isZero && !maxAge.isNegative
}

/** HEL-1276: payload-history caps, read once at startup (`PipelineRunGuardConfig` style). A payload
 *  over `maxRows` rows or `maxBytes` bytes of compact JSON is never stored (never truncated). Tier
 *  limits default to owner ruling D4: free 0, beta 10 runs / 7 days, owner 30 runs / 30 days. */
final case class PayloadHistoryConfig(
    maxRows: Int,
    maxBytes: Int,
    free: PayloadTierLimit,
    beta: PayloadTierLimit,
    owner: PayloadTierLimit
) {
  def limitFor(tier: UserTier): PayloadTierLimit = tier match {
    case UserTier.Free  => free
    case UserTier.Beta  => beta
    case UserTier.Owner => owner
  }

  def byTier: Map[UserTier, PayloadTierLimit] =
    Seq(UserTier.Free, UserTier.Beta, UserTier.Owner).map(t => t -> limitFor(t)).toMap
}

object PayloadHistoryConfig {

  private val log = LoggerFactory.getLogger(getClass)

  val DefaultMaxRows: Int  = 1000
  val DefaultMaxBytes: Int = 1024 * 1024

  val Defaults: PayloadHistoryConfig = PayloadHistoryConfig(
    DefaultMaxRows, DefaultMaxBytes,
    PayloadTierLimit(0, Duration.ZERO),
    PayloadTierLimit(10, Duration.ofDays(7)),
    PayloadTierLimit(30, Duration.ofDays(30))
  )

  /** A non-numeric, out-of-range or (for the caps) non-positive value falls back to its default with
   *  a WARN. Tier runs/age accept 0 (meaning "store nothing for that tier"); negatives fall back. */
  def fromEnv(env: Map[String, String] = sys.env): PayloadHistoryConfig = {
    def read(name: String, default: Int, min: Int): Int =
      env.get(name) match {
        case None => default
        case Some(raw) =>
          raw.trim.toIntOption.filter(_ >= min) match {
            case Some(v) => v
            case None =>
              log.warn("{}='{}' is not an integer >= {}; using default {}", name, raw, Int.box(min), Int.box(default))
              default
          }
      }
    def tier(suffix: String, d: PayloadTierLimit): PayloadTierLimit =
      PayloadTierLimit(
        read(s"PAYLOAD_HISTORY_MAX_RUNS_$suffix", d.maxRuns, 0),
        Duration.ofDays(read(s"PAYLOAD_HISTORY_MAX_AGE_DAYS_$suffix", d.maxAge.toDays.toInt, 0).toLong)
      )
    val d = Defaults
    PayloadHistoryConfig(
      maxRows = read("PAYLOAD_HISTORY_MAX_ROWS", d.maxRows, 1),
      maxBytes = read("PAYLOAD_HISTORY_MAX_BYTES", d.maxBytes, 1),
      free = tier("FREE", d.free),
      beta = tier("BETA", d.beta),
      owner = tier("OWNER", d.owner)
    )
  }
}
