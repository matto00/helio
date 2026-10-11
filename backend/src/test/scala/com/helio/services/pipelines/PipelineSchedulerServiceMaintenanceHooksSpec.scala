package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.{HistoryThinningPolicy, NodePayloadHistoryRepository, OutputHistoryRepository, HistoryPassOutcome, ThinBatchLimits}
import ch.qos.logback.classic.{Level, Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import scala.jdk.CollectionConverters._

import java.time.{Duration, Instant}
import scala.concurrent.{Future, Promise}

/** HEL-1272 (split out by HEL-1286): the output-history retention hook on
 *  `PipelineSchedulerService.tick` — a retention-purge failure, thrown or
 *  returned as a failed future, never fails the tick nor blocks its other
 *  work. HEL-1477: the pass is detached from the tick, so the pass is observed
 *  through the future the service returned (captured below), never by sleeping.
 *  Fixture shared through `PipelineSchedulerServiceFixture`. */
class PipelineSchedulerServiceMaintenanceHooksSpec extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture {

  "PipelineSchedulerService.tick" should {

    /** The real service, plus the future of the pass the tick started (the tick does not wait for it). */
    class CapturingRetention(repo: OutputHistoryRepository)
        extends OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), fakeClock, new NodePayloadHistoryRepository(historyCtx), PayloadHistoryConfig.Defaults) {
      private val started = Promise[Future[Option[Int]]]()
      override def purgeIfDue(now: Instant): Future[Option[Int]] = {
        val pass = super.purgeIfDue(now)
        started.trySuccess(pass)
        pass
      }
      def pass(): Future[Option[Int]] = started.future.flatMap(identity)
    }

    // HEL-1272: a retention-purge failure never fails the tick nor blocks its other work.
    def historyFailureCase(name: String, failing: => OutputHistoryRepository): Unit =
      name in {
        cleanDb(); seedUser()
        val pid = seedStaticPipeline()
        fakeClock.set(Instant.parse("2026-03-01T00:00:00Z"))
        seedSchedule(pid, nextRunAt = Some(fakeClock.now().minusSeconds(60)), expression = "30m")
        val retention = new CapturingRetention(failing)
        val svc = new PipelineSchedulerService(
          scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock, outputHistoryRetentionService = retention
        )
        val appender = new ListAppender[ILoggingEvent]()
        val logger   = LoggerFactory.getLogger(retention.getClass).asInstanceOf[LogbackLogger]
        appender.start(); logger.addAppender(appender)
        try {
          noException should be thrownBy await(svc.tick())
          await(runRepo.listByPipelineInternal(pid)) should have size 1
          await(retention.pass()) shouldBe None // the detached pass ended (it logs before it completes)
          appender.list.asScala.exists(e => e.getLevel == Level.ERROR && e.getFormattedMessage.contains("Output history retention purge failed")) shouldBe true
        } finally logger.detachAppender(appender)
      }

    class FailingHistoryRepo(sync: Boolean) extends OutputHistoryRepository(historyCtx) {
      override def thinPass(now: Instant, policy: HistoryThinningPolicy, caps: Map[UserTier, Duration], limits: ThinBatchLimits, startAfter: Option[String], protectedNewest: Int): Future[HistoryPassOutcome] =
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
