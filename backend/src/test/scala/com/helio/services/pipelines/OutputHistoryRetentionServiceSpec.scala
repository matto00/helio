package com.helio.services.pipelines

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
      val svc   = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), clock)

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
      val svc   = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), clock)
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
      val svc = new OutputHistoryRetentionService(repo, OutputHistoryRetentionConfig.fromEnv(Map.empty), new FakeClock(now))
      val results = awaitDb(Future.sequence((1 to 8).map(_ => Future(svc.purgeIfDue(now)).flatten)))
      results.count(_.isDefined) shouldBe 1
    }
  }
}
