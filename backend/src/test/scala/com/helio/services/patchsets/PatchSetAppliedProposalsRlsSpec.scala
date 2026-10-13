package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{EditOutcome, PatchSetApplyResponse}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.services.ServiceError
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

/** V131 `patch_set_applied_proposals` RLS under NOSUPERUSER NOBYPASSRLS roles (HEL-1522). The superuser test DB used
 *  by every route spec bypasses RLS (MISTAKES.md), so this is the only proof of the policy. Run for a non-owner role and
 *  for the TABLE OWNER, which is the only way FORCE ROW LEVEL SECURITY is exercised (prod's migration user owns it). */
class PatchSetAppliedProposalsRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {
  private implicit val ec: ExecutionContext = ExecutionContext.global
  private var pg: EmbeddedPostgres = _
  private var superDb, privDb, appDb, ownerRoleDb: JdbcBackend.Database = _
  private var ctx, ownerCtx: DbContext = _
  private var userA, userB: String = _
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
      s.execute("ALTER TABLE patch_set_applied_proposals OWNER TO rls_owner")
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
    await(superDb.run(DBIO.seq(
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($userA::uuid, ${s"$userA@example.test"}, now())",
      sqlu"INSERT INTO users (id, email, created_at) VALUES ($userB::uuid, ${s"$userB@example.test"}, now())")))
  }
  override def afterAll(): Unit = { appDb.close(); ownerRoleDb.close(); privDb.close(); superDb.close(); pg.close() }

  private def roleFlags(db: JdbcBackend.Database) =
    await(db.run(sql"SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user".as[(String, Boolean, Boolean)].head))

  for ((label, dbf, ctxf) <- Seq(("rls_app (non-owner)", () => appDb, () => ctx), ("rls_owner (TABLE OWNER, FORCE matters)", () => ownerRoleDb, () => ownerCtx))) {
    s"V131 under $label" should {
      "run as NOSUPERUSER NOBYPASSRLS" in {
        val (_, su, by) = roleFlags(dbf()); su shouldBe false; by shouldBe false
      }
      "see relrowsecurity, relforcerowsecurity and the owner policy" in {
        val flags = await(dbf().run(sql"SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'patch_set_applied_proposals'".as[(Boolean, Boolean, String)].head))
        val pol = await(dbf().run(sql"SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'patch_set_applied_proposals'".as[(String, String, String, Option[String])]))
        flags._1 shouldBe true; flags._2 shouldBe true
        pol.map(_._1) shouldBe Vector("patch_set_applied_proposals_owner")
      }
      "allow owner INSERT/SELECT, hide others' rows, refuse cross-owner insert, refuse no-context" in {
        val pa = UUID.randomUUID().toString; val pb = UUID.randomUUID().toString
        await(ctxf().withUserContext(userA)(sqlu"INSERT INTO patch_set_applied_proposals (owner_id, proposal_id) VALUES ($userA::uuid, $pa)")) shouldBe 1
        await(ctxf().withUserContext(userB)(sqlu"INSERT INTO patch_set_applied_proposals (owner_id, proposal_id) VALUES ($userB::uuid, $pb)")) shouldBe 1
        val seenA = await(ctxf().withUserContext(userA)(sql"SELECT proposal_id FROM patch_set_applied_proposals".as[String]))
        seenA should contain(pa); seenA should not contain pb
        val upd = await(ctxf().withUserContext(userA)(sqlu"UPDATE patch_set_applied_proposals SET application_id = 'x' WHERE proposal_id = $pb"))
        val del = await(ctxf().withUserContext(userA)(sqlu"DELETE FROM patch_set_applied_proposals WHERE proposal_id = $pb"))
        upd shouldBe 0; del shouldBe 0
        val ex = the[Exception] thrownBy await(ctxf().withUserContext(userA)(sqlu"INSERT INTO patch_set_applied_proposals (owner_id, proposal_id) VALUES ($userB::uuid, ${UUID.randomUUID().toString})"))
        val ex2 = the[Exception] thrownBy await(dbf().run(sql"SELECT count(*) FROM patch_set_applied_proposals".as[Int].head))
        await(superDb.run(sql"SELECT count(*) FROM patch_set_applied_proposals WHERE proposal_id = $pb".as[Int].head)) shouldBe 1
      }
      "run the real claim path (repository + PatchSetApplyOnce) under withUserContext" in {
        val repo = new PatchSetApplicationRepository(ctxf())
        val ua = AuthenticatedUser(UserId(userA)); val ub = AuthenticatedUser(UserId(userB))
        val pid = UUID.randomUUID().toString
        await(repo.claimProposal(ua, pid)) shouldBe true
        await(repo.claimProposal(ua, pid)) shouldBe false
        await(repo.claimProposal(ub, pid)) shouldBe true // per-owner key
        await(repo.attachApplication(ua, pid, "app-1"))
        await(superDb.run(sql"SELECT application_id FROM patch_set_applied_proposals WHERE owner_id = $userA::uuid AND proposal_id = $pid".as[Option[String]].head)) shouldBe Some("app-1")
        await(repo.releaseProposal(ub, pid))
        await(superDb.run(sql"SELECT count(*) FROM patch_set_applied_proposals WHERE proposal_id = $pid".as[Int].head)) shouldBe 1
        def ok(appId: Option[String], st: String): Either[ServiceError, PatchSetApplyResponse] = Right(PatchSetApplyResponse(Vector(EditOutcome(0, st, None, None, None)), None, appId))
        val p2 = UUID.randomUUID().toString
        await(PatchSetApplyOnce.run(repo, Some(p2), ua)(Future.successful(ok(Some("app-2"), "applied")))).isRight shouldBe true
        val second = await(PatchSetApplyOnce.run(repo, Some(p2), ua)(Future.successful(ok(Some("app-3"), "applied"))))
        second.left.toOption.get shouldBe a[ServiceError.PatchSetAlreadyApplied]
        val p3 = UUID.randomUUID().toString
        await(PatchSetApplyOnce.run(repo, Some(p3), ua)(Future.successful(ok(None, "rolledBack"))))
        await(superDb.run(sql"SELECT count(*) FROM patch_set_applied_proposals WHERE proposal_id = $p3".as[Int].head)) shouldBe 0
        val p4 = UUID.randomUUID().toString
        val conc = await(Future.sequence((1 to 4).map(_ => PatchSetApplyOnce.run(repo, Some(p4), ua)(Future.successful(ok(Some("app-4"), "applied"))))))
        conc.count(_.isRight) shouldBe 1
      }
    }
  }
}
