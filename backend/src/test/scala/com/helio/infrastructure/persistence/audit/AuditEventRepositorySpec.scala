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

  // ── HEL-488 tasks.md 1.3: findPaged RLS-scoped tenant isolation ─────────
  // Bound to the same non-BYPASSRLS helio_app_test / helio_privileged
  // two-role harness as the RLS read-scoping tests above — this is the
  // real, would-fail-red-if-RLS-were-bypassed assertion the skeptic (round
  // 1) required; not just the route-level test in AuditEventRoutesSpec.

  "findPaged" should {
    "let the app pool see only the calling user's own rows, never another user's, independent of the app-level actor filter" in {
      val callerA = freshUser()
      val actorB  = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"

      val idA = await(repo.append(NewAuditEvent(Some(callerA), None, AuditSource.Ui, "a", resourceType, None, JsObject.empty)))
      val idB = await(repo.append(NewAuditEvent(Some(actorB), None, AuditSource.Ui, "b", resourceType, None, JsObject.empty)))

      // Ask "what did actorB do" as caller A, with no filter naming actorB at
      // all (findPaged has no actorUserId filter param — Decision 3). This
      // proves findPaged's real return value never contains another user's
      // rows through its normal call path. It does NOT, by itself, prove RLS
      // is what's doing the scoping (see the next test, which diverges RLS
      // from the app-level filter via a raw-SQL probe) — findPaged's
      // app-level `actorUserId === callerUuid` clause is structurally always
      // identical to the RLS context user here, so this test alone would
      // still pass even if RLS were silently bypassed. We assert via the
      // privileged pool that idB genuinely exists (proving the "empty
      // because nothing was ever written" false-positive is impossible),
      // then assert the app-pool result never contains it.
      val idBExistsPrivileged = await(ctx.withSystemContext(
        sql"SELECT count(*) FROM audit_events WHERE id = ${idB.value}::uuid".as[Int]
      )).head
      idBExistsPrivileged shouldBe 1

      val result = await(repo.findPaged(callerA, AuditEventFilters(), Page(0, 200)))
      result.items.map(_.id) should contain(idA)
      result.items.map(_.id) should not contain idB
    }

    "never return another user's rows via RLS alone, independent of findPaged's Scala-level filter" in {
      // The test above cannot diverge RLS enforcement from findPaged's
      // app-level `actorUserId === callerUuid` clause: both are always
      // driven by the same `callerA` value, so a hypothetical
      // `withSystemContext` swap in `findPaged` (removing RLS scoping
      // entirely) would still pass, because the Scala-level filter alone
      // would coincidentally produce the same result. This test bypasses
      // `findPaged`'s Scala filter completely — it runs a raw SQL query,
      // querying explicitly for actorB's rows while the RLS context is set
      // to callerA — so it proves RLS itself is what scopes the result, not
      // the app-level clause (mirrors the `findByActor` divergent-filter
      // test above, extended to a raw-SQL probe on the app-pool connection).
      val callerA = freshUser()
      val actorB  = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"

      val idB = await(repo.append(NewAuditEvent(Some(actorB), None, AuditSource.Ui, "b-only", resourceType, None, JsObject.empty)))

      // Confirm via the privileged (BYPASSRLS) pool that idB genuinely
      // exists, ruling out an "empty because nothing was ever written"
      // false positive.
      val idBExistsPrivileged = await(ctx.withSystemContext(
        sql"SELECT count(*) FROM audit_events WHERE id = ${idB.value}::uuid".as[Int]
      )).head
      idBExistsPrivileged shouldBe 1

      // Raw SQL, on the app pool, with the RLS context set to callerA —
      // explicitly querying for actorB's row by id, with no reference to
      // findPaged or its Scala-level actorUserId filter at all. If RLS were
      // not enforced (or `withSystemContext` were substituted for
      // `withUserContext` in the calling code), this would return the row.
      val rawRows = await(ctx.withUserContext(callerA.value)(
        sql"SELECT id::text FROM audit_events WHERE id = ${idB.value}::uuid".as[String]
      ))
      rawRows shouldBe empty
    }

    "return empty for a caller with zero events, not another user's rows" in {
      val caller = freshUser()
      val other  = freshUser()
      await(repo.append(NewAuditEvent(Some(other), None, AuditSource.Ui, "x", s"res-${UUID.randomUUID()}", None, JsObject.empty)))

      val result = await(repo.findPaged(caller, AuditEventFilters(), Page(0, 200)))
      result.items shouldBe empty
      result.total shouldBe 0
    }

    "apply optional filters as AND, on top of the RLS/owner scope" in {
      val caller = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"
      val resourceId = UUID.randomUUID().toString

      val idMatch = await(repo.append(NewAuditEvent(
        Some(caller), None, AuditSource.Pat, "dashboard.delete", resourceType, Some(resourceId), JsObject.empty
      )))
      await(repo.append(NewAuditEvent(
        Some(caller), None, AuditSource.Ui, "dashboard.create", resourceType, Some(resourceId), JsObject.empty
      )))
      await(repo.append(NewAuditEvent(
        Some(caller), None, AuditSource.Pat, "dashboard.delete", resourceType, Some(UUID.randomUUID().toString), JsObject.empty
      )))

      val result = await(repo.findPaged(
        caller,
        AuditEventFilters(
          resourceType = Some(resourceType),
          resourceId   = Some(resourceId),
          action       = Some("dashboard.delete"),
          source       = Some(AuditSource.Pat)
        ),
        Page(0, 200)
      ))
      result.items.map(_.id) shouldBe Seq(idMatch)
    }

    "sort newest-first with a deterministic id tiebreak, stable across paging" in {
      val caller = freshUser()
      val resourceType = s"res-${UUID.randomUUID()}"

      val ids = (1 to 5).map { i =>
        await(repo.append(NewAuditEvent(Some(caller), None, AuditSource.Ui, s"a.$i", resourceType, None, JsObject.empty)))
      }

      val page1 = await(repo.findPaged(caller, AuditEventFilters(resourceType = Some(resourceType)), Page(0, 3)))
      val page2 = await(repo.findPaged(caller, AuditEventFilters(resourceType = Some(resourceType)), Page(3, 3)))

      page1.total shouldBe 5
      page1.items.map(_.id) ++ page2.items.map(_.id) shouldBe ids.reverse
      (page1.items.map(_.id).toSet intersect page2.items.map(_.id).toSet) shouldBe empty
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
