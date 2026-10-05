package com.helio.services.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.pipelines.HistoryThinningPolicy
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Duration

class OutputHistoryRetentionConfigSpec extends AnyWordSpec with Matchers {

  "OutputHistoryRetentionConfig.fromEnv" should {

    "use the documented defaults when nothing is set" in {
      val c = OutputHistoryRetentionConfig.fromEnv(Map.empty)
      c.policy shouldBe HistoryThinningPolicy()
      c.maxAgeByTier shouldBe Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))
      c.purgeInterval shouldBe Duration.ofMinutes(60)
    }

    "read every variable" in {
      val c = OutputHistoryRetentionConfig.fromEnv(Map(
        "OUTPUT_HISTORY_MAX_AGE_DAYS_FREE" -> "10", "OUTPUT_HISTORY_MAX_AGE_DAYS_BETA" -> "20", "OUTPUT_HISTORY_MAX_AGE_DAYS_OWNER" -> "30",
        "OUTPUT_HISTORY_RECENT_WINDOW_HOURS" -> "2", "OUTPUT_HISTORY_RECENT_BUCKET_MINUTES" -> "3",
        "OUTPUT_HISTORY_MID_WINDOW_DAYS" -> "4", "OUTPUT_HISTORY_MID_BUCKET_MINUTES" -> "15",
        "OUTPUT_HISTORY_OLD_BUCKET_HOURS" -> "12", "OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES" -> "7"
      ))
      c.maxAgeByTier shouldBe Map(UserTier.Free -> Duration.ofDays(10), UserTier.Beta -> Duration.ofDays(20), UserTier.Owner -> Duration.ofDays(30))
      c.policy shouldBe HistoryThinningPolicy(Duration.ofHours(2), Duration.ofMinutes(3), Duration.ofDays(4), Duration.ofMinutes(15), Duration.ofHours(12))
      c.purgeInterval shouldBe Duration.ofMinutes(7)
    }

    "fall back per value on non-numeric, zero or negative input" in {
      val c = OutputHistoryRetentionConfig.fromEnv(Map(
        "OUTPUT_HISTORY_MAX_AGE_DAYS_FREE" -> "abc", "OUTPUT_HISTORY_MAX_AGE_DAYS_BETA" -> "0", "OUTPUT_HISTORY_MAX_AGE_DAYS_OWNER" -> "-5",
        "OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES" -> "", "OUTPUT_HISTORY_MID_BUCKET_MINUTES" -> "x", "OUTPUT_HISTORY_OLD_BUCKET_HOURS" -> "6"
      ))
      c.maxAgeByTier shouldBe Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))
      c.purgeInterval shouldBe Duration.ofMinutes(60)
      c.policy.midBucket shouldBe Duration.ofHours(1)
      c.policy.oldBucket shouldBe Duration.ofHours(6)
    }

    "fall back to the default policy when the recent window is not shorter than the mid window" in {
      val c = OutputHistoryRetentionConfig.fromEnv(Map(
        "OUTPUT_HISTORY_RECENT_WINDOW_HOURS" -> "48", "OUTPUT_HISTORY_MID_WINDOW_DAYS" -> "2", "OUTPUT_HISTORY_OLD_BUCKET_HOURS" -> "6"
      ))
      c.policy shouldBe HistoryThinningPolicy()
    }

    "provide a cap for every tier" in {
      OutputHistoryRetentionConfig.fromEnv(Map.empty).maxAgeByTier.keySet shouldBe Set(UserTier.Free, UserTier.Beta, UserTier.Owner)
    }
  }
}
