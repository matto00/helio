package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model.UserTier
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{HistoryPassOutcome, HistoryThinningPolicy, NodePayloadHistoryRepository, OutputHistoryRepository, RetentionPassOutcome, ThinBatchLimits}
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.{Duration, Instant}
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}

/** HEL-1477: at most one retention pass in flight per process. The pass is held open by a Promise (never a sleep)
 *  and `nextDue` is observed only through behaviour: a repository-call count after the clock moves, never an accessor.
 *  The pass's own `nextDue` is `now + 60 min` (a completed cycle), so "the busy call moved nothing" means a call at
 *  `now + 61 min` after the pass ends starts a new pass, which it would not if the busy call had re-claimed to
 *  `now + 61 min + 60 min`. */
class OutputHistoryRetentionInFlightSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(2))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private val InFlightNow = Instant.parse("2026-06-30T00:00:00Z")
  private val now        = InFlightNow
  private val intervalAt = now.plus(Duration.ofMinutes(60))
  private val laterAt    = now.plus(Duration.ofMinutes(61))
  private val fixedClock: Clock = new Clock { override def now(): Instant = InFlightNow }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Repositories whose passes are completed by the test. `history`/`payload` build the future per call. */
  private class HeldRepos(history: Int => Future[HistoryPassOutcome], payload: Int => Future[RetentionPassOutcome]) {
    val historyCalls = new AtomicInteger(0)
    val payloadCalls = new AtomicInteger(0)
    /** Completed the first time each part is entered: the deterministic hand-off (the pass starts on the pool). */
    val historyReached = Promise[Unit]()
    val payloadReached = Promise[Unit]()
    private val ctx = new DbContext(db, db)
    private val historyRepo: OutputHistoryRepository = new OutputHistoryRepository(ctx) {
      override def thinPass(n: Instant, p: HistoryThinningPolicy, caps: Map[UserTier, Duration], limits: ThinBatchLimits, startAfter: Option[String], protectedNewest: Int): Future[HistoryPassOutcome] =
        { historyReached.trySuccess(()); history(historyCalls.incrementAndGet()) }
    }
    private val payloadRepo: NodePayloadHistoryRepository = new NodePayloadHistoryRepository(ctx) {
      override def purge(n: Instant, cfg: PayloadHistoryConfig): Future[RetentionPassOutcome] =
        { payloadReached.trySuccess(()); payload(payloadCalls.incrementAndGet()) }
    }
    val service = new OutputHistoryRetentionService(historyRepo, OutputHistoryRetentionConfig.fromEnv(Map.empty), fixedClock, payloadRepo, PayloadHistoryConfig.Defaults, protectedNewest = 0)
  }

  private val purged: Int => Future[RetentionPassOutcome] = _ => Future.successful(RetentionPassOutcome.Purged(0))

  "OutputHistoryRetentionService in-flight guard (HEL-1477)" should {

    "not start a second pass while one is running, and leave the next-due time where the running pass put it" in {
      val held  = Promise[HistoryPassOutcome]()
      val repos = new HeldRepos(_ => held.future, purged)
      val first = repos.service.purgeIfDue(now)
      await(repos.historyReached.future)
      repos.historyCalls.get shouldBe 1
      first.isCompleted shouldBe false

      // Past the purge interval, so an unguarded service would claim the slot again and run a second pass.
      await(repos.service.purgeIfDue(laterAt)) shouldBe None
      repos.historyCalls.get shouldBe 1

      held.success(HistoryPassOutcome.Completed(5))
      await(first) shouldBe Some(5)

      // The busy call at laterAt must not have consumed the slot: the finished pass's own due time (now + 60 min) rules.
      await(repos.service.purgeIfDue(laterAt)) shouldBe Some(5)
      repos.historyCalls.get shouldBe 2
    }

    "release the guard when the history part fails with a future, then run the next due pass" in {
      val held  = Promise[HistoryPassOutcome]()
      val repos = new HeldRepos(_ => held.future, purged)
      val first = repos.service.purgeIfDue(now)
      await(repos.historyReached.future)
      await(repos.service.purgeIfDue(laterAt)) shouldBe None
      repos.historyCalls.get shouldBe 1
      held.failure(new IllegalStateException("boom-future"))
      await(first) shouldBe None
      repos.historyCalls.get shouldBe 1
      await(repos.service.purgeIfDue(intervalAt)); repos.historyCalls.get shouldBe 2
    }

    // A GUARD, not a red: on the unfixed code there is no guard to wedge, so it passes there. Its mutation: drop the
    // `andThen` release in `purgeIfDue` (evidence/mutation-5-andThen-release-dropped.log: it then fails, with the other four).
    "release the guard when the repository throws synchronously, then run the next due pass" in {
      val repos = new HeldRepos(n => if (n == 1) throw new IllegalStateException("boom-sync") else Future.successful(HistoryPassOutcome.Completed(0)), purged)
      await(repos.service.purgeIfDue(now)) shouldBe None
      repos.historyCalls.get shouldBe 1
      await(repos.service.purgeIfDue(intervalAt)); repos.historyCalls.get shouldBe 2
    }

    "hold the guard until the payload part has finished, not only the history part" in {
      val heldPayload = Promise[RetentionPassOutcome]()
      val repos = new HeldRepos(_ => Future.successful(HistoryPassOutcome.Completed(3)), _ => heldPayload.future)
      val first = repos.service.purgeIfDue(now)
      // History is done; the payload purge is not. A second pass must still be refused.
      await(repos.payloadReached.future)
      await(repos.service.purgeIfDue(laterAt)) shouldBe None
      repos.historyCalls.get shouldBe 1
      first.isCompleted shouldBe false
      heldPayload.success(RetentionPassOutcome.Purged(0))
      await(first) shouldBe Some(3)
      await(repos.service.purgeIfDue(intervalAt)); repos.historyCalls.get shouldBe 2
    }

    "not wedge the guard through a not-due call (3.1a)" in {
      val repos = new HeldRepos(_ => Future.successful(HistoryPassOutcome.Completed(0)), purged)
      await(repos.service.purgeIfDue(now)); repos.historyCalls.get shouldBe 1
      // Not due (half the interval): returns without starting anything and must release the guard.
      await(repos.service.purgeIfDue(now.plus(Duration.ofMinutes(30)))) shouldBe None
      repos.historyCalls.get shouldBe 1
      // Due: the pass runs, and while it is held a busy call is refused.
      val held          = Promise[HistoryPassOutcome]()
      val secondReached = Promise[Unit]()
      val repos2 = new HeldRepos(n => if (n == 1) Future.successful(HistoryPassOutcome.Completed(0)) else { secondReached.trySuccess(()); held.future }, purged)
      await(repos2.service.purgeIfDue(now))
      await(repos2.service.purgeIfDue(now.plus(Duration.ofMinutes(30)))) shouldBe None
      val second = repos2.service.purgeIfDue(intervalAt)
      await(secondReached.future)
      repos2.historyCalls.get shouldBe 2
      await(repos2.service.purgeIfDue(intervalAt.plus(Duration.ofMinutes(61)))) shouldBe None
      repos2.historyCalls.get shouldBe 2
      held.success(HistoryPassOutcome.Completed(0)); await(second)
    }
  }
}
