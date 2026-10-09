package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.{HistoryThinningPolicy, NodePayloadHistoryRepository, OutputHistoryRepository, RetentionPassOutcome}
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import scala.jdk.CollectionConverters._

import java.time.{Duration, Instant}
import scala.concurrent.Future

/** HEL-1272 (split out by HEL-1286): the output-history retention hook on
 *  `PipelineSchedulerService.tick` — a retention-purge failure, thrown or
 *  returned as a failed future, never fails the tick nor blocks its other
 *  work. Fixture shared through `PipelineSchedulerServiceFixture`. */
class PipelineSchedulerServiceMaintenanceHooksSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  "PipelineSchedulerService.tick" should {

    // HEL-1272: a retention-purge failure never fails the tick nor blocks its other work.
    def historyFailureCase(name: String, failing: => OutputHistoryRepository): Unit =
      name in {
        cleanDb(); seedUser()
        val pid = seedStaticPipeline()
        fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
        seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")
        val retention = new OutputHistoryRetentionService(failing, OutputHistoryRetentionConfig.fromEnv(Map.empty), fakeClock, new NodePayloadHistoryRepository(historyCtx), PayloadHistoryConfig.Defaults)
        val svc = new PipelineSchedulerService(
          scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, outputHistoryRetentionService = retention
        )
        val appender = new ListAppender[ILoggingEvent]()
        val logger   = LoggerFactory.getLogger(classOf[OutputHistoryRetentionService]).asInstanceOf[LogbackLogger]
        appender.start(); logger.addAppender(appender)
        try {
          noException should be thrownBy await(svc.tick())
          await(runRepo.listByPipelineInternal(pid)) should have size 1
          appender.list.asScala.exists(e => e.getLevel == Level.ERROR && e.getFormattedMessage.contains("Output history retention purge failed")) shouldBe true
        } finally logger.detachAppender(appender)
      }

    class FailingHistoryRepo(sync: Boolean) extends OutputHistoryRepository(historyCtx) {
      override def thinAndPurge(now: Instant, policy: HistoryThinningPolicy, caps: Map[UserTier, Duration], protectedNewest: Int): Future[RetentionPassOutcome] =
        if (sync) throw new IllegalStateException("boom-sync") else Future.failed(new IllegalStateException("boom-future"))
    }

    historyFailureCase("complete the tick, fire the due schedule and log when the history purge returns a failed future", new FailingHistoryRepo(sync = false))
    historyFailureCase("complete the tick, fire the due schedule and log when the history purge throws synchronously", new FailingHistoryRepo(sync = true))

    "complete the tick when the retention service itself fails (outer recover)" in {
      cleanDb(); seedUser()
      val pid = seedStaticPipeline()
      fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
      seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")
      val broken = new OutputHistoryRetentionService(new OutputHistoryRepository(historyCtx), OutputHistoryRetentionConfig.fromEnv(Map.empty), fakeClock, new NodePayloadHistoryRepository(historyCtx), PayloadHistoryConfig.Defaults) {
        override def purgeIfDue(now: Instant): Future[Option[Int]] = throw new IllegalStateException("service bug")
      }
      val svc = new PipelineSchedulerService(
        scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, outputHistoryRetentionService = broken
      )
      noException should be thrownBy await(svc.tick())
      await(runRepo.listByPipelineInternal(pid)) should have size 1
    }

  }
}
