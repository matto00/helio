package com.helio.infrastructure

import org.slf4j.MDC

import java.util.Map
import scala.concurrent.ExecutionContextExecutor

/** An [[ExecutionContextExecutor]] that restores a fixed SLF4J MDC snapshot
 *  around every task it runs, then restores the thread's previous MDC state.
 *
 *  HEL-116: the trace id is placed into the MDC at the HTTP request boundary
 *  (route-evaluation time), but the request's asynchronous log statements — the
 *  `onComplete { case Failure(ex) => log.error(...) }` callbacks in
 *  `ApiRoutes` — run on dispatcher threads whose MDC is empty (the callback is
 *  typically submitted when the upstream DB `Future` completes on a repository
 *  thread). A naive `MDC.put` in a directive, and even an MDC-propagating EC
 *  that captures the context at `execute`-time, therefore miss those logs.
 *
 *  This EC sidesteps the capture-timing pitfall by capturing the MDC map once,
 *  at construction (route-evaluation time, when the trace is present), and
 *  applying that same snapshot around each submitted task regardless of which
 *  thread the task later lands on. It always restores the prior MDC afterwards
 *  so a pooled worker thread never leaks the snapshot into unrelated work.
 *
 *  @param delegate the underlying EC that actually schedules the work
 *  @param snapshot the MDC map to install around each task (may be `null`,
 *                  meaning "empty MDC", matching `MDC.getCopyOfContextMap`)
 */
final class MdcPropagatingExecutionContext(
    delegate: ExecutionContextExecutor,
    snapshot: Map[String, String]
) extends ExecutionContextExecutor {

  override def execute(runnable: Runnable): Unit =
    delegate.execute(new Runnable {
      override def run(): Unit = {
        val previous = MDC.getCopyOfContextMap
        if (snapshot != null) MDC.setContextMap(snapshot) else MDC.clear()
        try runnable.run()
        finally {
          if (previous != null) MDC.setContextMap(previous) else MDC.clear()
        }
      }
    })

  override def reportFailure(cause: Throwable): Unit = delegate.reportFailure(cause)
}
