package com.helio.services.pipelines

import com.helio.domain.history.PayloadHistoryConfig
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.RetentionLockKey
import com.helio.infrastructure.persistence.pipelines.{HistoryThinningPolicy, NodePayloadHistoryRepository, RetentionPassOutcome}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.OutputHistoryRepository
import com.helio.testsupport.OutputHistoryFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.{Duration, Instant}
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1272: tick-level retention behaviour against embedded Postgres. Expected survivors are
 *  hand-derived (not recomputed from the bucket SQL):
 *
 *  `now` is a UTC midnight; points sit at `now - k*30min`, k = 1..1920 (age 30min .. exactly 40d).
 *   - age < 24h (k = 1..47): 5-minute buckets hold one point each -> all 47 survive.
 *   - 24h <= age < 7d (k = 48..335): hour buckets hold a :00 and :30 point; the newest (:30, odd k)
 *     wins, but k = 48 (age exactly 24h) sits alone in its class -> {48} + odd 49..335 = 145.
 *   - age >= 7d (k = 336..1920): day buckets; k = 336 (exactly 7d) sits alone in its class, then
 *     the newest of each remaining day is k = 337 + 48*i, i = 0..32 -> 1 + 33 = 34.
 *   - plus extras seeded at ages 8m, 7m, 3m: the 8m/7m pair shares the [23:50,23:55) bucket
 *     (7m, the newer, wins), 3m is alone -> +2.
 *  Owner (365d cap): 47 + 145 + 34 + 2 = 228.
 *  Free (30d cap, strict `<`, so k = 1440 at exactly 30d is kept): class-2 survivors are k = 336 and
 *  337 + 48*i for i = 0..22 (k <= 1393) = 24 -> 47 + 145 + 24 + 2 = 218. */
class OutputHistoryRetentionServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: OutputHistoryRepository      = _

  override protected def seedDb: JdbcBackend.Database = db

  private class FakeClock(@volatile var instant: Instant) extends Clock { override def now(): Instant = instant }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new OutputHistoryRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private val now = Instant.parse("2026-06-30T00:00:00Z")
  private def at(k: Int): Instant = now.minus(Duration.ofMinutes(30L * k))

  private def seedPoints(oid: String, pid: String): Unit = {
    val ks      = (1 to 1920).map(k => historyEntry(oid, pid, at(k)))
    val extras  = Seq(8, 7, 3).map(m => historyEntry(oid, pid, now.minus(Duration.ofMinutes(m.toLong))))
    awaitDb(new DbContext(db, db).withSystemContext(repo.insertAction(ks ++ extras)))
  }

  private def survivors(oid: String): Set[Instant] = awaitDb(repo.listRecent(oid, 5000)).map(_.capturedAt).toSet

  private def expectedKs(ks: Seq[Int]): Set[Instant] = ks.map(at).toSet
  private val extraSurvivors: Set[Instant] = Set(7, 3).map(m => now.minus(Duration.ofMinutes(m.toLong)))
  private val recentKs = 1 to 47
  private val midKs    = 48 +: (49 to 335 by 2)

  "OutputHistoryRetentionService.tickAt" should {

    "thin 40 days of free and owner history to exactly the hand-derived survivors" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val freeUser  = seedUser("free")
      val ownerUser = seedUser("owner")
      val (pF, oF)  = seedPipelineWithOutput(freeUser)
      val (pO, oO)  = seedPipelineWithOutput(ownerUser)
      seedPoints(oF, pF); seedPoints(oO, pO)
      historyCount(oF) shouldBe 1923
      val clock = new FakeClock(now)
      val svc   = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), clock, new NodePayloadHistoryRepository(new DbContext(db, db)), PayloadHistoryConfig.Defaults, protectedNewest = 0)

      val started = System.nanoTime()
      awaitDb(svc.tickAt(now))
      val millis = (System.nanoTime() - started) / 1000000
      info(s"measured tick duration on the 40-day fixture (2 Outputs x 1923 points): $millis ms")

      survivors(oO).size shouldBe 228
      survivors(oO) shouldBe expectedKs(recentKs ++ midKs ++ (336 +: (337 to 1873 by 48))) ++ extraSurvivors
      survivors(oF).size shouldBe 218
      survivors(oF) shouldBe expectedKs(recentKs ++ midKs ++ (336 +: (337 to 1393 by 48))) ++ extraSurvivors
      // Boundaries: k=1441 (just past 30d) is gone for free, k=1873 survives for owner, and the
      // 8-minute duplicate is thinned away.
      survivors(oF) should not contain now.minus(Duration.ofMinutes(8))
      survivors(oO) should contain(at(1873))
      survivors(oF) should not contain at(1441)
    }

    "be a no-op for a second tick inside the interval, then thin again at the interval" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"))
      val clock = new FakeClock(now)
      val svc   = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), clock, new NodePayloadHistoryRepository(new DbContext(db, db)), PayloadHistoryConfig.Defaults, protectedNewest = 0)
      awaitDb(svc.purgeIfDue(now)) shouldBe Some(0)

      // New thinnable points AFTER the first purge: two in one [now+10m, now+15m) bucket.
      awaitDb(new DbContext(db, db).withSystemContext(repo.insertAction(Seq(
        historyEntry(oid, pid, now.plus(Duration.ofMinutes(11))), historyEntry(oid, pid, now.plus(Duration.ofMinutes(12)))
      ))))
      historyCount(oid) shouldBe 2

      awaitDb(svc.purgeIfDue(now.plus(Duration.ofMinutes(59)))) shouldBe None
      historyCount(oid) shouldBe 2

      awaitDb(svc.purgeIfDue(now.plus(Duration.ofMinutes(60)))) shouldBe Some(1)
      survivors(oid) shouldBe Set(now.plus(Duration.ofMinutes(12)))
    }

    "allow only one of several concurrent due callers to run the purge" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val svc = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), new FakeClock(now), new NodePayloadHistoryRepository(new DbContext(db, db)), PayloadHistoryConfig.Defaults, protectedNewest = 0)
      val results = awaitDb(Future.sequence((1 to 8).map(_ => Future(svc.purgeIfDue(now)).flatten)))
      results.count(_.isDefined) shouldBe 1
    }
    "retry a lock-held skip after the short window, then restore the full interval (HEL-1343)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      awaitDb(db.run(sqlu"DELETE FROM node_payload_history"))
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"))
      // Three points in the one [23:55, 00:00) 5-minute bucket: thinning keeps only the newest.
      val ats = Seq("23:56:00", "23:57:00", "23:58:00").map(t => Instant.parse(s"2026-06-29T${t}Z"))
      awaitDb(new DbContext(db, db).withSystemContext(repo.insertAction(ats.map(historyEntry(oid, pid, _)))))
      val config = OutputHistoryRetentionConfig.fromEnv(Map.empty)
      val retry  = config.lockRetry
      retry shouldBe Duration.ofSeconds(120)
      val svc = new OutputHistoryRetentionService(repo, config, new FakeClock(now), new NodePayloadHistoryRepository(new DbContext(db, db)), PayloadHistoryConfig.Defaults, protectedNewest = 0)

      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        holder.createStatement().execute(s"SELECT pg_advisory_lock_shared(${RetentionLockKey.value})")
        awaitDb(svc.purgeIfDue(now)) shouldBe None
        historyCount(oid) shouldBe 3
        holder.createStatement().execute(s"SELECT pg_advisory_unlock_shared(${RetentionLockKey.value})")
      } finally holder.close()

      awaitDb(svc.purgeIfDue(now.plus(retry).minusSeconds(1))) shouldBe None
      historyCount(oid) shouldBe 3 // not retried before the window elapses

      awaitDb(svc.purgeIfDue(now.plus(retry))) shouldBe Some(2)
      survivors(oid) shouldBe Set(ats.last)

      // The retry succeeded, so the full interval applies again (fresh thinnable pair after the success).
      val t1 = now.plus(retry)
      awaitDb(new DbContext(db, db).withSystemContext(repo.insertAction(Seq(
        historyEntry(oid, pid, t1.plus(Duration.ofMinutes(11))), historyEntry(oid, pid, t1.plus(Duration.ofMinutes(12)))
      ))))
      historyCount(oid) shouldBe 3
      awaitDb(svc.purgeIfDue(t1.plus(config.purgeInterval).minusSeconds(1))) shouldBe None
      historyCount(oid) shouldBe 3
      awaitDb(svc.purgeIfDue(t1.plus(config.purgeInterval))) shouldBe Some(1)
      historyCount(oid) shouldBe 2
    }
  }

  /** Stub repositories that COUNT invocations: "ran" is a count increment, "not run" an unchanged count,
   *  never `purgeIfDue`'s return (None means both "not due" and "ran and failed"). */
  private class Stubs(history: () => RetentionPassOutcome, payload: () => RetentionPassOutcome) {
    val historyCalls = new AtomicInteger(0)
    val payloadCalls = new AtomicInteger(0)
    private val c = new DbContext(db, db)
    val historyRepo: OutputHistoryRepository = new OutputHistoryRepository(c) {
      override def thinAndPurge(n: Instant, p: HistoryThinningPolicy, caps: Map[UserTier, Duration], protectedNewest: Int): Future[RetentionPassOutcome] = {
        historyCalls.incrementAndGet()
        Future(history())
      }
    }
    val payloadRepo: NodePayloadHistoryRepository = new NodePayloadHistoryRepository(c) {
      override def purge(n: Instant, cfg: PayloadHistoryConfig): Future[RetentionPassOutcome] = {
        payloadCalls.incrementAndGet()
        Future(payload())
      }
    }
    def service: OutputHistoryRetentionService =
      new OutputHistoryRetentionService(historyRepo, OutputHistoryRetentionConfig.fromEnv(Map.empty), new FakeClock(now), payloadRepo, PayloadHistoryConfig.Defaults, protectedNewest = 0)
    def counts: (Int, Int) = (historyCalls.get, payloadCalls.get)
  }

  private val boom: () => RetentionPassOutcome = () => throw new IllegalStateException("boom")
  private val purged: () => RetentionPassOutcome = () => RetentionPassOutcome.Purged(0)
  private val busy: () => RetentionPassOutcome   = () => RetentionPassOutcome.LockBusy
  private val retryAt    = now.plus(Duration.ofSeconds(120))
  private val intervalAt = now.plus(Duration.ofMinutes(60))

  "OutputHistoryRetentionService failure cadence (HEL-1343)" should {

    "keep a failed history pass on the full interval, not the lock-retry window" in {
      val st = new Stubs(boom, purged); val svc = st.service
      awaitDb(svc.purgeIfDue(now)); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(retryAt)); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(intervalAt)); st.counts shouldBe ((2, 2))
    }

    "let a failure win over a lock-held payload part (full interval)" in {
      val st = new Stubs(boom, busy); val svc = st.service
      awaitDb(svc.purgeIfDue(now)); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(retryAt)); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(intervalAt)); st.counts shouldBe ((2, 2))
    }

    "retry a payload-only lock-held skip after the short window" in {
      val st = new Stubs(purged, busy); val svc = st.service
      awaitDb(svc.purgeIfDue(now)); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(retryAt.minusSeconds(1))); st.counts shouldBe ((1, 1))
      awaitDb(svc.purgeIfDue(retryAt)); st.counts shouldBe ((2, 2))
    }
  }
}
