package com.helio.api.routes.proposals

import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContextExecutor, Future, Promise}

/** HEL-1610: in-flight tracker for the Claude-reaching service stack. A request denied at the gate
 *  must never reach Claude, but a regression that evaluates the service anyway makes its transport
 *  call only AFTER the response (grounding DB work comes first), so reading the transport count
 *  right after the response is blind to it. Everything on that path runs on [[ec]] over a
 *  [[TrackedDbContext]]; [[awaitQuiescence]] blocks (monitor latch, bounded, never a sleep) until
 *  every in-flight hop has finished, and only then may a guard read the transport count.
 *
 *  `ec` is a nested object (a singleton type) on purpose: see the spec's `implicit val ec` comment. */
final class InFlightTracker(base: => ExecutionContextExecutor) {
  private var count = 0
  private def inc(): Unit = synchronized { count += 1 }
  private def dec(): Unit = synchronized { count -= 1; if (count == 0) notifyAll() }

  def current: Int = synchronized(count)

  /** True once nothing is in flight; false if `timeoutMs` elapsed first. */
  def awaitQuiescence(timeoutMs: Long): Boolean = synchronized {
    val deadline  = System.nanoTime() + timeoutMs * 1000000L
    var remaining = timeoutMs
    while (count != 0 && remaining > 0) {
      wait(remaining)
      remaining = (deadline - System.nanoTime()) / 1000000L
    }
    count == 0
  }

  object ec extends ExecutionContextExecutor {
    override def execute(r: Runnable): Unit = {
      inc()
      try base.execute(() => try r.run() finally dec())
      catch { case e: Throwable => dec(); throw e }
    }
    override def reportFailure(t: Throwable): Unit = base.reportFailure(t)
  }

  /** Counts each DB hop from entry until its completion callbacks have been enqueued on [[ec]],
   *  so the counter cannot touch zero between a DB hop and the continuation that follows it. */
  class TrackedDbContext(db: JdbcBackend.Database) extends DbContext(db, db)(ec) {
    private def tracked[R](run: => Future[R]): Future[R] = {
      inc()
      val p = Promise[R]()
      try run.onComplete { r => p.complete(r); dec() }(ec)
      catch { case e: Throwable => dec(); throw e }
      p.future
    }
    override def withUserContext[R](userId: String)(action: DBIO[R]): Future[R] = tracked(super.withUserContext(userId)(action))
    override def withSystemContext[R](action: DBIO[R]): Future[R]                = tracked(super.withSystemContext(action))
  }
}
