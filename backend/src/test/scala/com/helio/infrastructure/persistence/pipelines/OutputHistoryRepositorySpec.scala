package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.OutputHistoryFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.time.temporal.ChronoUnit
import java.time.{Duration, Instant}
import java.util.UUID
import scala.concurrent.ExecutionContext

class OutputHistoryRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: OutputHistoryRepository      = _
  private var ctx: DbContext                     = _

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx  = new DbContext(db, db)
    repo = new OutputHistoryRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private val T0 = Instant.parse("2026-01-01T00:00:00Z")

  private def insert(entries: OutputHistoryInsert*): Unit = awaitDb(ctx.withSystemContext(repo.insertAction(entries)))

  private def fresh(tier: String = "free"): (String, String, String) = {
    val owner = seedUser(tier)
    val (pid, oid) = seedPipelineWithOutput(owner)
    (owner, pid, oid)
  }

  private def capturedAts(oid: String): Vector[Instant] = awaitDb(repo.listRecent(oid, 1000)).map(_.capturedAt).reverse

  "insertAction" should {

    "round-trip every column including the JSONB summary and a null run id" in {
      val (_, pid, oid) = fresh()
      insert(historyEntry(oid, pid, T0).copy(runId = None, nodeStepId = None, summary = JsObject("rows" -> JsNumber(7))))
      val p = awaitDb(repo.listRecent(oid, 10)).head
      p.runId shouldBe None
      p.rootId shouldBe Some(pid)
      p.pipelineId shouldBe pid
      p.triggerSource shouldBe "manual"
      p.capturedAt shouldBe T0
      p.rowCount shouldBe 1
      p.summary shouldBe JsObject("rows" -> JsNumber(7))
    }

    "be a no-op for an empty batch" in {
      noException should be thrownBy awaitDb(ctx.withSystemContext(repo.insertAction(Vector.empty)))
    }

    "store a hostile summary key as data, never as SQL" in {
      val (_, pid, oid) = fresh()
      val hostile = JsObject("x'); DROP TABLE output_snapshot_history; --" -> JsNumber(1))
      insert(historyEntry(oid, pid, T0).copy(summary = hostile))
      awaitDb(repo.listRecent(oid, 1)).head.summary shouldBe hostile
    }
  }

  "listRecent" should {

    "return newest first, honour the limit, and tie-break equal timestamps by id descending" in {
      val (_, pid, oid) = fresh()
      insert(historyEntry(oid, pid, T0), historyEntry(oid, pid, T0.plusSeconds(10)), historyEntry(oid, pid, T0.plusSeconds(10)), historyEntry(oid, pid, T0.plusSeconds(5)))
      val all = awaitDb(repo.listRecent(oid, 10))
      all.map(_.capturedAt) shouldBe Vector(T0.plusSeconds(10), T0.plusSeconds(10), T0.plusSeconds(5), T0)
      // Postgres orders uuid bytewise-unsigned, which matches lexicographic order of the hex string
      // (java.util.UUID's own compareTo is signed and does not).
      all.take(2).map(_.id.toString) shouldBe all.take(2).map(_.id.toString).sorted.reverse
      awaitDb(repo.listRecent(oid, 2)) should have size 2
    }

    "be empty for an Output with no history and ignore other Outputs" in {
      val (_, pid, oid)  = fresh()
      val (_, pid2, oid2) = fresh()
      insert(historyEntry(oid2, pid2, T0))
      awaitDb(repo.listRecent(oid, 10)) shouldBe empty
    }
  }

  "nearestAtOrBefore" should {

    "return the latest point at or before the instant, including exactly-at" in {
      val (_, pid, oid) = fresh()
      val Seq(t1, t2, t3) = Seq(T0, T0.plusSeconds(100), T0.plusSeconds(200))
      insert(historyEntry(oid, pid, t1), historyEntry(oid, pid, t2), historyEntry(oid, pid, t3))
      awaitDb(repo.nearestAtOrBefore(oid, t2.plusSeconds(50))).map(_.capturedAt) shouldBe Some(t2)
      awaitDb(repo.nearestAtOrBefore(oid, t2)).map(_.capturedAt) shouldBe Some(t2)
      awaitDb(repo.nearestAtOrBefore(oid, t3.plusSeconds(1))).map(_.capturedAt) shouldBe Some(t3)
    }

    "select the point exactly at latest minus 7d (microsecond-exact), not the 1us-earlier decoy nor the 1us-later point" in {
      val (_, pid, oid) = fresh()
      // Microsecond-exact: Postgres timestamptz stores micros, so each instant has getNano % 1000 == 0
      // and a non-millisecond micro component; the listRecent read-back proves nothing was rounded.
      val latest   = Instant.parse("2026-03-10T12:00:00.123456Z").truncatedTo(ChronoUnit.MICROS)
      val boundary = latest.minus(Duration.ofDays(7))
      val before   = boundary.minus(Duration.ofNanos(1000))
      val after    = boundary.plus(Duration.ofNanos(1000))
      val all      = Vector(before, boundary, after, latest)
      all.foreach(_.getNano % 1000 shouldBe 0)
      boundary.getNano % 1000000 should not be 0
      insert(all.map(historyEntry(oid, pid, _)): _*)
      capturedAts(oid) shouldBe all
      awaitDb(repo.nearestAtOrBefore(oid, latest.minus(Duration.ofDays(7)))).map(_.capturedAt) shouldBe Some(boundary)
    }

    "return None for an instant before the first point or for an empty Output" in {
      val (_, pid, oid) = fresh()
      insert(historyEntry(oid, pid, T0))
      awaitDb(repo.nearestAtOrBefore(oid, T0.minusSeconds(1))) shouldBe None
      awaitDb(repo.nearestAtOrBefore(fresh()._3, T0)) shouldBe None
    }
  }

  "earliest" should {

    "return the oldest captured_at, or None when there is no history" in {
      val (_, pid, oid) = fresh()
      awaitDb(repo.earliest(oid)) shouldBe None
      insert(historyEntry(oid, pid, T0.plusSeconds(9)), historyEntry(oid, pid, T0), historyEntry(oid, pid, T0.plusSeconds(3)))
      awaitDb(repo.earliest(oid)) shouldBe Some(T0)
    }
  }

  "thinAndPurge" should {
    val now    = Instant.parse("2026-06-30T12:00:00Z")
    val policy = HistoryThinningPolicy()
    val noAgeLimit = Map.empty[UserTier, Duration]

    // thinAndPurge is global across Outputs, so each test starts from an empty table to keep its
    // returned count meaningful.

    "keep only the newest point per 5-minute bucket inside the recent window" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pid, oid) = fresh()
      // Epoch-aligned bucket [11:55, 12:00): three points; bucket [11:50, 11:55): two points.
      val ats = Seq("11:56:00", "11:57:30", "11:59:59", "11:50:10", "11:54:00").map(t => Instant.parse(s"2026-06-30T${t}Z"))
      insert(ats.map(historyEntry(oid, pid, _)): _*)
      awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.Purged(3)
      capturedAts(oid) shouldBe Vector(Instant.parse("2026-06-30T11:54:00Z"), Instant.parse("2026-06-30T11:59:59Z"))
    }

    "thin to one point per hour between 1 and 7 days old and one per day beyond" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pid, oid) = fresh()
      val midA = now.minus(Duration.ofDays(2)).truncatedTo(ChronoUnit.HOURS)
      val oldA = now.minus(Duration.ofDays(20)).truncatedTo(ChronoUnit.DAYS)
      insert(
        historyEntry(oid, pid, midA.plusSeconds(60)), historyEntry(oid, pid, midA.plusSeconds(1800)),
        historyEntry(oid, pid, midA.plus(Duration.ofHours(1)).plusSeconds(5)),
        historyEntry(oid, pid, oldA.plus(Duration.ofHours(2))), historyEntry(oid, pid, oldA.plus(Duration.ofHours(20)))
      )
      awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.Purged(2)
      capturedAts(oid) shouldBe Vector(oldA.plus(Duration.ofHours(20)), midA.plusSeconds(1800), midA.plus(Duration.ofHours(1)).plusSeconds(5))
    }

    "keep every point that sits alone in its bucket" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pid, oid) = fresh()
      insert((0 until 5).map(i => historyEntry(oid, pid, now.minus(Duration.ofMinutes(10L * (i + 1))))): _*)
      awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.Purged(0)
      historyCount(oid) shouldBe 5
    }

    "thin each Output independently" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pidA, oidA) = fresh()
      val (_, pidB, oidB) = fresh()
      val at = Instant.parse("2026-06-30T11:56:00Z")
      insert(historyEntry(oidA, pidA, at), historyEntry(oidB, pidB, at.plusSeconds(30)))
      awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.Purged(0)
    }

    "purge points older than the owner's tier max age" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pidF, oidF) = fresh("free")
      val (_, pidO, oidO) = fresh("owner")
      val ancient = now.minus(Duration.ofDays(40))
      val recent  = now.minus(Duration.ofDays(10))
      insert(historyEntry(oidF, pidF, ancient), historyEntry(oidF, pidF, recent), historyEntry(oidO, pidO, ancient))
      val caps: Map[UserTier, Duration] = Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))
      awaitDb(repo.thinAndPurge(now, policy, caps)) shouldBe RetentionPassOutcome.Purged(1)
      capturedAts(oidF) shouldBe Vector(recent)
      historyCount(oidO) shouldBe 1
    }

    "fall back to the strictest supplied cap for a tier absent from the map (HEL-1272)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pidF, oidF) = fresh("free")
      val (_, pidO, oidO) = fresh("owner")
      val ancient = now.minus(Duration.ofDays(40))
      val recent  = now.minus(Duration.ofDays(10))
      insert(historyEntry(oidF, pidF, ancient), historyEntry(oidF, pidF, recent), historyEntry(oidO, pidO, ancient), historyEntry(oidO, pidO, recent))
      awaitDb(repo.thinAndPurge(now, policy, Map(UserTier.Free -> Duration.ofDays(30)))) shouldBe RetentionPassOutcome.Purged(2)
      capturedAts(oidF) shouldBe Vector(recent)
      capturedAts(oidO) shouldBe Vector(recent)
    }

    "apply the shortest of several supplied caps to a missing tier" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pidO, oidO) = fresh("owner")
      val at40 = now.minus(Duration.ofDays(40))
      val at20 = now.minus(Duration.ofDays(20))
      insert(historyEntry(oidO, pidO, at40), historyEntry(oidO, pidO, at20))
      awaitDb(repo.thinAndPurge(now, policy, Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(10)))) shouldBe RetentionPassOutcome.Purged(2)
      historyCount(oidO) shouldBe 0
    }

    "retain a shared pipeline's history on the pipeline owner's tier, not the Output creator's (HEL-1272)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val ownerTierUser = seedUser("owner")
      val (pid, _)      = seedPipelineWithOutput(ownerTierUser)
      val granteeFree   = seedUser("free")
      val oid           = UUID.randomUUID().toString
      // An Editor grantee's Output on the owner's pipeline: outputs.owner_id is the grantee.
      awaitDb(db.run(sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
                            VALUES ($oid, $pid, NULL, $granteeFree::uuid, 'shared', 'metric', '{}'::jsonb, $pid)"""))
      val at40 = now.minus(Duration.ofDays(40))
      insert(historyEntry(oid, pid, at40))
      val caps: Map[UserTier, Duration] = Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))
      awaitDb(repo.thinAndPurge(now, policy, caps)) shouldBe RetentionPassOutcome.Purged(0)
      capturedAts(oid) shouldBe Vector(at40)
    }

    "age-purge a tier the code does not know at the strictest cap (fails closed by construction)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      // `users.tier` is CHECK-constrained to free/beta/owner; drop that CHECK (embedded Postgres only)
      // to create a genuinely unknown tier, then restore it.
      val checkName = awaitDb(db.run(
        sql"""SELECT conname FROM pg_constraint
              WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%tier%'""".as[String].head
      ))
      awaitDb(db.run(sqlu"ALTER TABLE users DROP CONSTRAINT #$checkName"))
      var proUser = ""
      try {
        proUser = seedUser("pro")
        val (pid, oid) = seedPipelineWithOutput(proUser)
        val at40 = now.minus(Duration.ofDays(40))
        val at10 = now.minus(Duration.ofDays(10))
        insert(historyEntry(oid, pid, at40), historyEntry(oid, pid, at10))
        val caps: Map[UserTier, Duration] = Map(UserTier.Free -> Duration.ofDays(30), UserTier.Owner -> Duration.ofDays(365))
        awaitDb(repo.thinAndPurge(now, policy, caps)) shouldBe RetentionPassOutcome.Purged(1)
        capturedAts(oid) shouldBe Vector(at10)
      } finally {
        try {
          if (proUser.nonEmpty) awaitDb(db.run(DBIO.seq(
            sqlu"DELETE FROM pipelines WHERE owner_id = $proUser::uuid",
            sqlu"DELETE FROM data_sources WHERE owner_id = $proUser::uuid",
            sqlu"DELETE FROM users WHERE id = $proUser::uuid"
          )))
        } finally {
          awaitDb(db.run(sqlu"ALTER TABLE users ADD CONSTRAINT #$checkName CHECK (tier IN ('free', 'beta', 'owner'))"))
        }
      }
    }

    "skip the whole pass, deleting nothing, while another session holds the purge lock (HEL-1272)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pid, oid) = fresh()
      val ats = Seq("11:56:00", "11:57:00", "11:58:00").map(t => Instant.parse(s"2026-06-30T${t}Z"))
      insert(ats.map(historyEntry(oid, pid, _)): _*)
      val holder = embeddedPostgres.getPostgresDatabase.getConnection
      try {
        holder.createStatement().execute(s"SELECT pg_advisory_lock(${OutputHistoryRepository.PurgeAdvisoryLockKey})")
        awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.LockBusy
        historyCount(oid) shouldBe 3
        holder.createStatement().execute(s"SELECT pg_advisory_unlock(${OutputHistoryRepository.PurgeAdvisoryLockKey})")
      } finally holder.close()
      awaitDb(repo.thinAndPurge(now, policy, noAgeLimit)) shouldBe RetentionPassOutcome.Purged(2)
      historyCount(oid) shouldBe 1
    }

    "be idempotent: a second pass deletes nothing" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (_, pid, oid) = fresh()
      insert(Seq("11:56:00", "11:57:00", "11:58:00").map(t => historyEntry(oid, pid, Instant.parse(s"2026-06-30T${t}Z"))): _*)
      awaitDb(repo.thinAndPurge(now, policy, Map(UserTier.Free -> Duration.ofDays(30)))) should matchPattern { case RetentionPassOutcome.Purged(n) if n > 0 => }
      awaitDb(repo.thinAndPurge(now, policy, Map(UserTier.Free -> Duration.ofDays(30)))) shouldBe RetentionPassOutcome.Purged(0)
    }
  }

  "the output_id foreign key" should {

    "cascade: deleting an Output removes its history and no one else's" in {
      val (_, pid, oid)   = fresh()
      val (_, pid2, oid2) = fresh()
      insert(historyEntry(oid, pid, T0), historyEntry(oid, pid, T0.plusSeconds(1)), historyEntry(oid2, pid2, T0))
      awaitDb(db.run(sqlu"DELETE FROM outputs WHERE id = $oid")) shouldBe 1
      historyCount(oid) shouldBe 0
      historyCount(oid2) shouldBe 1
    }

    "reject a history row naming a non-existent Output" in {
      val (_, pid, _) = fresh()
      an[Exception] should be thrownBy insert(historyEntry(UUID.randomUUID().toString, pid, T0))
    }
  }
}
