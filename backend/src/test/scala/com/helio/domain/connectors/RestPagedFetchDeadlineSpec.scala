package com.helio.domain.connectors

import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.Cancellable
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{HttpRequest, Uri}
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{Await, Future}

/** HEL-1013: the paging deadline holds on its own clock, in the window before the timer flag is set. The timer is
 *  replaced by one that never fires, so only the loop's own deadline checks can produce the budget error. */
class RestPagedFetchDeadlineSpec extends AnyWordSpec with Matchers with HelioRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val neverFires: (FiniteDuration, Runnable) => Cancellable = (_, _) =>
    new Cancellable {
      def cancel(): Boolean    = true
      def isCancelled: Boolean = true
    }

  private val nextLink = Seq(RawHeader("Link", "<http://h/items?p=2>; rel=\"next\""))

  private def run(issue: () => Either[String, PageResponse], calls: AtomicInteger): Either[String, PagedRows] = {
    val fetch = new RestPagedFetch(
      typedSystem,
      (_, _, _) => Future { calls.incrementAndGet(); Thread.sleep(150); issue() }(executor),
      _ => Right(Vector(JsNumber(1))),
      identity,
      50.millis,
      Some(neverFires)
    )(executor)
    Await.result(fetch.fetch(HttpRequest(uri = Uri("http://h/items?p=1")), RestPagination.Link(), 1000), 10.seconds)
  }

  private val budget = "Pagination exceeded its 50 ms total time budget after 0 completed pages"

  "RestPagedFetch past its deadline" should {
    "refuse to start another page after a page that finishes late" in {
      val calls = new AtomicInteger(0)
      run(() => Right(PageResponse(JsArray(JsNumber(1)), nextLink)), calls) shouldBe Left(budget)
      calls.get shouldBe 1
    }
    "report the curated budget text, not a page error, for a body discarded after the deadline" in {
      run(() => Left("Pagination total time budget exceeded"), new AtomicInteger(0)) shouldBe Left(budget)
    }
    "not return a final page as success when it completes after the deadline" in {
      run(() => Right(PageResponse(JsArray(JsNumber(1)), Nil)), new AtomicInteger(0)) shouldBe Left(budget)
    }
  }
}
