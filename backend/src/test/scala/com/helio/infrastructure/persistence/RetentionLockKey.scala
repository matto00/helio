package com.helio.infrastructure.persistence

import com.helio.infrastructure.persistence.pipelines.OutputHistoryRepository

/** HEL-1343 test helper: exposes the HEL-1272 retention advisory key (`private[persistence]`) to tests
 *  outside the persistence package, so no test duplicates the literal and drifts if it ever changes. */
object RetentionLockKey {
  val value: Long = OutputHistoryRepository.PurgeAdvisoryLockKey
}
