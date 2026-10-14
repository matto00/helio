package com.helio.infrastructure.persistence

import com.helio.testkit.VerifiedEmbeddedPostgres
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1574: V134 RLS on `dashboard_folders` and `dashboard_folder_assignments`, run as NOSUPERUSER NOBYPASSRLS
 *  roles -- the superuser test DB used by route specs bypasses every policy (MISTAKES.md), so only this spec proves
 *  them. Run for a non-owner role and for the TABLE OWNER (the only way FORCE ROW LEVEL SECURITY is exercised;
 *  production's migration user owns the tables). */
class DashboardFolderRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {
  private implicit val ec: ExecutionContext = ExecutionContext.global
  private var pg: EmbeddedPostgres = _
  private var superDb, privDb, appDb, ownerRoleDb: JdbcBackend.Database = _
  private var ctx, ownerCtx: DbContext = _
  private var userA, userB: String = _
  private var dashA, dashB: String = _
  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val ds = pg.getPostgresDatabase
    Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    val c = ds.getConnection
    try {
      val s = c.createStatement()
      s.execute("CREATE ROLE rls_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOLOGIN")
      s.execute("CREATE ROLE rls_owner NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOLOGIN")
      s.execute("GRANT rls_app TO postgres"); s.execute("GRANT rls_owner TO postgres")
      s.execute("GRANT USAGE ON SCHEMA public TO rls_app, rls_owner")
      s.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_app, rls_owner")
      s.execute("ALTER TABLE dashboard_folders OWNER TO rls_owner")
      s.execute("ALTER TABLE dashboard_folder_assignments OWNER TO rls_owner")
      s.close()
    } finally c.close()
    def pool(role: Option[String]) = {
      val cfg = new HikariConfig(); cfg.setDataSource(ds); cfg.setMaximumPoolSize(6)
      role.foreach(r => cfg.setConnectionInitSql(s"SET ROLE $r"))
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(6))
    }
    superDb = pool(None); privDb = pool(Some("helio_privileged")); appDb = pool(Some("rls_app")); ownerRoleDb = pool(Some("rls_owner"))
    ctx = new DbContext(appDb, privDb); ownerCtx = new DbContext(ownerRoleDb, privDb)
    userA = UUID.randomUUID().toString; userB = UUID.randomUUID().toString
    dashA = UUID.randomUUID().toString; dashB = UUID.randomUUID().toString
    await(superDb.run(DBIO.seq(
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($userA::uuid, ${s"$userA@example.test"}, now())",
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($userB::uuid, ${s"$userB@example.test"}, now())",
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashA, 'a', $userA, now(), now(), '{}', '{"lg":[],"md":[],"sm":[],"xs":[]}', $userA::uuid)""",
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashB, 'b', $userB, now(), now(), '{}', '{"lg":[],"md":[],"sm":[],"xs":[]}', $userB::uuid)""")))
  }
  override def afterAll(): Unit = { appDb.close(); ownerRoleDb.close(); privDb.close(); superDb.close(); pg.close() }

  private def roleFlags(db: JdbcBackend.Database) =
    await(db.run(sql"SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user".as[(String, Boolean, Boolean)].head))

  for ((label, dbf, ctxf) <- Seq(("rls_app (non-owner)", () => appDb, () => ctx), ("rls_owner (TABLE OWNER, FORCE matters)", () => ownerRoleDb, () => ownerCtx))) {
    s"V134 folder tables under $label" should {
      "run as NOSUPERUSER NOBYPASSRLS" in {
        val (_, su, by) = roleFlags(dbf()); su shouldBe false; by shouldBe false
      }
      "have RLS enabled and forced with one owner policy each, with a WITH CHECK" in {
        for (t <- Seq("dashboard_folders", "dashboard_folder_assignments")) {
          val flags = await(dbf().run(sql"SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $t".as[(Boolean, Boolean)].head))
          flags shouldBe ((true, true))
          val pol = await(dbf().run(sql"SELECT policyname, with_check FROM pg_policies WHERE tablename = $t".as[(String, Option[String])]))
          pol.map(_._1) shouldBe Vector(s"${t}_owner")
          pol.head._2 should not be empty
        }
      }
      "hide another user's folders and filings, refuse cross-user insert/update, and refuse no-context access" in {
        val fa = UUID.randomUUID().toString; val fb = UUID.randomUUID().toString
        await(superDb.run(sqlu"DELETE FROM dashboard_folder_assignments")) // the two loop passes share fixtures
        await(ctxf().withUserContext(userA)(sqlu"INSERT INTO dashboard_folders (id, owner_id, name) VALUES ($fa::uuid, $userA::uuid, ${s"A-$fa"})")) shouldBe 1
        await(ctxf().withUserContext(userB)(sqlu"INSERT INTO dashboard_folders (id, owner_id, name) VALUES ($fb::uuid, $userB::uuid, ${s"B-$fb"})")) shouldBe 1
        await(ctxf().withUserContext(userA)(sqlu"INSERT INTO dashboard_folder_assignments (owner_id, dashboard_id, folder_id) VALUES ($userA::uuid, $dashA, $fa::uuid)")) shouldBe 1

        // SELECT: B sees only B's folder; A's filing is invisible to B.
        val seenB = await(ctxf().withUserContext(userB)(sql"SELECT id::text FROM dashboard_folders".as[String]))
        seenB should contain(fb); seenB should not contain fa
        await(ctxf().withUserContext(userB)(sql"SELECT count(*) FROM dashboard_folder_assignments".as[Int].head)) shouldBe 0

        // INSERT: B may not create a folder or a filing owned by A.
        (the[Exception] thrownBy await(ctxf().withUserContext(userB)(
          sqlu"INSERT INTO dashboard_folders (id, owner_id, name) VALUES (${UUID.randomUUID().toString}::uuid, $userA::uuid, 'x')"))).getMessage should include("row-level security")
        (the[Exception] thrownBy await(ctxf().withUserContext(userB)(
          sqlu"INSERT INTO dashboard_folder_assignments (owner_id, dashboard_id, folder_id) VALUES ($userA::uuid, $dashB, $fa::uuid)"))).getMessage should include("row-level security")

        // UPDATE/DELETE: B's statements find no row of A's.
        await(ctxf().withUserContext(userB)(sqlu"UPDATE dashboard_folders SET name = 'hijack' WHERE id = $fa::uuid")) shouldBe 0
        await(ctxf().withUserContext(userB)(sqlu"DELETE FROM dashboard_folders WHERE id = $fa::uuid")) shouldBe 0
        // UPDATE moving a row to another owner is refused by the WITH CHECK.
        (the[Exception] thrownBy await(ctxf().withUserContext(userA)(
          sqlu"UPDATE dashboard_folders SET owner_id = $userB::uuid WHERE id = $fa::uuid"))).getMessage should include("row-level security")

        // No user context at all: the policy cannot evaluate, so nothing is readable or writable.
        the[Exception] thrownBy await(dbf().run(sql"SELECT count(*) FROM dashboard_folders".as[Int].head))

        await(superDb.run(sql"SELECT name FROM dashboard_folders WHERE id = $fa::uuid".as[String].head)) shouldBe s"A-$fa"
      }
      "make filing into another user's folder impossible at the schema level (composite FK)" in {
        val fa = UUID.randomUUID().toString
        await(superDb.run(sqlu"INSERT INTO dashboard_folders (id, owner_id, name) VALUES ($fa::uuid, $userA::uuid, ${s"FK-$fa"})"))
        val ex = the[Exception] thrownBy await(superDb.run(
          sqlu"INSERT INTO dashboard_folder_assignments (owner_id, dashboard_id, folder_id) VALUES ($userB::uuid, $dashB, $fa::uuid)"))
        ex.getMessage should include("foreign key")
      }
    }
  }
}
