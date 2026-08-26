package com.helio.infrastructure.persistence.audit

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model._
import com.helio.domain.model.AuditEvent.NewAuditEvent
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** `AuditEventRepository`'s append/findByActor/findByResource, exercised
 *  through a real two-role topology (`helio_app_test` non-BYPASSRLS +
 *  `helio_privileged` BYPASSRLS) so the RLS read-scoping assertions are
 *  genuine — a single superuser connection is always RLS-exempt regardless
 *  of `FORCE ROW LEVEL SECURITY`, which would make those assertions
 *  vacuous (mirrors `AuditEventsAppendOnlySpec`/`RlsPrivilegedDmlSpec`).
 *
 *  `audit_events` can never be cleaned between runs (design.md Decision 6) —
 *  every assertion below is scoped to this run's own randomly-generated
 *  actor/resource values, never to the table's total contents. */
class AuditEventRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database = _
  private var ctx: DbContext = _
  private var repo: AuditEventRepository = _

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
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_app_test")
      stmt.execute("GRANT EXECUTE ON FUNCTION helio_can_access_dashboard(TEXT) TO helio_privileged")
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

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new AuditEventRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($id::uuid, ${s"$id@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    ))
    UserId(id)
  }

  // ── 6.1: append persists all fields; read filters ───────────────────────

  "append" should {
    "persist all supplied fields, retrievable via findByActor" in {
      val actor = freshUser()
      val resourceId = UUID.randomUUID().toString
      val metadata = JsObject("k" -> JsString("v"))

      val id = await(repo.append(NewAuditEvent(
        actorUserId  = Some(actor),
        actorTokenId = None,
        source       = AuditSource.Ui,
        action       = "dashboard.create",
        resourceType = "dashboard",
        resourceId   = Some(resourceId),
        metadata     = metadata
      )))
      id.value should not be empty

      val rows = await(repo.findByActor(actor, actor))
      rows should have size 1
      val row = rows.head
      row.id shouldBe id
      row.actorUserId shouldBe Some(actor)
      row.actorTokenId shouldBe None
      row.source shouldBe AuditSource.Ui
      row.action shouldBe "dashboard.create"
      row.resourceType shouldBe "dashboard"
      row.resourceId shouldBe Some(resourceId)
      row.metadata shouldBe metadata
    }
  }

  "findByActor" should {
    "return only that actor's events, newest-first" in {
      val actor = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"

      val id1 = await(repo.append(NewAuditEvent(Some(actor), None, AuditSource.Ui, "a.one", resourceType, None, JsObject.empty)))
      val id2 = await(repo.append(NewAuditEvent(Some(actor), None, AuditSource.Ui, "a.two", resourceType, None, JsObject.empty)))

      val rows = await(repo.findByActor(actor, actor))
      val ours = rows.filter(r => r.id == id1 || r.id == id2)
      ours.map(_.id) shouldBe Seq(id2, id1) // newest-first
    }
  }

  "findByResource" should {
    "return only events for that resource" in {
      val actor = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"
      val resourceIdA  = UUID.randomUUID().toString
      val resourceIdB  = UUID.randomUUID().toString

      val idA = await(repo.append(NewAuditEvent(Some(actor), None, AuditSource.Ui, "a", resourceType, Some(resourceIdA), JsObject.empty)))
      await(repo.append(NewAuditEvent(Some(actor), None, AuditSource.Ui, "b", resourceType, Some(resourceIdB), JsObject.empty)))

      val rows = await(repo.findByResource(actor, resourceType, resourceIdA))
      rows.map(_.id) shouldBe Seq(idA)
    }
  }

  // ── 6.2: RLS read scoping ─────────────────────────────────────────────

  "RLS read scoping" should {
    "let the app pool see only its own actor's rows, not another actor's or a NULL-actor row" in {
      val actorA = freshUser()
      val actorB = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"

      val idA = await(repo.append(NewAuditEvent(Some(actorA), None, AuditSource.Ui, "a", resourceType, None, JsObject.empty)))
      val idB = await(repo.append(NewAuditEvent(Some(actorB), None, AuditSource.Ui, "b", resourceType, None, JsObject.empty)))
      val idNull = await(repo.append(NewAuditEvent(None, None, AuditSource.System, "sys", resourceType, None, JsObject.empty)))

      val asA = await(repo.findByActor(actorA, actorA))
      asA.map(_.id) should contain(idA)
      asA.map(_.id) should not contain idB
      asA.map(_.id) should not contain idNull
    }

    "prove the RLS context user is the caller, not the filter argument" in {
      val callerA = freshUser()
      val actorB  = freshUser()

      val idB = await(repo.append(NewAuditEvent(Some(actorB), None, AuditSource.Ui, "b-only", s"res-${UUID.randomUUID()}", None, JsObject.empty)))

      // callerA asks "what did actorB do" — if the RLS context user were
      // wrongly derived from the actorB filter argument, this would
      // vacuously succeed and return actorB's row. It must return empty.
      val rows = await(repo.findByActor(callerA, actorB))
      rows.map(_.id) should not contain idB
      rows shouldBe empty
    }

    "let the privileged pool see all of this run's rows, including the NULL-actor row" in {
      val actorA = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"
      val runTag = UUID.randomUUID().toString

      val idA = await(repo.append(NewAuditEvent(Some(actorA), None, AuditSource.Ui, "a", resourceType, Some(runTag), JsObject.empty)))
      val idNull = await(repo.append(NewAuditEvent(None, None, AuditSource.System, "sys", resourceType, Some(runTag), JsObject.empty)))

      val rows = await(ctx.withSystemContext(
        sql"SELECT id::text FROM audit_events WHERE resource_type = $resourceType AND resource_id = $runTag".as[String]
      ))
      rows.toSet shouldBe Set(idA.value, idNull.value)
    }
  }

  // ── 6.4: model-shape check for Decision 4 ────────────────────────────────

  "the audit event model" should {
    "express a rate-limit-trip-shaped event (source=system, null actor, limit details in metadata) without any schema/model change" in {
      val metadata = JsObject(
        "limit"  -> JsNumber(120),
        "window" -> JsNumber(60),
        "bucket" -> JsString("session:abc123")
      )
      val id = await(repo.append(NewAuditEvent(
        actorUserId  = None,
        actorTokenId = None,
        source       = AuditSource.System,
        action       = "ratelimit.trip",
        resourceType = "rate-limit-bucket",
        resourceId   = Some("session:abc123"),
        metadata     = metadata
      )))
      id.value should not be empty
    }
  }
}
