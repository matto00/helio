package com.helio.services.pipelines

import com.helio.domain.insights.{InsightStatus, InsightTrigger, OutputInsightInsert}
import com.helio.domain.model.UserTier
import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.pipelines.OutputInsightRepository
import com.helio.testsupport.OutputHistoryApiHarness
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.{Duration, Instant}
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1742 retention: the insight part of the scheduler-tick pass deletes rows older than the pipeline
 *  owner's tier age, except each Output's newest `ok` row and newest attempt. */
class OutputInsightRetentionSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryApiHarness {

  override protected def harnessEc: ExecutionContext = ExecutionContext.global
  private implicit val ec: ExecutionContext          = harnessEc

  private var insightRepo: OutputInsightRepository = _
  private val config                               = OutputHistoryRetentionConfig.fromEnv(Map.empty)
  private val now                                  = Instant.parse("2026-06-30T00:00:00Z")
  private def ago(d: Long): Instant                = now.minus(Duration.ofDays(d))

  override def beforeAll(): Unit = { startHarness(); insightRepo = new OutputInsightRepository(ctx) }
  override def afterAll(): Unit  = stopHarness()

  private final class FakeClock extends Clock { override def now(): Instant = OutputInsightRetentionSpec.this.now }

  private def add(outputId: String, pipelineId: String, at: Instant, status: InsightStatus = InsightStatus.Ok): UUID = {
    awaitDb(db.run(insightRepo.insertAction(OutputInsightInsert(
      outputId, pipelineId, None, InsightTrigger.OnRun, status, if (status == InsightStatus.Ok) Some("md") else None, createdAt = at
    ))))
    UUID.fromString(awaitDb(db.run(sql"SELECT id::text FROM output_insights WHERE output_id = $outputId AND created_at = ${Timestamp.from(at)} ORDER BY id DESC LIMIT 1".as[String].head)))
  }

  private def survivors(outputId: String): Set[String] =
    awaitDb(db.run(sql"SELECT id::text FROM output_insights WHERE output_id = $outputId".as[String])).toSet

  private def purge(): Int = awaitDb(insightRepo.purge(now, config.maxAgeByTier))

  "OutputInsightRepository.purge" should {

    "delete rows past the owner tier's age and keep younger ones (free: 30 days)" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"), "insight")
      val newest     = add(oid, pid, ago(1))
      val young      = add(oid, pid, ago(29))
      val old        = add(oid, pid, ago(31))
      val older      = add(oid, pid, ago(60))
      purge()
      survivors(oid) shouldBe Set(newest, young).map(_.toString)
      (survivors(oid) intersect Set(old, older).map(_.toString)) shouldBe empty
    }

    "apply the beta and owner tier ages (90 and 365 days)" in {
      val (bp, bo) = seedPipelineWithOutput(seedUser("beta"), "insight")
      val (op, oo) = seedPipelineWithOutput(seedUser("owner"), "insight")
      Seq((bp, bo), (op, oo)).foreach { case (p, o) => add(o, p, ago(1)) }
      val betaKept   = add(bo, bp, ago(80))
      val betaGone   = add(bo, bp, ago(100))
      val ownerKept  = add(oo, op, ago(300))
      val ownerGone  = add(oo, op, ago(400))
      purge()
      survivors(bo) should (contain(betaKept.toString) and not contain betaGone.toString)
      survivors(oo) should (contain(ownerKept.toString) and not contain ownerGone.toString)
    }

    "keep an Output's only ok row past the age limit, and delete older non-latest rows" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"), "insight")
      val onlyOk     = add(oid, pid, ago(90))
      add(oid, pid, ago(120), InsightStatus.Failed)
      purge()
      survivors(oid) shouldBe Set(onlyOk.toString)
    }

    "keep both the newest ok row and the newest attempt when they differ" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"), "insight")
      val newestOk   = add(oid, pid, ago(50))
      val middle     = add(oid, pid, ago(49), InsightStatus.Failed)
      val newestAttempt = add(oid, pid, ago(48), InsightStatus.SkippedBudget)
      val olderOk    = add(oid, pid, ago(70))
      purge()
      survivors(oid) shouldBe Set(newestOk, newestAttempt).map(_.toString)
      (survivors(oid) intersect Set(middle, olderOk).map(_.toString)) shouldBe empty
    }

    "purge nothing for an empty tier map and be idempotent" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"), "insight")
      add(oid, pid, ago(1)); add(oid, pid, ago(200))
      awaitDb(insightRepo.purge(now, Map.empty)) shouldBe 0
      survivors(oid) should have size 2
      purge()
      survivors(oid) should have size 1
      purge()
      survivors(oid) should have size 1
    }
  }

  "OutputHistoryRetentionService" should {

    def service(insights: OutputInsightRepository): OutputHistoryRetentionService =
      new OutputHistoryRetentionService(historyRepo, config, new FakeClock, payloadRepo, PayloadHistoryConfig.Defaults, insights)

    "purge insight rows on the tick" in {
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"), "insight")
      val newest     = add(oid, pid, ago(1))
      add(oid, pid, ago(45))
      awaitDb(service(insightRepo).purgeIfDue(now)) shouldBe defined
      survivors(oid) shouldBe Set(newest.toString)
    }

    "not fail the pass (the history part still reports) when the insight purge fails" in {
      val failing = new OutputInsightRepository(ctx) {
        override def purge(n: Instant, caps: Map[UserTier, Duration]): Future[Int] =
          Future.failed(new IllegalStateException("insight purge boom"))
      }
      val svc = service(failing)
      awaitDb(svc.purgeIfDue(now)) shouldBe defined
    }
  }
}
