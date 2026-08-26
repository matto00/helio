package com.helio.infrastructure.persistence.audit

import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.postgresql.util.PSQLException
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Demonstrates (not merely asserts) that `audit_events` (V91) is append-only
 *  — every UPDATE/DELETE/TRUNCATE raises rather than silently affecting zero
 *  rows — across every pool/role this repo has, following the real
 *  two-role-topology harness of `RlsPrivilegedDmlSpec`/`RlsOwnerTablesSpec`.
 *
 *  The RED transcripts this suite's evidence rests on (design.md Testing
 *  strategy item 6, tasks 5.6/5.6b) are captured separately — see
 *  `openspec/changes/audit-event-append-only-store/evidence.md` — because a
 *  suite that can genuinely fail cannot also be a suite this repo keeps
 *  green in CI. This class stays green permanently; its assertions are the
 *  live behaviour the captured reds were used to validate. */
class AuditEventsAppendOnlySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database = _
  private var superDb: JdbcBackend.Database = _ // owner/superuser connection — for TRUNCATE
  private var ctx: DbContext = _

  private val ownerA = UUID.randomUUID().toString
  private val ownerB = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

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
      // Mirrors RlsPrivilegedDmlSpec: the harness re-grants full DML to the
      // app-test role right after migration. This is deliberate — it is
      // exactly the "GRANT ... TO ALL TABLES" scenario tasks 5.2/5.4 must
      // survive, since a revoke-based mechanism would be defeated by it.
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
      // helio_privileged's UPDATE/DELETE/TRUNCATE on audit_events are left
      // REVOKED exactly as V91 leaves them — task 5.3 phase (a) depends on
      // that starting state.
      stmt.close()
    } finally {
      superConn.close()
    }

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    val superCfg = new HikariConfig()
    superCfg.setDataSource(superDs)
    superCfg.setMaximumPoolSize(5)
    superDb = JdbcBackend.Database.forDataSource(new HikariDataSource(superCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($ownerA::uuid, ${s"$ownerA@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($ownerB::uuid, ${s"$ownerB@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    superDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Insert a row via the privileged pool (the only pool that can insert —
   *  V91's owner policy is FOR SELECT only, so app-pool INSERT is denied
   *  outright) and return its id. */
  private def seedRow(actorUserId: Option[String]): String = {
    val id = UUID.randomUUID().toString
    val resourceId = UUID.randomUUID().toString
    val insert = actorUserId match {
      case Some(actor) =>
        sqlu"""INSERT INTO audit_events (id, actor_user_id, source, action, resource_type, resource_id, metadata, created_at)
               VALUES ($id::uuid, $actor::uuid, 'system', 'test.action', 'test-resource', $resourceId, '{}'::jsonb, now())"""
      case None =>
        sqlu"""INSERT INTO audit_events (id, actor_user_id, source, action, resource_type, resource_id, metadata, created_at)
               VALUES ($id::uuid, NULL, 'system', 'test.action', 'test-resource', $resourceId, '{}'::jsonb, now())"""
    }
    await(ctx.withSystemContext(insert))
    id
  }

  /** Extracts a PostgreSQL SQLSTATE from a (possibly wrapped) exception. */
  private def sqlState(t: Throwable): Option[String] = {
    var cur: Throwable = t
    while (cur != null) {
      cur match {
        case p: PSQLException => return Option(p.getSQLState)
        case _                =>
      }
      cur = cur.getCause
    }
    None
  }

  private def expectSqlState[T](state: String)(f: => Future[T]): Unit = {
    val thrown = intercept[Exception] {
      Await.result(f, 10.seconds)
    }
    sqlState(thrown) shouldBe Some(state)
  }

  // ── 5.5: positive control — INSERT on the privileged pool, SELECT on the app pool ──

  "the privileged pool (the pool append actually uses)" should {
    "INSERT successfully" in {
      noException should be thrownBy seedRow(Some(ownerA))
    }

    "reject a source value outside the ui/pat/mcp/system enum" in {
      val id = UUID.randomUUID().toString
      expectSqlState("23514") { // check_violation
        ctx.withSystemContext(
          sqlu"""INSERT INTO audit_events (id, actor_user_id, source, action, resource_type, resource_id, metadata, created_at)
                 VALUES ($id::uuid, $ownerA::uuid, 'bogus', 'test.action', 'test-resource', 'r1', '{}'::jsonb, now())"""
        )
      }
    }
  }

  "the app pool" should {
    "SELECT its own row" in {
      val id = seedRow(Some(ownerA))
      val rows = await(ctx.withUserContext(ownerA)(
        sql"SELECT id::text FROM audit_events WHERE id = $id::uuid".as[String]
      ))
      rows shouldBe Seq(id)
    }
  }

  // ── 5.2: app pool — targeted UPDATE/DELETE fail 23001 across three row classes ──

  "the app pool, issuing a TARGETED statement against a row it owns" should {
    "fail UPDATE with 23001" in {
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "fail DELETE with 23001" in {
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  "the app pool, issuing a TARGETED statement against another user's row (invisible to the caller's RLS context)" should {
    "fail UPDATE with 23001, not a silent zero-row success" in {
      val id = seedRow(Some(ownerB))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "fail DELETE with 23001, not a silent zero-row success" in {
      val id = seedRow(Some(ownerB))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  "the app pool, issuing a TARGETED statement against a NULL-actor (system) row" should {
    "fail UPDATE with 23001, not a silent zero-row success" in {
      val id = seedRow(None)
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "fail DELETE with 23001, not a silent zero-row success" in {
      val id = seedRow(None)
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  // ── 5.3: privileged pool, TWO PHASES ────────────────────────────────────

  "the privileged (BYPASSRLS) pool, phase (a): with the V91 REVOKE still in place" should {
    "fail UPDATE with 42501 permission denied — the defence-in-depth revoke working" in {
      val id = seedRow(Some(ownerA))
      expectSqlState("42501") {
        ctx.withSystemContext(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "fail DELETE with 42501 permission denied — the defence-in-depth revoke working" in {
      val id = seedRow(Some(ownerA))
      expectSqlState("42501") {
        ctx.withSystemContext(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  "the privileged (BYPASSRLS) pool, phase (b): after re-GRANTing UPDATE/DELETE to helio_privileged" should {
    // Both tests below re-issue this GRANT themselves rather than relying on
    // declaration order (AnyWordSpec runs tests in the order they are
    // declared, but re-issuing an idempotent GRANT costs nothing and removes
    // an implicit intra-suite ordering dependency that would otherwise break
    // silently under ParallelTestExecution or a shuffled runner — the exact
    // silent-failure shape this ticket exists to guard against). Issued by
    // the table owner/superuser connection — helio_privileged itself cannot
    // GRANT a privilege it does not hold.
    "fail UPDATE with 23001 — proof the trigger binds a BYPASSRLS role holding the privilege" in {
      await(superDb.run(sqlu"GRANT UPDATE, DELETE ON audit_events TO helio_privileged"))
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withSystemContext(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "fail DELETE with 23001 — proof the trigger binds a BYPASSRLS role holding the privilege" in {
      await(superDb.run(sqlu"GRANT UPDATE, DELETE ON audit_events TO helio_privileged"))
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withSystemContext(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  // ── 5.4: the case that distinguishes the trigger from the revoke ───────

  "the app role, after being freshly GRANTed full DML on all tables" should {
    // Both tests re-issue this GRANT themselves — same rationale as the 5.3
    // phase (b) block above: an idempotent GRANT is cheap, and doing so
    // removes an implicit ordering dependency on declaration order rather
    // than merely documenting it.
    "still fail UPDATE with 23001 — proof the trigger, not a revoke, is load-bearing" in {
      await(superDb.run(sqlu"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test"))
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"UPDATE audit_events SET action = 'tampered' WHERE id = $id::uuid")
      }
    }
    "still fail DELETE with 23001 — proof the trigger, not a revoke, is load-bearing" in {
      await(superDb.run(sqlu"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test"))
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        ctx.withUserContext(ownerA)(sqlu"DELETE FROM audit_events WHERE id = $id::uuid")
      }
    }
  }

  // ── 5.5b: TRUNCATE, issued by a role that can actually TRUNCATE ────────

  "TRUNCATE audit_events, issued by the table owner (the app pool's production role)" should {
    "fail with 23001 rather than erasing the table" in {
      val id = seedRow(Some(ownerA))
      expectSqlState("23001") {
        superDb.run(sqlu"TRUNCATE audit_events")
      }
      val stillThere = await(ctx.withSystemContext(
        sql"SELECT id::text FROM audit_events WHERE id = $id::uuid".as[String]
      ))
      stillThere shouldBe Seq(id)
    }
  }
}
