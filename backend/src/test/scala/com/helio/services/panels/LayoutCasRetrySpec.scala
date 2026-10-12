package com.helio.services.panels

import com.helio.domain.model._
import com.helio.services.ServiceError
import com.helio.services.panels.LayoutCasRetry.Attempt
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1457: the conflict policy shared by the two compare-and-set layout writers. */
class LayoutCasRetrySpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val now = Instant.parse("2026-01-01T00:00:00Z")
  private def dashboard(version: Long) =
    Dashboard(DashboardId("d"), "D", ResourceMeta("u", now, now), DashboardAppearance.Default, DashboardLayout.Default, UserId("u"), layoutVersion = version)

  private final class Counting(script: Dashboard => Attempt) {
    var reads: Vector[Long] = Vector.empty
    def attempt(read: Dashboard): Future[Attempt] = { reads :+= read.layoutVersion; Future.successful(script(read)) }
  }

  private def run(initial: Dashboard, expected: Option[Long], c: Counting) = Await.result(LayoutCasRetry.run(initial, expected)(c.attempt), 5.seconds)

  "LayoutCasRetry" should {
    "refuse at once, without an attempt, when the expected version is not the version read" in {
      val c = new Counting(d => Attempt.Finished(Right(d)))
      run(dashboard(3), Some(2), c) shouldBe Left(ServiceError.LayoutConflict(dashboard(3)))
      c.reads shouldBe empty
    }

    "retry against the row the miss returned when no version was expected, and succeed once it lands" in {
      val c = new Counting(d => if (d.layoutVersion < 2) Attempt.Moved(dashboard(d.layoutVersion + 1)) else Attempt.Finished(Right(d)))
      run(dashboard(0), None, c) shouldBe Right(dashboard(2))
      c.reads shouldBe Vector(0L, 1L, 2L)
    }

    "give up with a conflict after the third miss when no version was expected" in {
      val c = new Counting(d => Attempt.Moved(dashboard(d.layoutVersion + 1)))
      run(dashboard(0), None, c) shouldBe Left(ServiceError.LayoutConflict(dashboard(3)))
      c.reads should have size LayoutCasRetry.MaxAttempts.toLong
    }

    "never retry a miss when a version was expected" in {
      val c = new Counting(d => Attempt.Moved(dashboard(d.layoutVersion + 1)))
      run(dashboard(5), Some(5), c) shouldBe Left(ServiceError.LayoutConflict(dashboard(6)))
      c.reads shouldBe Vector(5L)
    }
  }
}
