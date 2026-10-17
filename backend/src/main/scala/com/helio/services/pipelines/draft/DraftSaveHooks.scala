package com.helio.services.pipelines.draft

import com.helio.infrastructure.persistence.pipelines.LockSite
import slick.dbio.DBIO

/** A point inside the draft save's single transaction at which a spec may park it or fail it. */
sealed trait DraftHookPoint
object DraftHookPoint {
  /** First action of the transaction, before any lock. */
  case object Begin extends DraftHookPoint
  /** The lock for `site` was just taken, in protocol order; lets a deadlock spec park the save BETWEEN two locks. */
  final case class AfterLock(site: LockSite) extends DraftHookPoint
  /** The locks are held and the fingerprint matched; nothing has been written. */
  case object AfterCompare extends DraftHookPoint
  case object AfterInserts extends DraftHookPoint
  case object AfterRelinks extends DraftHookPoint
  case object AfterDeletes extends DraftHookPoint
  case object AfterUpdates extends DraftHookPoint
  case object AfterOutputs extends DraftHookPoint
  /** Journal and audit rows written, the transaction about to commit. */
  case object BeforeCommit extends DraftHookPoint
}

/** Test seam for the race, deadlock and fault-injection specs (HEL-1629). A hook is a `DBIO` run INSIDE the save's
 *  transaction, so a spec can hold the transaction open at a known point (the race choreography) or fail it there (fault
 *  injection). Production uses [[DraftSaveHooks.None]]. */
trait DraftSaveHooks {
  def at(point: DraftHookPoint): DBIO[Unit]

  /** The save's transaction failed with `ex` before it was mapped to a `ServiceError` (a deadlock, say, which would
   *  otherwise surface only as a generic 500). Observability for the race and deadlock specs; no-op in production. */
  def failed(ex: Throwable): Unit = ()
}

object DraftSaveHooks {
  object None extends DraftSaveHooks {
    def at(point: DraftHookPoint): DBIO[Unit] = DBIO.successful(())
  }
}
