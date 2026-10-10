package com.helio.infrastructure.persistence

import com.helio.domain.history.{PayloadHistoryConfig, PayloadTierLimit}
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, OutputHistoryRepository, RetentionPassOutcome}
import com.helio.testsupport.OutputHistoryFixtures
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject}

import java.sql.{Connection, SQLException}
import java.time.{Duration, Instant}
import java.util.UUID
import java.util.concurrent.{CountDownLatch, TimeUnit}
import javax.sql.DataSource
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.Try

/** HEL-1333: the run-side payload trim (`ON DELETE SET NULL` cascade onto `output_snapshot_history`)
 *  versus a concurrent history retention pass. Two-role topology exactly as `NodePayloadHistoryRlsSpec`:
 *  every proof runs as `helio_privileged` (the real run/retention pool) or `helio_app_test`
 *  (NOSUPERUSER, no BYPASSRLS); the superuser only sets `deadlock_timeout` (SUSET) before `SET ROLE`
 *  and observes `pg_locks`. Synchronisation is on observable state (`pg_locks`), never sleeps.
 *
 *  - the PROBE issues the pre-fix trim SQL verbatim on a second connection and asserts SQLSTATE 40P01;
 *  - the REGRESSION drives the real `writeAction` and is red without the lock guard (the run waits
 *    on the retention-held row instead of skipping the trim). */
class NodePayloadTrimPurgeLockOrderSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDs: DataSource                = _
  private var privilegedDb: JdbcBackend.Database = _ // helio_privileged, deadlock_timeout = 100ms
  private var appDb: JdbcBackend.Database        = _ // helio_app_test
  private var superDb: JdbcBackend.Database      = _
  private var ctx: DbContext                     = _
  private var payloadRepo: NodePayloadHistoryRepository = _
  private var outputRepo: OutputHistoryRepository       = _

  override protected def seedDb: JdbcBackend.Database = privilegedDb

  private val lockKey: Long = OutputHistoryRepository.PurgeAdvisoryLockKey
  // keep = 1 so the next write trims exactly one payload (P_old).
  private val cfg = PayloadHistoryConfig.Defaults.copy(beta = PayloadTierLimit(1, Duration.ofDays(7)))
  private val bound = 30.seconds // C1: every run-side Future is bounded

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

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

    // C2: deadlock_timeout is SUSET -- set it as the superuser BEFORE SET ROLE.
    def pool(role: String): JdbcBackend.Database = {
      val c = new HikariConfig()
      c.setDataSource(superDs)
      c.setMaximumPoolSize(5)
      c.setConnectionInitSql(s"SET deadlock_timeout = '100ms'; SET ROLE $role")
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

  // ---- scenario -----------------------------------------------------------------------------

  /** One pipeline with two opted-in Outputs, an old payload P_old linked to a point per Output.
   *  `first` / `last` are the linked points in heap (ctid) order -- the order the cascade locks. */
  private final case class Scenario(
      owner: String, pipelineId: String, outputIds: Seq[String], pOld: String, first: String, last: String
  )

  private def scenario(): Scenario = {
    val owner = seedUser("beta")
    val (pid, oid1) = seedPipelineWithOutput(owner)
    val oid2 = UUID.randomUUID().toString
    awaitDb(seedDb.run(
      sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, root_id)
             VALUES ($oid2, $pid, NULL, $owner::uuid, 'out2', 'metric', '{}'::jsonb, $pid)"""
    ))
    val pOld = UUID.randomUUID().toString
    awaitDb(seedDb.run(
      sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, root_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES ($pOld::uuid, $pid, NULL, $pid, 'manual', now() - interval '1 hour', 1, 7, '[{"a":0}]'::jsonb)"""
    ))
    Seq(oid1, oid2).foreach { oid =>
      awaitDb(seedDb.run(
        sqlu"""INSERT INTO output_snapshot_history
                 (id, output_id, pipeline_id, root_id, trigger_source, captured_at, row_count, summary, payload_id)
               VALUES (gen_random_uuid(), $oid, $pid, $pid, 'manual', now() - interval '1 hour', 1, '{"v":1}'::jsonb, $pOld::uuid)"""
      ))
    }
    // Empirical, not assumed: the order the RI cascade scans the linked points is TID order.
    val ordered = awaitDb(seedDb.run(
      sql"SELECT id::text FROM output_snapshot_history WHERE payload_id = $pOld::uuid ORDER BY ctid".as[String]
    ))
    ordered should have size 2
    Scenario(owner, pid, Seq(oid1, oid2), pOld, ordered.head, ordered.last)
  }

  /** A raw connection as helio_privileged (deadlock_timeout set by the superuser first), in a tx. */
  private def privConn(): Connection = {
    val c = superDs.getConnection
    val s = c.createStatement()
    s.execute("SET deadlock_timeout = '100ms'")
    s.execute("SET ROLE helio_privileged")
    s.close()
    c.setAutoCommit(false)
    c
  }

  /** The retention pass's shape: holds the HEL-1272 key exclusive and row-locks (deletes) `pointId`. */
  private def startRetention(pointId: String): Connection = {
    val a = privConn()
    val rs = a.createStatement().executeQuery(s"SELECT pg_try_advisory_xact_lock($lockKey)")
    rs.next() shouldBe true
    rs.getBoolean(1) shouldBe true
    a.createStatement().executeUpdate(s"DELETE FROM output_snapshot_history WHERE id = '$pointId'::uuid") shouldBe 1
    val who = a.createStatement().executeQuery("SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")
    who.next() shouldBe true
    who.getString(1) shouldBe "helio_privileged"
    who.getBoolean(2) shouldBe false
    a
  }

  private def ungrantedLocks(): Int =
    awaitDb(superDb.run(sql"SELECT count(*) FROM pg_locks WHERE NOT granted".as[Int].head))

  /** Polls pg_locks until some backend is blocked, bounded; never sleeps a fixed time. */
  private def awaitBlocked(): Boolean = {
    val deadline = System.nanoTime() + 10.seconds.toNanos
    var seen = false
    while (!seen && System.nanoTime() < deadline) { seen = ungrantedLocks() > 0; if (!seen) Thread.onSpinWait() }
    seen
  }

  private def payloadCount(pid: String): Int =
    awaitDb(seedDb.run(sql"SELECT count(*) FROM node_payload_history WHERE pipeline_id = $pid".as[Int].head))

  private def sqlState(e: Option[SQLException]): Option[String] = e.map(_.getSQLState)

  private val rowsOf = Vector(JsObject("a" -> JsNumber(1)))

  /** The real run-side composition (PipelineRunService: writeAction -> insertAction), one privileged tx,
   *  which also reports the session's role. */
  private def runWrite(s: Scenario): Future[(String, Boolean, Option[UUID])] =
    ctx.withSystemContext(
      for {
        who <- sql"SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)".as[(String, Boolean)].head
        id  <- payloadRepo.writeAction(s.pipelineId, None, Some(s.pipelineId), Some("r"), "manual", Instant.now(), rowsOf, cfg)
        _   <- outputRepo.insertAction(s.outputIds.map(o => historyEntry(o, s.pipelineId, Instant.now()).copy(rootId = Some(s.pipelineId), payloadId = id)))
      } yield (who._1, who._2, id)
    )

  // ---- the probe: pre-fix trim SQL reproduces 40P01 -----------------------------------------

  "the pre-fix payload trim against a retention-shaped transaction (probe)" should {

    "deadlock with SQLSTATE 40P01 when forced into the interleave on two connections" in {
      val s = scenario()
      val a = startRetention(s.last)
      val b = privConn()
      val fb = Future {
        try {
          b.createStatement().executeUpdate(
            s"""INSERT INTO node_payload_history (pipeline_id, node_step_id, root_id, trigger_source, captured_at, row_count, byte_size, rows)
                VALUES ('${s.pipelineId}', NULL, '${s.pipelineId}', 'manual', now(), 1, 7, '[{"a":1}]'::jsonb)""")
          // The PRE-FIX trim SQL, verbatim (unguarded), root-bound variant, keep = 1.
          b.createStatement().executeUpdate(
            s"""DELETE FROM node_payload_history WHERE id = (
                  SELECT id FROM node_payload_history WHERE pipeline_id = '${s.pipelineId}' AND node_step_id IS NULL AND root_id = '${s.pipelineId}'
                  ORDER BY captured_at DESC, id DESC OFFSET 1 LIMIT 1)""")
          Option.empty[SQLException]
        } catch { case e: SQLException => Some(e) }
      }
      var aErr: Option[SQLException] = None
      var blocked = false
      var bErr: Option[SQLException] = None
      try {
        blocked = awaitBlocked() // B holds P_old and the first point, and waits on the point A deleted
        try a.createStatement().executeUpdate(s"DELETE FROM output_snapshot_history WHERE id = '${s.first}'::uuid")
        catch { case e: SQLException => aErr = Some(e) }
      } finally {
        Try(a.rollback()); Try(a.close())
        bErr = Try(Await.result(fb, bound)).toOption.flatten
        Try(b.rollback()); Try(b.close())
      }
      info(s"PROBE blocked=$blocked A=${aErr.map(e => e.getSQLState + ": " + e.getMessage)} B=${bErr.map(e => e.getSQLState + ": " + e.getMessage)}")
      blocked shouldBe true
      // Which side PostgreSQL picks as the victim is nondeterministic; exactly one is.
      (sqlState(aErr) ++ sqlState(bErr)).toSeq shouldBe Seq("40P01")
    }
  }

  // ---- the regression: the real writeAction, red without the guard --------------------------

  "the real writeAction while a retention-shaped transaction holds the key and a linked point" should {

    "commit without waiting, let retention finish without a deadlock, skip the trim, and be reconciled by a later purge" in {
      val s = scenario()
      val a = startRetention(s.last)
      var completed = false
      var waiting   = false
      var aErr: Option[SQLException] = None
      var f: Future[(String, Boolean, Option[UUID])] = Future.failed(new IllegalStateException("not started"))
      try {
        f = runWrite(s)
        completed = Try(Await.ready(f, 5.seconds)).isSuccess
        waiting = ungrantedLocks() > 0
      } finally {
        // C1: unconditional cleanup. A deletes the other linked point (closing the cycle if the run is
        // stuck behind A), then commits only if the run already finished, then the run is awaited.
        try {
          a.createStatement().executeUpdate(s"DELETE FROM output_snapshot_history WHERE id = '${s.first}'::uuid")
          if (completed) a.commit() else a.rollback()
        } catch { case e: SQLException => aErr = Some(e); Try(a.rollback()) }
        finally { Try(a.close()); Try(Await.ready(f, bound)) }
      }
      info(s"REGRESSION completed=$completed waiting=$waiting retentionError=${aErr.map(_.getSQLState)} run=${f.value}")
      completed shouldBe true
      waiting shouldBe false
      aErr shouldBe None
      val (user, isSuper, id) = Await.result(f, bound)
      user shouldBe "helio_privileged"
      isSuper shouldBe false
      id should not be empty
      payloadCount(s.pipelineId) shouldBe 2 // keep + 1: the trim was skipped while retention ran
      awaitDb(payloadRepo.purge(Instant.now(), cfg)) should matchPattern { case RetentionPassOutcome.Purged(n) if n >= 1 => }
      payloadCount(s.pipelineId) shouldBe 1 // the later retention pass removed the excess
      awaitDb(seedDb.run(sql"SELECT count(*) FROM node_payload_history WHERE id = ${id.get.toString}::uuid".as[Int].head)) shouldBe 1
    }
  }

  // ---- positive controls and role assertions ------------------------------------------------

  "with no retention transaction open" should {

    "enforce the write-time cap, and the SET NULL cascade completes as helio_privileged under FORCE RLS" in {
      val s = scenario()
      val (user, isSuper, id) = awaitDb(runWrite(s))
      user shouldBe "helio_privileged"
      isSuper shouldBe false
      id should not be empty
      payloadCount(s.pipelineId) shouldBe 1 // keep: P_old trimmed at write time
      awaitDb(seedDb.run(sql"SELECT count(*) FROM node_payload_history WHERE id = ${s.pOld}::uuid".as[Int].head)) shouldBe 0
      // The cascade un-linked the points (it never deletes them).
      awaitDb(seedDb.run(
        sql"SELECT count(*) FROM output_snapshot_history WHERE id IN (${s.first}::uuid, ${s.last}::uuid) AND payload_id IS NULL".as[Int].head
      )) shouldBe 2
    }

    "let two concurrent writes both trim (the shared guard does not serialize or skip runs)" in {
      val s1 = scenario()
      val s2 = scenario()
      val latch = new CountDownLatch(2)
      def held(s: Scenario) = ctx.withSystemContext(
        payloadRepo.writeAction(s.pipelineId, None, Some(s.pipelineId), None, "manual", Instant.now(), rowsOf, cfg).flatMap { id =>
          // Both transactions are open and past their trim at the same moment: shared + shared coexist.
          DBIO.successful(()).map { _ =>
            latch.countDown()
            latch.await(10, TimeUnit.SECONDS) shouldBe true
            id
          }
        }
      )
      val f1 = held(s1)
      val f2 = held(s2)
      Await.result(Future.sequence(Seq(f1, f2)), bound).foreach(_ should not be empty)
      payloadCount(s1.pipelineId) shouldBe 1
      payloadCount(s2.pipelineId) shouldBe 1
    }
  }

  "the guard and the app role" should {

    "have the lock function executable by helio_privileged, and keep a stranger blind to the run's payload and points" in {
      awaitDb(superDb.run(
        sql"SELECT has_function_privilege('helio_privileged', 'pg_try_advisory_xact_lock_shared(bigint)', 'EXECUTE')".as[Boolean].head
      )) shouldBe true
      awaitDb(appDb.run(sql"SELECT current_user".as[String].head)) shouldBe "helio_app_test"
      awaitDb(appDb.run(sql"SELECT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false

      val s = scenario()
      val stranger = seedUser("beta")
      awaitDb(runWrite(s))._3 should not be empty
      def payloadsFor(user: String) =
        awaitDb(ctx.withUserContext(user)(sql"SELECT count(*) FROM node_payload_history WHERE pipeline_id = ${s.pipelineId}".as[Int].head))
      def pointsFor(user: String) =
        awaitDb(ctx.withUserContext(user)(sql"SELECT count(*) FROM output_snapshot_history WHERE pipeline_id = ${s.pipelineId}".as[Int].head))
      payloadsFor(s.owner) shouldBe 1
      pointsFor(s.owner) should be >= 2
      payloadsFor(stranger) shouldBe 0
      pointsFor(stranger) shouldBe 0
    }
  }
}
