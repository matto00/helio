package com.helio.infrastructure.persistence.pipelines

/** HEL-1343: result of one history/payload retention pass. `LockBusy` (the HEL-1272 advisory key was
 *  held by another session, nothing ran) is distinct from `Purged(0)` (ran, nothing eligible), so the
 *  caller can retry a lock-held skip soon instead of waiting a full purge interval. */
sealed trait RetentionPassOutcome

object RetentionPassOutcome {
  final case class Purged(deleted: Int) extends RetentionPassOutcome
  case object LockBusy extends RetentionPassOutcome
}
