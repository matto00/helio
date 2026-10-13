package com.helio.infrastructure.persistence.panels

import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SetParameter

import java.sql.Types
import scala.concurrent.ExecutionContext

/** HEL-1498: the ONE way a transaction locks the panel rows it may delete or update.
 *
 *  The system-wide lock order is "panel rows by id, then dashboard rows by id, then Output (and pipeline / step / root /
 *  source) rows" (V122's trigger locks dashboards by id; HEL-1485 put panel rows in front of that for dashboard
 *  deletes; HEL-1534, V130, makes this function lock the affected dashboards too, so a cascading delete takes the
 *  dashboard before the Output, the order a panel create already uses: dashboard `FOR UPDATE`, then the INSERT's
 *  KEY SHARE on the Output). Every transaction that updates or deletes
 *  two or more existing panel rows, directly or through an FK cascade, MUST call [[lockForDeletion]] as its first
 *  write, before anything else that locks or writes.
 *
 *  Invariants (violating any one re-opens the 40P01 this exists to close):
 *  - exactly ONE call per transaction: two id-ordered statements in sequence are not globally ordered;
 *  - it comes before any other row lock or write of the transaction (reads that lock nothing may precede it);
 *  - locking a superset is safe; locking too little is not;
 *  - `FOR UPDATE` skips a row a racer deleted and committed (READ COMMITTED recheck), so a lost race is not an error;
 *  - a panel CREATED after the lock and then deleted by the same cascade is locked late (residual, accepted in
 *    HEL-1485 and scoped out of HEL-1498); likewise a dashboard that gains its FIRST panel bound to a deleted Output
 *    after this call is locked late by V122, and a second create on it can still deadlock (HEL-1534 residual).
 *
 *  The lock runs in the migration's SECURITY DEFINER function (`hel1498_lock_panels`, V129; extended to lock dashboards by V130), not as an application
 *  `FOR UPDATE`: under RLS the acting user cannot see panels on another user's dashboard bound to their own
 *  pipeline's Output, yet the FK cascade deletes them, so only a bypass can order them. It returns void. */
object PanelRowLocks {

  private implicit val setTextArray: SetParameter[Seq[String]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("text", v.toArray[AnyRef]), Types.ARRAY)
  }

  /** Locks, in panel-id order, every panel that deleting the given dashboards, Outputs, pipelines, pipeline steps,
   *  pipeline roots or data sources can remove (see V129 for exactly which). Pass only what the transaction deletes. */
  def lockForDeletion(
      dashboards: Iterable[String] = Nil,
      outputs: Iterable[String] = Nil,
      pipelines: Iterable[String] = Nil,
      steps: Iterable[String] = Nil,
      roots: Iterable[String] = Nil,
      dataSources: Iterable[String] = Nil
  )(implicit ec: ExecutionContext): DBIO[Unit] = {
    val (d, o, p, s, r, ds) = (dashboards.toSeq, outputs.toSeq, pipelines.toSeq, steps.toSeq, roots.toSeq, dataSources.toSeq)
    if (Seq(d, o, p, s, r, ds).forall(_.isEmpty)) DBIO.successful(())
    else sql"SELECT hel1498_lock_panels($d, $o, $p, $s, $r, $ds)::text".as[String].map(_ => ())
  }
}
