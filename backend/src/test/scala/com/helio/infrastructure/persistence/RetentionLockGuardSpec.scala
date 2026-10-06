package com.helio.infrastructure.persistence

import com.helio.domain.history.{PayloadHistoryConfig, PayloadTierLimit}
import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.pipelines.{HistoryThinningPolicy, NodePayloadHistoryRepository, OutputHistoryRepository, RetentionPassOutcome}
import com.helio.testsupport.OutputHistoryFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.sql.{Connection, Timestamp}
import java.time.temporal.ChronoUnit
import java.time.{Duration, Instant}
import java.util.UUID
import java.util.concurrent.{CountDownLatch, TimeUnit}
import javax.sql.DataSource
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, blocking}
import scala.util.Try

/** HEL-1343: the REAL thin and age deletes (`thinAndPurge`) and payload purge (`purge`) under the HEL-1272
 *  advisory guard, on the two-role topology of `NodePayloadTrimPurgeLockOrderSpec` (every proof runs as
 *  `helio_privileged` / `helio_app_test`; the superuser only observes `pg_locks` and holds a row lock).
 *  Synchronisation is on `pg_locks` / held connections, never sleeps; every Future is bounded (30 s) and
 *  every latch/lock is released in `finally`.
 *
 *  - FORWARD: a real `writeAction` holds the key SHARED in an open transaction; both retention parts
 *    report `LockBusy` without waiting and delete nothing, then run to `Purged` after the commit.
 *  - REVERSE: a real `thinAndPurge` is parked inside its transaction (after its age deletes, blocked on a
 *    row lock in its thin delete); a real `writeAction` whose trim victim is the payload retention's
 *    deleted points link to must commit promptly with the trim skipped. */
class RetentionLockGuardSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDs: DataSource                = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var superDb: JdbcBackend.Database      = _
  private var ctx: DbContext                     = _
  private var payloadRepo: NodePayloadHistoryRepository = _
  private var outputRepo: OutputHistoryRepository       = _

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private val bound  = 30.seconds
  private val policy = HistoryThinningPolicy()
  private val caps   = Map[UserTier, Duration](UserTier.Beta -> Duration.ofDays(7))
  private val rowsOf = Vector(JsObject("a" -> JsNumber(1)))
  // Beta keeps 10 payloads per node for 7 days (forward: no trim victim). Reverse overrides keep to 1.
  private val cfg10 = PayloadHistoryConfig.Defaults.copy(beta = PayloadTierLimit(10, Duration.ofDays(7)))
  private val cfg1  = PayloadHistoryConfig.Defaults.copy(beta = PayloadTierLimit(1, Duration.ofDays(7)))
  // An hour-aligned `now` so the 5-minute thin buckets in the fixtures are deterministic.
  private val t0 = Instant.now().truncatedTo(ChronoUnit.HOURS)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.close()
    } finally superConn.close()

    def pool(role: String): JdbcBackend.Database = {
      val c = new HikariConfig()
      c.setDataSource(superDs)
      c.setMaximumPoolSize(5)
      c.setConnectionInitSql(s"SET ROLE $role")
      JdbcBackend.Database.forDataSource(new HikariDataSource(c), Some(5))
    }
    privilegedDb = pool("helio_privileged")
    appDb        = pool("helio_app_test")
    superDb      = JdbcBackend.Database.forDataSource(superDs, Some(3))
    ctx          = new DbContext(appDb, privilegedDb)
    payloadRepo  = new NodePayloadHistoryRepository(ctx)
    outputRepo   = new OutputHistoryRepository(ctx)
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close() }

  // ---- helpers ------------------------------------------------------------------------------

  private def clean(): Unit = {
    awaitDb(superDb.run(sqlu"DELETE FROM output_snapshot_history"))
    awaitDb(superDb.run(sqlu"DELETE FROM node_payload_history"))
  }

  private def insertPayload(pid: String, capturedAt: Instant): String = {
    val id = UUID.randomUUID().toString
    val ts = Timestamp.from(capturedAt)
    awaitDb(seedDb.run(
      sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, root_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES (CAST($id AS uuid), $pid, NULL, $pid, 'manual', $ts, 1, 7, '[{"a":0}]'::jsonb)"""
    ))
    id
  }

  private def insertPoint(oid: String, pid: String, capturedAt: Instant, payload: Option[String]): String = {
    val id = UUID.randomUUID().toString
    val ts = Timestamp.from(capturedAt)
    val p  = payload.orNull
    awaitDb(seedDb.run(
      sqlu"""INSERT INTO output_snapshot_history
               (id, output_id, pipeline_id, root_id, trigger_source, captured_at, row_count, summary, payload_id)
             VALUES (CAST($id AS uuid), $oid, $pid, $pid, 'manual', $ts, 1, '{"v":1}'::jsonb, CAST($p AS uuid))"""
    ))
    id
  }

  private def pointIds(oid: String): Set[String] =
    awaitDb(seedDb.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id = $oid".as[String])).toSet

  private def payloadIds(pid: String): Set[String] =
    awaitDb(seedDb.run(sql"SELECT id::text FROM node_payload_history WHERE pipeline_id = $pid".as[String])).toSet

  /** Polls `pg_locks` (bounded, never a fixed sleep) until `cond` holds. */
  private def awaitCondition(what: String)(cond: => Boolean): Unit = {
    val deadline = System.nanoTime() + 30.seconds.toNanos
    var ok = cond
    while (!ok && System.nanoTime() < deadline) { Thread.onSpinWait(); ok = cond }
    withClue(s"timed out waiting for: $what") { ok shouldBe true }
  }

  /** True once a backend holds the retention key EXCLUSIVE and is itself blocked on a not-granted lock. */
  private def retentionParkedOnRowLock(): Boolean =
    awaitDb(superDb.run(
      sql"""SELECT count(*) FROM pg_locks a JOIN pg_locks w ON w.pid = a.pid
            WHERE a.locktype = 'advisory' AND a.granted AND a.mode = 'ExclusiveLock'
              AND ((a.classid::bigint << 32) | a.objid::bigint) = ${RetentionLockKey.value}
              AND NOT w.granted""".as[Int].head
    )) > 0

  private def sharedKeyHeld(): Boolean =
    awaitDb(superDb.run(
      sql"""SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted AND mode = 'ShareLock'
              AND ((classid::bigint << 32) | objid::bigint) = ${RetentionLockKey.value}""".as[Int].head
    )) > 0

  "the two pools" should {
    "be the non-superuser privileged (BYPASSRLS) role and the non-superuser, non-BYPASSRLS app role" in {
      def flags(db: JdbcBackend.Database) =
        awaitDb(db.run(sql"SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user".as[(String, Boolean, Boolean)].head))
      flags(privilegedDb) shouldBe (("helio_privileged", false, true))
      flags(appDb) shouldBe (("helio_app_test", false, false))
    }
  }

  // ---- forward: a run holds the shared key ---------------------------------------------------

  "retention while a real writeAction holds the shared purge key in an open transaction" should {

    "report LockBusy for both thinAndPurge and purge without waiting or deleting, then purge exactly after the commit" in {
      clean()
      val beta        = seedUser("beta")
      val (pid, oid)  = seedPipelineWithOutput(beta)
      val (rpid, roid) = seedPipelineWithOutput(seedUser("beta"))
      // Output `oid`: A is age-eligible (20d > 7d cap, payload-linked); B1/B2 share one 5-minute bucket
      // (B1 older -> thinned, payload-linked); C is a lone recent survivor linked to P_keep.
      val pAged  = insertPayload(pid, t0.minus(Duration.ofDays(20)))
      val pThin  = insertPayload(pid, t0.minus(Duration.ofMinutes(4)))
      val pKeep  = insertPayload(pid, t0.minus(Duration.ofHours(2)))
      val pOrph  = insertPayload(pid, t0.minus(Duration.ofHours(1)))
      val a  = insertPoint(oid, pid, t0.minus(Duration.ofDays(20)), Some(pAged))
      val b1 = insertPoint(oid, pid, t0.minus(Duration.ofMinutes(4)), Some(pThin))
      val b2 = insertPoint(oid, pid, t0.minus(Duration.ofMinutes(3)), None)
      val c  = insertPoint(oid, pid, t0.minus(Duration.ofHours(2)), Some(pKeep))
      pointIds(oid) shouldBe Set(a, b1, b2, c)
      payloadIds(pid) shouldBe Set(pAged, pThin, pKeep, pOrph)

      val reached = new CountDownLatch(1)
      val release = new CountDownLatch(1)
      // Lazy: the Future (and so `reached`) starts only when the DBIO chain reaches this step, i.e. after the
      // shared try-lock was taken, never when `hold` is merely defined.
      val hold = DBIO.successful(()).flatMap(_ => DBIO.from(Future { blocking { reached.countDown(); release.await(30, TimeUnit.SECONDS) } }))
      var run: Future[Option[UUID]] = Future.failed(new IllegalStateException("not started"))
      try {
        run = ctx.withSystemContext(
          for {
            id <- payloadRepo.writeAction(rpid, None, Some(rpid), Some("r"), "manual", Instant.now(), rowsOf, cfg10)
            _  <- outputRepo.insertAction(Seq(historyEntry(roid, rpid, Instant.now()).copy(payloadId = id)))
            _  <- hold
          } yield id
        )
        reached.await(30, TimeUnit.SECONDS) shouldBe true
        // pg_locks-confirmed (self-checking): the run's session holds the key SHARED before retention is invoked.
        awaitCondition("the run holds a granted shared advisory lock on the retention key")(sharedKeyHeld())

        // The run's open transaction holds the shared key: both parts skip immediately.
        Await.result(outputRepo.thinAndPurge(t0, policy, caps), bound) shouldBe RetentionPassOutcome.LockBusy
        Await.result(payloadRepo.purge(t0, cfg10), bound) shouldBe RetentionPassOutcome.LockBusy
        pointIds(oid) shouldBe Set(a, b1, b2, c)
        payloadIds(pid) shouldBe Set(pAged, pThin, pKeep, pOrph)
        // The app role (no user context) sees none of the rows.
        awaitDb(appDb.run(sql"SELECT count(*) FROM output_snapshot_history".as[Int].head)) shouldBe 0
        awaitDb(appDb.run(sql"SELECT count(*) FROM node_payload_history".as[Int].head)) shouldBe 0
      } finally {
        release.countDown()
        Try(Await.ready(run, bound))
      }
      val runPayload = Await.result(run, bound)
      runPayload should not be empty

      // Committed: the key is free; both parts now run to the exact hand-derived result.
      Await.result(outputRepo.thinAndPurge(t0, policy, caps), bound) shouldBe RetentionPassOutcome.Purged(2) // A (age) + B1 (thin)
      pointIds(oid) shouldBe Set(b2, c)
      Await.result(payloadRepo.purge(t0, cfg10), bound) shouldBe RetentionPassOutcome.Purged(3) // pAged (age) + pThin + pOrph (unreferenced)
      payloadIds(pid) shouldBe Set(pKeep)
      payloadIds(rpid) shouldBe Set(runPayload.get.toString) // the run's own payload is referenced by its point
    }
  }

  // ---- reverse: retention holds the key, a run's trim is skipped ----------------------------

  "a real writeAction whose trim victim is linked to points retention already deleted" should {

    "commit promptly with the trim skipped while thinAndPurge is parked on a row lock, and retention then completes" in {
      clean()
      val (pid, oid) = seedPipelineWithOutput(seedUser("beta"))
      // P_old is the node's only payload (keep = 1), so after the write it is the trim victim.
      val pOld = insertPayload(pid, t0.minus(Duration.ofDays(20)))
      // Over-age points linked to P_old: retention's age deletes row-lock/delete them first.
      insertPoint(oid, pid, t0.minus(Duration.ofDays(20)), Some(pOld))
      insertPoint(oid, pid, t0.minus(Duration.ofDays(21)), Some(pOld))
      // X and Y share one 5-minute bucket: X (older) is thin-eligible, NOT age-eligible, NOT linked to P_old.
      val x = insertPoint(oid, pid, t0.minus(Duration.ofMinutes(4)), None)
      val y = insertPoint(oid, pid, t0.minus(Duration.ofMinutes(3)), None)
      // Preconditions (so a fixture tweak cannot make this vacuous).
      payloadIds(pid) shouldBe Set(pOld)
      awaitDb(seedDb.run(sql"SELECT count(*) FROM output_snapshot_history WHERE payload_id = CAST($pOld AS uuid)".as[Int].head)) shouldBe 2
      awaitDb(seedDb.run(sql"SELECT payload_id IS NULL FROM output_snapshot_history WHERE id = CAST($x AS uuid)".as[Boolean].head)) shouldBe true

      val holder: Connection = superDs.getConnection
      holder.setAutoCommit(false)
      var retention: Future[RetentionPassOutcome] = Future.failed(new IllegalStateException("not started"))
      var write: Future[Option[UUID]]             = Future.failed(new IllegalStateException("not started"))
      var writeCompleted = false
      try {
        holder.createStatement().executeQuery(s"SELECT id FROM output_snapshot_history WHERE id = '$x'::uuid FOR UPDATE").next() shouldBe true
        retention = outputRepo.thinAndPurge(t0, policy, caps)
        awaitCondition("thinAndPurge holds the key and waits on X's row lock")(retentionParkedOnRowLock())

        write = ctx.withSystemContext(payloadRepo.writeAction(pid, None, Some(pid), Some("r"), "manual", Instant.now(), rowsOf, cfg1))
        writeCompleted = Try(Await.ready(write, 10.seconds)).isSuccess
      } finally {
        Try(holder.rollback()); Try(holder.close())
        Try(Await.ready(retention, bound)); Try(Await.ready(write, bound))
      }
      withClue("the run's writeAction must commit promptly (trim skipped) while retention holds the key: ") { writeCompleted shouldBe true }
      val newId = Await.result(write, bound)
      newId should not be empty
      // keep + 1: the trim was skipped, so P_old is still there beside the new payload.
      payloadIds(pid) shouldBe Set(pOld, newId.get.toString)

      // Retention completes (no 40P01): 2 age deletes + X thinned = 3; Y survives.
      Await.result(retention, bound) shouldBe RetentionPassOutcome.Purged(3)
      pointIds(oid) shouldBe Set(y)
      payloadIds(pid) shouldBe Set(pOld, newId.get.toString)
    }
  }
}
