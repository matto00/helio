package com.helio.infrastructure.persistence.dashboards

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.api.protocols.dashboards.{DashboardLayoutItemPayload, DashboardLayoutPatchPayload, DashboardProtocol}
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1233 design D3: the three pieces of the owner-only layout repair that RLS actually gates, each
 *  proven on a NON-BYPASSRLS app pool (`helio_app_test`, same harness as `RlsOwnerTablesSpec`) with a
 *  named red — the same call as a stranger — so a green here cannot be a superuser-bypass artefact.
 *  dev/CI Postgres runs as a superuser, so without this harness none of it would be exercised under RLS. */
class DashboardLayoutRepairRlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres           = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database    = _
  private var ctx: DbContext                 = _
  private var repo: DashboardRepository      = _

  private val owner    = UserId(UUID.randomUUID().toString)
  private val stranger = UserId(UUID.randomUUID().toString)

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  override def beforeAll(): Unit = {
    pg = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs = pg.getPostgresDatabase
    Flyway.configure().dataSource(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val conn = superDs.getConnection
    try {
      val st = conn.createStatement()
      st.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      st.execute("GRANT helio_app_test TO postgres")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      st.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      st.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      st.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      st.close()
    } finally conn.close()

    val privCfg = new HikariConfig(); privCfg.setDataSource(superDs); privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))
    val appCfg = new HikariConfig(); appCfg.setDataSource(superDs); appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))
    ctx  = new DbContext(appDb, privilegedDb)
    repo = new DashboardRepository(ctx)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${owner.value + "@t.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${stranger.value}::uuid, ${stranger.value + "@t.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); pg.close(); super.afterAll() }

  private val badXs =
    """{"lg":[],"md":[],"sm":[],"xs":[{"panelId":"p1","x":0,"y":0,"w":1,"h":2},{"panelId":"p2","x":0,"y":0,"w":1,"h":2}]}"""
  private val fixedXs =
    """{"lg":[],"md":[],"sm":[],"xs":[{"panelId":"p1","x":0,"y":0,"w":1,"h":2},{"panelId":"p2","x":1,"y":0,"w":1,"h":2}]}"""

  private def seedDashboard(layoutJson: String, panelCount: Int): DashboardId = {
    val id = UUID.randomUUID().toString
    val panels = (1 to panelCount).map(i => DBIO.seq(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES (${s"panel-$i-$id"}, $id, 'P', ${owner.value}, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}', 'text', ${owner.value}::uuid)"""
    ))
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'rls-repair', ${owner.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}', $layoutJson, ${owner.value}::uuid)""",
      DBIO.sequence(panels)
    )))
    DashboardId(id)
  }

  private def layoutOf(id: DashboardId): DashboardLayout = await(repo.findByIdInternal(id)).get.layout
  private def layoutFromJson(json: String): DashboardLayout = {
    import spray.json._
    val proto = new DashboardProtocol {}
    import proto._
    json.parseJson.convertTo[DashboardLayout]
  }

  "owner-only layout repair on an RLS-enforced pool" should {

    "(a) let the owner read the dashboard through the sharing-aware findById, and hide it from a stranger" in {
      val id = seedDashboard(badXs, 2)
      await(repo.findById(id, Some(AuthenticatedUser(owner)))) should not be empty
      await(repo.findById(id, Some(AuthenticatedUser(stranger)))) shouldBe empty // named red: same call, other user
    }

    "(b) panelIdsInternal returns every panel id — the system context is load-bearing" in {
      val id = seedDashboard(badXs, 3)
      await(repo.panelIdsInternal(id)) should have size 3
      val asStranger = await(ctx.withUserContext(stranger.value)(
        TableQuery[PanelRepository.PanelTable].filter(_.dashboardId === id.value).map(_.id).result
      ))
      asStranger shouldBe empty // named red: the same query under a user context would see nothing
    }

    "(c) updateLayoutIfUnchanged writes as the owner, but not as a stranger and not over a changed layout" in {
      val id       = seedDashboard(badXs, 2)
      val expected = layoutOf(id)
      val fixed    = layoutFromJson(fixedXs)
      await(repo.updateLayoutIfUnchanged(id, stranger, expected, fixed)) shouldBe false // named red: RLS rejects it
      layoutOf(id) shouldBe expected
      await(repo.updateLayoutIfUnchanged(id, owner, fixed, fixed)) shouldBe false // stale expected: nothing matches
      layoutOf(id) shouldBe expected
      await(repo.updateLayoutIfUnchanged(id, owner, expected, fixed)) shouldBe true
      layoutOf(id) shouldBe fixed
    }

    "write only the layout: a rename and lastUpdated survive" in {
      val id       = seedDashboard(badXs, 2)
      val expected = layoutOf(id)
      val renamed  = await(repo.updateName(id, "renamed-meanwhile", Instant.parse("2031-01-01T00:00:00Z"))).get
      await(repo.updateLayoutIfUnchanged(id, owner, expected, layoutFromJson(fixedXs))) shouldBe true
      val after = await(repo.findByIdInternal(id)).get
      after.name shouldBe "renamed-meanwhile"
      after.meta.lastUpdated shouldBe renamed.meta.lastUpdated
    }

    "map a layout that changes between read and write to a 409 and keep the concurrent layout" in {
      val id = seedDashboard(badXs, 2)
      val concurrent = """{"lg":[],"md":[],"sm":[],"xs":[{"panelId":"p1","x":0,"y":5,"w":1,"h":2}]}"""
      val racing = new DashboardRepository(ctx) {
        override def updateLayoutIfUnchanged(i: DashboardId, o: UserId, e: DashboardLayout, n: DashboardLayout): Future[Boolean] = {
          await(ctx.withSystemContext(sqlu"""UPDATE dashboards SET layout = $concurrent WHERE id = ${i.value}"""))
          super.updateLayoutIfUnchanged(i, o, e, n)
        }
      }
      val service = new DashboardService(racing, null.asInstanceOf[AccessChecker], outputRepo = new OutputRepository(ctx))
      def item(p: String, x: Int) = DashboardLayoutItemPayload(p, x, 0, 1, 2)
      val ids = await(repo.panelIdsInternal(id)).toVector.map(_.value)
      val body = DashboardLayoutPatchPayload(xs = Some(ids.zipWithIndex.map { case (p, i) => item(p, i) }))
      val result = await(service.repairLayout(id, body, AuthenticatedUser(owner)))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get shouldBe a[ServiceError.Conflict]
      layoutOf(id) shouldBe layoutFromJson(concurrent)
    }
  }
}
