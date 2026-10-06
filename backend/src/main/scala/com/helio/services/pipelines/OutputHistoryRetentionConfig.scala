package com.helio.services.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.pipelines.HistoryThinningPolicy
import org.slf4j.LoggerFactory

import java.time.Duration

/** HEL-1272: Output-history retention settings, read once at startup. Defaults equal owner ruling
 *  D4 and [[HistoryThinningPolicy]]'s defaults. A non-numeric or non-positive value falls back to
 *  its own default; a recent window that is not strictly shorter than the mid window makes the whole
 *  thinning policy fall back to the defaults. */
final case class OutputHistoryRetentionConfig(
    policy: HistoryThinningPolicy,
    maxAgeFree: Duration,
    maxAgeBeta: Duration,
    maxAgeOwner: Duration,
    purgeInterval: Duration,
    lockRetry: Duration = Duration.ofSeconds(120)
) {

  /** Cap for a known tier (a non-exhaustive match only warns in this build, so totality is NOT relied on:
   *  the repository purges any tier absent from [[maxAgeByTier]] at the strictest cap). */
  def maxAgeFor(tier: UserTier): Duration = tier match {
    case UserTier.Free  => maxAgeFree
    case UserTier.Beta  => maxAgeBeta
    case UserTier.Owner => maxAgeOwner
  }

  def maxAgeByTier: Map[UserTier, Duration] = Seq(UserTier.Free, UserTier.Beta, UserTier.Owner).map(t => t -> maxAgeFor(t)).toMap
}

object OutputHistoryRetentionConfig {

  private val log = LoggerFactory.getLogger(getClass)

  def fromEnv(env: Map[String, String] = sys.env): OutputHistoryRetentionConfig = {
    def positive(name: String, default: Long): Long =
      env.get(name).flatMap(_.trim.toLongOption).filter(_ >= 1).getOrElse(default)

    val d = HistoryThinningPolicy()
    val candidate = HistoryThinningPolicy(
      recentWindow = Duration.ofHours(positive("OUTPUT_HISTORY_RECENT_WINDOW_HOURS", d.recentWindow.toHours)),
      recentBucket = Duration.ofMinutes(positive("OUTPUT_HISTORY_RECENT_BUCKET_MINUTES", d.recentBucket.toMinutes)),
      midWindow    = Duration.ofDays(positive("OUTPUT_HISTORY_MID_WINDOW_DAYS", d.midWindow.toDays)),
      midBucket    = Duration.ofMinutes(positive("OUTPUT_HISTORY_MID_BUCKET_MINUTES", d.midBucket.toMinutes)),
      oldBucket    = Duration.ofHours(positive("OUTPUT_HISTORY_OLD_BUCKET_HOURS", d.oldBucket.toHours))
    )
    val policy =
      if (candidate.recentWindow.compareTo(candidate.midWindow) < 0) candidate
      else {
        log.warn(
          "OUTPUT_HISTORY_RECENT_WINDOW_HOURS ({}) is not shorter than OUTPUT_HISTORY_MID_WINDOW_DAYS ({}); using default thinning policy",
          candidate.recentWindow, candidate.midWindow
        )
        d
      }
    val purgeInterval = Duration.ofMinutes(positive("OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES", 60))
    OutputHistoryRetentionConfig(
      policy = policy,
      maxAgeFree = Duration.ofDays(positive("OUTPUT_HISTORY_MAX_AGE_DAYS_FREE", 30)),
      maxAgeBeta = Duration.ofDays(positive("OUTPUT_HISTORY_MAX_AGE_DAYS_BETA", 90)),
      maxAgeOwner = Duration.ofDays(positive("OUTPUT_HISTORY_MAX_AGE_DAYS_OWNER", 365)),
      purgeInterval = purgeInterval,
      // HEL-1343: retry window after a lock-held skip; capped at the interval so it never lengthens the wait.
      lockRetry = {
        val retry = Duration.ofSeconds(positive("OUTPUT_HISTORY_LOCK_RETRY_SECONDS", 120))
        if (retry.compareTo(purgeInterval) > 0) purgeInterval else retry
      }
    )
  }
}
