package com.helio.testsupport

import com.helio.infrastructure.persistence.pipelines.{LockSite, PipelineDefinitionLocks}
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

/** Locks that run one armed racer inside the write's transaction. `site = None`: before the next `lockPipelines`; `Some(s)`: at `choose(s)`. */
final class RaceLocks extends PipelineDefinitionLocks {
  private case class Armed(site: Option[LockSite], racer: () => Future[Any])
  @volatile private var armed: Option[Armed] = None
  def active(site: LockSite): Boolean = true
  def arm(site: Option[LockSite] = None)(racer: => Future[Any]): Unit = armed = Some(Armed(site, () => racer))
  private def fireIf(matches: Option[LockSite] => Boolean)(implicit e: ExecutionContext): DBIO[Unit] = armed.filter(a => matches(a.site)) match {
    case Some(a) => armed = None; DBIO.successful(()).flatMap(_ => DBIO.from(a.racer())).map(_ => ())
    case None    => DBIO.successful(())
  }
  override def lockPipelines(site: LockSite, ids: Seq[String])(implicit e: ExecutionContext): DBIO[Boolean] =
    fireIf(_.isEmpty).flatMap(_ => super.lockPipelines(site, ids))
  override def choose[A](site: LockSite, action: => DBIO[A], otherwise: => DBIO[A]): DBIO[A] =
    fireIf(_.contains(site))(ExecutionContext.parasitic).flatMap(_ => super.choose(site, action, otherwise))(ExecutionContext.parasitic)
}

