package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryRepository}
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.AppenderBase
import org.slf4j.LoggerFactory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.{Future, Promise}

/** HEL-1477: the scheduler tick starts the retention pass but never waits for it. The pass is a Promise the test
 *  never completes (no sleeps); the red on the old code is the tick future not completing within the fixture's
 *  bounded await. Fixture shared through `PipelineSchedulerServiceFixture`. */
class PipelineSchedulerServiceDetachedRetentionSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  "PipelineSchedulerService.tick" should {

    "complete and fire a due schedule while the retention pass is still running" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")
      val neverEnds = Promise[Option[Int]]()
      val started   = Promise[Unit]()
      val retention = new OutputHistoryRetentionService(
        new OutputHistoryRepository(historyCtx), OutputHistoryRetentionConfig.fromEnv(Map.empty), fakeClock,
        new NodePayloadHistoryRepository(historyCtx), PayloadHistoryConfig.Defaults
      ) {
        override def purgeIfDue(now: Instant): Future[Option[Int]] = { started.trySuccess(()); neverEnds.future }
      }
      val svc = new PipelineSchedulerService(
        scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, outputHistoryRetentionService = retention
      )

      noException should be thrownBy await(svc.tick())
      await(started.future) // the tick did start the pass
      neverEnds.isCompleted shouldBe false
      await(runRepo.listByPipelineInternal(pid)) should have size 1
    }

    // The scheduler-level recover logs a service failure that escaped the service's own recovers. The log is the only
    // observable (the detached future is discarded), so a Promise completed from the appender is the deterministic seam.
    def recoverCase(name: String, failure: => Future[Option[Int]]): Unit =
      name in {
        cleanDb(); seedUser()
        val retention = new OutputHistoryRetentionService(
          new OutputHistoryRepository(historyCtx), OutputHistoryRetentionConfig.fromEnv(Map.empty), fakeClock,
          new NodePayloadHistoryRepository(historyCtx), PayloadHistoryConfig.Defaults
        ) {
          override def purgeIfDue(now: Instant): Future[Option[Int]] = failure
        }
        val svc = new PipelineSchedulerService(
          scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, outputHistoryRetentionService = retention
        )
        val logged = Promise[Unit]()
        val appender = new AppenderBase[ILoggingEvent] {
          override def append(e: ILoggingEvent): Unit =
            if (e.getLevel == Level.ERROR && e.getFormattedMessage.contains("output history retention failed")) logged.trySuccess(())
        }
        val logger = LoggerFactory.getLogger(classOf[PipelineSchedulerService]).asInstanceOf[LogbackLogger]
        appender.start(); logger.addAppender(appender)
        try {
          noException should be thrownBy await(svc.tick())
          await(logged.future) // red without the scheduler's recover: nothing is ever logged, the bounded await times out
        } finally logger.detachAppender(appender)
      }

    recoverCase("log an error and still complete the tick when the retention service returns a failed future", Future.failed(new IllegalStateException("service bug")))
    recoverCase("log an error and still complete the tick when the retention service throws synchronously", throw new IllegalStateException("service bug"))
  }
}
