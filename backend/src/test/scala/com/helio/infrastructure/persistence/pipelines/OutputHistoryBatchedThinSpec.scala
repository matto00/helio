package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.{DbContext, RetentionLockKey}
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.{OldSingleStatementThin, OutputHistoryFixtures}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.{Duration, Instant}
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

private final case class Captured(ids: Set[String]) extends Exception

/** HEL-1435: the batched thin is proven against the verbatim pre-batching SQL ([[OldSingleStatementThin]], the oracle)
 *  and its bounding behaviour (row budget, batch budget, continuation, lock) is pinned. */
class OutputHistoryBatchedThinSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: OutputHistoryRepository      = _
  private var ctx: DbContext                     = _

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx  = new DbContext(db, db)
    repo = new OutputHistoryRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private val now    = Instant.parse("2026-06-30T12:00:00Z")
  private val policy = HistoryThinningPolicy()
  private val fullCaps: Map[UserTier, Duration] = Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))

  private def clear(): Unit = awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))

  private def survivorIds(): Set[String] = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history".as[String])).toSet

  /** The oracle's survivors: the old statements run in a transaction that is rolled back. */
  private def oracleSurvivors(caps: Map[UserTier, Duration], protectedNewest: Int): Set[String] = {
    val probe = OldSingleStatementThin.run(now, policy, caps, protectedNewest)
      .flatMap(_ => sql"SELECT id::text FROM output_snapshot_history".as[String])
      .flatMap(ids => DBIO.failed(Captured(ids.toSet)))
    val ex = intercept[Captured](awaitDb(db.run(probe.transactionally)))
    ex.ids
  }

  private def batchedSurvivors(caps: Map[UserTier, Duration], protectedNewest: Int, limits: ThinBatchLimits): Set[String] = {
    awaitDb(repo.thinAndPurge(now, policy, caps, protectedNewest, limits)) shouldBe a[RetentionPassOutcome.Purged]
    survivorIds()
  }

  private def seedRandom(outputs: Seq[(String, String)], rnd: Random): Unit =
    outputs.foreach { case (oid, pid) =>
      val n = rnd.nextInt(260)
      // Mix of clusters (ties on captured_at, sub-bucket cadences) and a spread across 40 days.
      val ats = (0 until n).map { _ =>
        rnd.nextInt(4) match {
          case 0 => now.minusSeconds(rnd.nextInt(3600 * 2))                // dense recent
          case 1 => now.minusSeconds(rnd.nextInt(3600 * 24 * 7))           // mid
          case 2 => now.minusSeconds(rnd.nextInt(3600 * 24 * 40))          // old (past the free cap)
          case _ => now.minusSeconds(60L * rnd.nextInt(40))                // many exact ties
        }
      }
      awaitDb(ctx.withSystemContext(repo.insertAction(ats.map(historyEntry(oid, pid, _)))))
    }

  private lazy val fixtureOutputs: Vector[(String, String)] = {
    val users = Seq("free", "free", "beta", "owner").map(seedUser(_))
    users.flatMap(u => (0 until 2).map(_ => seedPipelineWithOutput(u))).map { case (pid, oid) => (oid, pid) }.toVector
  }

  "the batched thin" should {

    "leave exactly the oracle's survivors across randomized fixtures and batch shapes" in {
      val shapes = Seq(
        ThinBatchLimits(1, 1000000, 1000), ThinBatchLimits(2, 1000000, 1000), ThinBatchLimits(3, 1000000, 1000),
        ThinBatchLimits(1000, 1000000, 1000), ThinBatchLimits(1000, 10, 1000), ThinBatchLimits(1000, 120, 1000)
      )
      val capSets = Seq[Map[UserTier, Duration]](fullCaps, Map(UserTier.Free -> Duration.ofDays(30)), Map.empty)
      for (trial <- 0 until 12; protectedNewest <- Seq(0, 5, 101); shape <- shapes) {
        clear()
        seedRandom(fixtureOutputs, new Random(trial * 1000L + protectedNewest))
        val caps = capSets(trial % capSets.size)
        val expected = oracleSurvivors(caps, protectedNewest)
        withClue(s"trial=$trial protected=$protectedNewest shape=$shape caps=${caps.keys}: ") {
          batchedSurvivors(caps, protectedNewest, shape) shouldBe expected
        }
      }
    }

    "report more work after a one-batch budget, thin only the first batch, and drain to the oracle result" in {
      clear()
      seedRandom(fixtureOutputs, new Random(42))
      val expected = oracleSurvivors(fullCaps, 0)
      val firstTwo = fixtureOutputs.map(_._1).sorted.take(2)
      def idsAfter(cursor: String): Set[String] =
        awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id > $cursor".as[String])).toSet
      val beforeRest = idsAfter(firstTwo.last)
      val limits   = ThinBatchLimits(batchOutputs = 2, batchRows = 1000000, maxBatches = 1)
      val first    = awaitDb(repo.thinPass(now, policy, fullCaps, limits, None, 0))
      first shouldBe a[HistoryPassOutcome.MoreWork]
      val cursor = first.asInstanceOf[HistoryPassOutcome.MoreWork].resumeAfter
      cursor shouldBe firstTwo.last
      // Outputs beyond the cursor are untouched by pass 1.
      beforeRest.size should be > 0
      idsAfter(cursor) shouldBe beforeRest
      val afterFirstAll = survivorIds()
      afterFirstAll.size should be > expected.size

      var outcome: HistoryPassOutcome = first
      var passes = 1
      while (outcome.isInstanceOf[HistoryPassOutcome.MoreWork]) {
        outcome = awaitDb(repo.thinPass(now, policy, fullCaps, limits, Some(outcome.asInstanceOf[HistoryPassOutcome.MoreWork].resumeAfter), 0))
        passes += 1
      }
      outcome shouldBe a[HistoryPassOutcome.Completed]
      passes shouldBe 5 // 8 Outputs, 2 per batch, 1 batch per pass; the 5th batch is the empty final one (tasks C5)
      survivorIds() shouldBe expected
    }

    "split batches on the row limit and keep a single oversized Output as a batch of its own" in {
      clear()
      val (oidA, pidA) = fixtureOutputs(0)
      val (oidB, pidB) = fixtureOutputs(1)
      val (oidC, pidC) = fixtureOutputs(2)
      // Row counts 30 / 30 / 5: with a 40-row limit A (30) is admitted, B (30) would exceed -> next batch.
      Seq((oidA, pidA, 30), (oidB, pidB, 30), (oidC, pidC, 5)).foreach { case (o, p, n) =>
        awaitDb(ctx.withSystemContext(repo.insertAction((0 until n).map(i => historyEntry(o, p, now.minusSeconds(3600L * 24 * 2 + 3600L * i)))))) // hourly: nothing thinnable
      }
      val ids    = Seq(oidA, oidB, oidC).sorted
      val limits = ThinBatchLimits(batchOutputs = 100, batchRows = 40, maxBatches = 1)
      // Candidate order is by id over ALL Outputs (fixtureOutputs has 8, five empty); with one batch per pass,
      // follow the cursor until it passes every seeded Output and count the passes that reached a seeded Output.
      var cursor: Option[String] = None
      var batchesWithRows = 0
      var done = false
      while (!done) {
        awaitDb(repo.thinPass(now, policy, Map.empty, limits, cursor, 0)) match {
          case HistoryPassOutcome.MoreWork(_, at) =>
            val seededInBatch = ids.filter(i => i > cursor.getOrElse("") && i <= at)
            if (seededInBatch.nonEmpty) batchesWithRows += 1
            cursor = Some(at)
          case HistoryPassOutcome.Completed(_) =>
            if (ids.exists(_ > cursor.getOrElse(""))) batchesWithRows += 1
            done = true
          case other => fail(s"unexpected $other")
        }
      }
      // 65 rows cannot fit one 40-row batch: at least two batches carried seeded Outputs.
      batchesWithRows should be >= 2
    }

    "keep committed batches and resume at the cursor when the lock is taken between passes" in {
      clear()
      seedRandom(fixtureOutputs, new Random(7))
      val expected = oracleSurvivors(fullCaps, 0)
      val limits   = ThinBatchLimits(batchOutputs = 2, batchRows = 1000000, maxBatches = 1)
      val first    = awaitDb(repo.thinPass(now, policy, fullCaps, limits, None, 0)).asInstanceOf[HistoryPassOutcome.MoreWork]
      val afterFirst = survivorIds()
      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        holder.createStatement().execute(s"SELECT pg_advisory_lock_shared(${RetentionLockKey.value})")
        awaitDb(repo.thinPass(now, policy, fullCaps, limits, Some(first.resumeAfter), 0)) shouldBe HistoryPassOutcome.LockHeld(0, Some(first.resumeAfter))
        survivorIds() shouldBe afterFirst // committed batch stays; nothing else touched
        holder.createStatement().execute(s"SELECT pg_advisory_unlock_shared(${RetentionLockKey.value})")
      } finally holder.close()
      val drained = awaitDb(repo.thinAndPurge(now, policy, fullCaps, 0, ThinBatchLimits(2, 1000000, 1)))
      drained shouldBe a[RetentionPassOutcome.Purged]
      survivorIds() shouldBe expected
    }

    "keep the batches committed before a lock taken part-way through ONE pass and resume at the real cursor" in {
      clear()
      seedRandom(fixtureOutputs, new Random(23))
      val sortedIds = fixtureOutputs.map(_._1).sorted
      val cursor    = sortedIds(1) // batch 1 = the first two Outputs
      def idsUpTo(c: String): Set[String] = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id <= $c".as[String])).toSet
      def idsAfter(c: String): Set[String] = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id > $c".as[String])).toSet
      val oracle = oracleSurvivors(fullCaps, 0)
      val oracleUpTo = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id <= $cursor".as[String])).toSet.intersect(oracle)
      val oracleAfter = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id > $cursor".as[String])).toSet.intersect(oracle)
      val beforeAfter = idsAfter(cursor)
      val beforeUpTo  = idsUpTo(cursor)

      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      // The shared lock is taken right after the FIRST batch transaction completes, i.e. between batch 1 and batch 2
      // of the same pass (the map runs before the pass's next batch starts).
      val completed = new AtomicInteger(0)
      val lockingCtx = new DbContext(db, db) {
        override def withSystemContext[R](action: DBIO[R]): Future[R] =
          super.withSystemContext(action).map { r =>
            if (completed.incrementAndGet() == 1) holder.createStatement().execute(s"SELECT pg_advisory_lock_shared(${RetentionLockKey.value})")
            r
          }
      }
      val lockingRepo = new OutputHistoryRepository(lockingCtx)
      val limits      = ThinBatchLimits(batchOutputs = 2, batchRows = 1000000, maxBatches = 5)
      try {
        val out = awaitDb(lockingRepo.thinPass(now, policy, fullCaps, limits, None, 0))
        out match {
          case HistoryPassOutcome.LockHeld(deleted, at) =>
            deleted should be > 0
            at shouldBe Some(cursor)
            val removedInBatch1 = beforeUpTo.size - idsUpTo(cursor).size
            deleted shouldBe removedInBatch1
          case other => fail(s"expected LockHeld, got $other")
        }
        idsUpTo(cursor) shouldBe oracleUpTo   // batch 1 committed and equal to the oracle
        idsAfter(cursor) shouldBe beforeAfter // the rest untouched
        holder.createStatement().execute(s"SELECT pg_advisory_unlock_shared(${RetentionLockKey.value})")
      } finally holder.close()

      // A fresh thinnable pair in a batch-1 Output: a retry that restarted the cycle would thin it, one that resumes would not.
      val (o1, p1) = fixtureOutputs.find(_._1 == sortedIds.head).get
      val older = Instant.parse("2026-06-30T11:56:30.123Z")
      awaitDb(ctx.withSystemContext(repo.insertAction(Seq(historyEntry(o1, p1, older), historyEntry(o1, p1, older.plusSeconds(10))))))
      val olderId = awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id = $o1 AND captured_at = ${Timestamp.from(older)}".as[String])).head

      val retry = awaitDb(repo.thinPass(now, policy, fullCaps, ThinBatchLimits(2, 1000000, 100), Some(cursor), 0))
      retry shouldBe a[HistoryPassOutcome.Completed]
      idsAfter(cursor) shouldBe oracleAfter
      awaitDb(db.run(sql"SELECT count(*) FROM output_snapshot_history WHERE id = CAST($olderId AS uuid)".as[Int].head)) shouldBe 1

      // And the pair really was thinnable: a full drain from the start removes the older point.
      awaitDb(repo.thinAndPurge(now, policy, fullCaps, 0, ThinBatchLimits(2, 1000000, 100))) shouldBe a[RetentionPassOutcome.Purged]
      awaitDb(db.run(sql"SELECT count(*) FROM output_snapshot_history WHERE id = CAST($olderId AS uuid)".as[Int].head)) shouldBe 0
    }
  }
}
