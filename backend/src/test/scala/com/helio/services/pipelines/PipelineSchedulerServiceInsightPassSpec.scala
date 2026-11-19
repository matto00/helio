package com.helio.services.pipelines

import com.helio.services.insights.InsightTickPass
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{Await, Future, Promise}
import scala.concurrent.duration._

/** HEL-1743 D5: the insight pass rides the existing tick, started and not awaited, and a failing pass never fails the tick. */
class PipelineSchedulerServiceInsightPassSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  private def scheduler(pass: InsightTickPass) =
    new PipelineSchedulerService(scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, insightTickPass = pass)

  "PipelineSchedulerService.tick (insight pass)" should {
    "complete the tick when the pass fails asynchronously" in {
      cleanDb()
      val seen = new AtomicReference[Option[Instant]](None)
      Await.result(scheduler(now => { seen.set(Some(now)); Future.failed(new IllegalStateException("pass failed")) }).tick(), 10.seconds)
      seen.get should not be empty
    }
    "complete the tick when the pass throws synchronously" in {
      cleanDb()
      Await.result(scheduler(_ => throw new IllegalStateException("sync")).tick(), 10.seconds)
    }
    "not wait for a pass that never completes" in {
      cleanDb()
      val never = Promise[Unit]()
      Await.result(scheduler(_ => never.future).tick(), 10.seconds)
    }
  }
}
