package com.helio.domain.connectors

import org.apache.pekko.actor.Cancellable
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.{HttpHeader, HttpRequest, Uri}
import spray.json.JsValue

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future, Promise}

/** One response of a REST request: its parsed body and its headers. */
final case class PageResponse(json: JsValue, headers: Seq[HttpHeader])

/** The rows of a paged fetch (at most `cap`, already cut) and the number of pages requested. */
final case class PagedRows(rows: Vector[JsValue], truncated: Boolean, pages: Int)

/** HEL-1013: the paging loop. Every page is issued through `issue`, the driver's single guarded issuer; this class owns
 *  only the sequencing, the stop conditions, the request bound and the total time budget.
 *
 *  `issue(request, afterGuard, bodyTimeout)` must run the egress guard first, then `afterGuard`, and read a 2xx body
 *  within `bodyTimeout()` (`None` = the deadline has passed: discard the body instead). */
final class RestPagedFetch(
    system: ActorSystem[_],
    issue: (HttpRequest, HttpRequest => Either[String, Unit], () => Option[FiniteDuration]) => Future[Either[String, PageResponse]],
    toRows: JsValue => Either[String, Vector[JsValue]],
    reapplyAuth: Uri => Uri,
    totalTimeout: FiniteDuration,
    // Test seam: replaces the deadline timer, so a test can prove the checks below hold in the window before it fires.
    startTimer: Option[(FiniteDuration, Runnable) => Cancellable] = None
)(implicit ec: ExecutionContext) {

  private def originOf(uri: Uri): (String, String, Int) = (uri.scheme.toLowerCase, uri.authority.host.address.toLowerCase, uri.effectivePort)

  private def budgetText: String =
    if (totalTimeout.toMillis % 1000 == 0) s"${totalTimeout.toSeconds} s" else s"${totalTimeout.toMillis} ms"

  def fetch(request: HttpRequest, pagination: RestPagination, cap: Int): Future[Either[String, PagedRows]] = {
    val deadline  = totalTimeout.fromNow
    val hit       = new AtomicBoolean(false)
    val completed = new AtomicInteger(0)
    val result    = Promise[Either[String, PagedRows]]()
    def budgetError = Left(s"Pagination exceeded its $budgetText total time budget after ${completed.get} completed pages")

    def overdue: Boolean = hit.get || deadline.isOverdue()
    val onDeadline = new Runnable { def run(): Unit = { hit.set(true); result.trySuccess(budgetError); () } }
    val timer      = startTimer.fold(system.scheduler.scheduleOnce(totalTimeout, onDeadline))(_(totalTimeout, onDeadline))

    val firstUri = RestPagination.firstUri(pagination, request.uri)
    val first    = if (firstUri == request.uri) request else request.withUri(reapplyAuth(firstUri))
    val origin   = originOf(first.uri)
    val sameOrigin: HttpRequest => Either[String, Unit] = r =>
      if (originOf(r.uri) == origin) Right(())
      else Left("The next page is on a different origin than the source, so it was refused to keep credentials from being sent there")
    val bodyTimeout: () => Option[FiniteDuration] = () => {
      val left = deadline.timeLeft
      if (left <= Duration.Zero) None else Some(left.min(30.seconds).max(1.millis))
    }
    val maxRequests = pagination.effectiveMaxRequests

    def loop(req: HttpRequest, n: Int, acc: Vector[JsValue], seen: Set[String]): Future[Either[String, PagedRows]] =
      if (overdue) Future.successful(budgetError)
      else {
        def named(err: String): Left[String, PagedRows] = Left(if (n == 1) err else s"Page $n: $err")
        issue(req, sameOrigin, bodyTimeout).flatMap {
          case Left(_) if overdue  => Future.successful(budgetError)
          case Left(err)           => Future.successful(named(err))
          case Right(_) if overdue => Future.successful(budgetError)
          case Right(page) =>
            toRows(page.json) match {
              case Left(err) => Future.successful(named(err))
              case Right(rows) =>
                completed.set(n)
                val all = acc ++ rows
                if (all.size > cap) Future.successful(Right(PagedRows(all.take(cap), truncated = true, pages = n)))
                else
                  RestPagination.next(pagination, firstUri, req.uri, n, page.json, page.headers, rows.size, seen) match {
                    case Left(err)   => Future.successful(Left(s"Page $n: $err"))
                    case Right(None) => Future.successful(Right(PagedRows(all, truncated = false, pages = n)))
                    case Right(Some(next)) =>
                      if (n >= maxRequests)
                        Future.successful(
                          Left(s"Pagination did not finish within maxRequests ($maxRequests requests) and the source has more pages; raise maxRequests (at most ${RestPagination.MaxMaxRequests}) or narrow the query")
                        )
                      else loop(first.withUri(reapplyAuth(next.uri)), n + 1, all, seen + next.key)
                  }
            }
        }
      }

    loop(first, 1, Vector.empty, Set(first.uri.toString)).onComplete { t =>
      timer.cancel()
      result.tryComplete(t)
    }
    result.future
  }
}
