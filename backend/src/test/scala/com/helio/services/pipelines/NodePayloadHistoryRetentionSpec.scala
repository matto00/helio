package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, RetentionPassOutcome}
import com.helio.testsupport.NodePayloadFixtures
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._

import java.time.{Duration, Instant}
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1276 retention (tasks 6.4, 6.8): the purge pass (age, newest-N, downgraded tiers, payloads no
 *  surviving point references), its place in the retention tick, and pipeline-delete cascades. */
class NodePayloadHistoryRetentionSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with NodePayloadFixtures {

  override protected def harnessEc: ExecutionContext = ExecutionContext.global
  private implicit val ec: ExecutionContext          = harnessEc

  override def beforeAll(): Unit = startHarness()
  override def afterAll(): Unit  = stopHarness()

  private val now = Instant.parse("2026-06-30T00:00:00Z")
  private def ago(d: Duration): Instant = now.minus(d)
  private def purge(): Int = awaitDb(payloadRepo.purge(now, PayloadHistoryConfig.Defaults)) match {
    case RetentionPassOutcome.Purged(n) => n
    case RetentionPassOutcome.LockBusy  => fail("payload purge unexpectedly reported LockBusy")
  }
  private def exists(id: String): Boolean =
    awaitDb(db.run(sql"SELECT count(*) FROM node_payload_history WHERE id = $id::uuid".as[Int].head)) == 1

  /** A payload plus a point that references it (so the unreferenced rule never fires). */
  private def seedPair(fx: PayloadFx, at: Instant): String = {
    val id = seedRawPayload(fx.pid.value, Some(fx.stepId.value), None, at)
    seedLinkedPoint(fx.optedOutput, fx.pid.value, Some(fx.stepId.value), at, Some(id))
    id
  }

  private final class FakeClock(var instant: Instant) extends Clock { override def now(): Instant = instant }

  "NodePayloadHistoryRepository.purge" should {

    "delete payloads older than the owner tier's age limit and keep younger ones" in {
      val fx      = seedPayloadPipeline(seedUser("beta")) // beta: 7 days
      val old     = seedPair(fx, ago(Duration.ofDays(8)))
      val young   = seedPair(fx, ago(Duration.ofDays(6)))
      purge()
      exists(old) shouldBe false
      exists(young) shouldBe true
    }

    "keep only the tier's newest N per node (beta 10 of 12)" in {
      val fx  = seedPayloadPipeline(seedUser("beta"))
      val ids = (1 to 12).map(i => seedPair(fx, ago(Duration.ofHours(i.toLong))))
      purge()
      ids.take(10).foreach(id => exists(id) shouldBe true)
      ids.drop(10).foreach(id => exists(id) shouldBe false)
    }

    "enforce the cap per node, not per pipeline" in {
      val owner = seedUser("beta")
      val fx    = seedPayloadPipeline(owner)
      val rootNode = (1 to 10).map(i => seedRawPayload(fx.pid.value, None, Some(fx.pid.value), ago(Duration.ofHours(i.toLong))))
      rootNode.foreach(id => seedLinkedPoint(fx.optedOutput, fx.pid.value, None, ago(Duration.ofHours(1)), Some(id)))
      val stepNode = (1 to 10).map(i => seedPair(fx, ago(Duration.ofHours(i.toLong))))
      purge()
      (rootNode ++ stepNode).foreach(id => exists(id) shouldBe true)
    }

    "delete every payload of a downgraded owner while keeping their summary points" in {
      val owner = seedUser("owner")
      val fx    = seedPayloadPipeline(owner)
      val ids   = (1 to 3).map(i => seedPair(fx, ago(Duration.ofHours(i.toLong))))
      purge()
      ids.foreach(id => exists(id) shouldBe true) // owner tier allows 30 runs / 30 days
      awaitDb(db.run(sqlu"UPDATE users SET tier = 'free' WHERE id = $owner::uuid"))
      purge()
      ids.foreach(id => exists(id) shouldBe false)
      pointCount(fx.optedOutput) shouldBe 3
      payloadLinks(fx.optedOutput).forall(_.isEmpty) shouldBe true
    }

    "delete a payload no summary point references, and keep a referenced one" in {
      val fx         = seedPayloadPipeline(seedUser("beta"))
      val orphan     = seedRawPayload(fx.pid.value, Some(fx.stepId.value), None, ago(Duration.ofHours(1)))
      val referenced = seedPair(fx, ago(Duration.ofHours(2)))
      purge()
      exists(orphan) shouldBe false
      exists(referenced) shouldBe true
    }
  }

  "the retention tick" should {

    "drop the payload of a summary point that thinning removed, in the same pass" in {
      val fx     = seedPayloadPipeline(seedUser("owner"))
      // 8 and 7 minutes before a UTC midnight share one 5-minute bucket: thinning keeps only the newer point.
      val older  = seedPair(fx, now.minus(Duration.ofMinutes(8)))
      val newer  = seedPair(fx, now.minus(Duration.ofMinutes(7)))
      val svc = new OutputHistoryRetentionService(
        historyRepo, OutputHistoryRetentionConfig.fromEnv(Map.empty), new FakeClock(now), payloadRepo, PayloadHistoryConfig.Defaults
      )
      awaitDb(svc.purgeIfDue(now)) shouldBe defined // shared DB: other tests' points are thinned too
      pointCount(fx.optedOutput) shouldBe 1
      exists(older) shouldBe false
      exists(newer) shouldBe true
    }

    "not undo or fail the summary purge when the payload purge fails" in {
      val fx = seedPayloadPipeline(seedUser("owner"))
      seedPair(fx, now.minus(Duration.ofMinutes(8)))
      seedPair(fx, now.minus(Duration.ofMinutes(7)))
      val failing = new NodePayloadHistoryRepository(ctx) {
        override def purge(at: Instant, config: PayloadHistoryConfig): Future[RetentionPassOutcome] = Future.failed(new IllegalStateException("payload purge boom"))
      }
      val svc = new OutputHistoryRetentionService(
        historyRepo, OutputHistoryRetentionConfig.fromEnv(Map.empty), new FakeClock(now), failing, PayloadHistoryConfig.Defaults
      )
      awaitDb(svc.purgeIfDue(now)) shouldBe defined // shared DB: other tests' points are thinned too
      pointCount(fx.optedOutput) shouldBe 1
    }
  }

  "deleting a pipeline that has payloads and linked points" should {
    "succeed through both cascade paths and leave nothing behind" in {
      val fx = seedPayloadPipeline(seedUser("beta"))
      val id = seedPair(fx, ago(Duration.ofHours(1)))
      seedPair(fx, ago(Duration.ofHours(2)))
      payloadCount(fx.pid.value) shouldBe 2
      awaitDb(db.run(sqlu"DELETE FROM pipelines WHERE id = ${fx.pid.value}")) shouldBe 1
      payloadCount(fx.pid.value) shouldBe 0
      pointCount(fx.optedOutput) shouldBe 0
      exists(id) shouldBe false
    }
  }
}
