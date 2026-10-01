package com.helio.api.routes.firstrun

import com.helio.api._
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.TempDirectorySupport
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.SystemMaterializer
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1209: `POST /api/first-run/dashboard` on the FULL `ApiRoutes` under real RLS, a real CSV on a
 *  real filesystem, and a counting Claude transport wired through every Claude-bearing service
 *  (via ApiRoutes' test seams). A free-tier build must reach a rendered dashboard with zero
 *  transport calls; a positive control proves the same transport IS reachable from this wiring. */
class FirstRunRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _
  private var routes: Route                      = _
  private var dataSourceService: DataSourceService = _

  private val userId  = "00000000-0000-0000-0000-0000000000e1"
  private val otherId = "00000000-0000-0000-0000-0000000000e2"
  private val session = "valid-session"
  private val user    = AuthenticatedUser(UserId(userId))
  private val other   = AuthenticatedUser(UserId(otherId))

  private val claudeCalls = new AtomicInteger(0)

  private class CountingTransport extends ClaudeTransport {
    private def text(t: String) =
      ClaudeApiResponse("msg_test", Seq(ClaudeApiContentBlock("text", Some(t))), Some("end_turn"), ClaudeApiUsage(1, 1))
    override def send(request: ClaudeApiRequest) = { claudeCalls.incrementAndGet(); Future.successful(text("""{"dashboardName":"S","panels":[]}""")) }
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
      claudeCalls.incrementAndGet(); Source(List(ClaudeStreamEvent.MessageStop))
    }
    override def sendTool(request: ClaudeApiToolRequest) = { claudeCalls.incrementAndGet(); Future.successful(text("hi")) }
  }

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (token == session) Some(user) else None)
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs = embeddedPostgres.getPostgresDatabase
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    val conn = superDs.getConnection
    try {
      val stmt = conn.createStatement()
      stmt.execute("""DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
        CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN; END IF; END $$""")
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally conn.close()
    def pool(role: String) = {
      val cfg = new HikariConfig(); cfg.setDataSource(superDs); cfg.setMaximumPoolSize(5)
      cfg.setConnectionInitSql(s"SET ROLE $role")
      JdbcBackend.Database.forDataSource(new HikariDataSource(cfg), Some(5))
    }
    privilegedDb = pool("helio_privileged"); appDb = pool("helio_app_test")
    ctx = new DbContext(appDb, privilegedDb)(typedSystem.executionContext)

    val ec               = typedSystem.executionContext
    val dashboardRepo    = new DashboardRepository(ctx)(ec)
    val panelRepo        = new PanelRepository(ctx)(ec)
    val dataSourceRepo   = new DataSourceRepository(ctx)(ec)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(ec)
    val fs               = new LocalFileSystem(newTempDir("helio-first-run-routes-spec"))
    dataSourceService    = new DataSourceService(dataSourceRepo, fs)(ec, SystemMaterializer(typedSystem).materializer, typedSystem)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, new ResourcePermissionRepository(ctx)(ec), fs,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(appDb)(ec), stubSessionRepo, new UserPreferenceRepository(appDb)(ec), pipelineRepo,
      new PipelineStepRepository(ctx)(ec), new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(ec),
      pipelineRunRepo = new PipelineRunRepository(ctx)(ec), dbContext = ctx,
      claudeConfigProvider   = () => Right(ClaudeConfig("sk-ant-stub-never-used", "claude-test", 1.0, 4096, 100000)),
      claudeTransportFactory = Some(_ => new CountingTransport)
    ).routes

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, 'e1@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherId::uuid, 'e2@helio.test', now())"""
    )))
  }

  override def afterAll(): Unit = { appDb.close(); privilegedDb.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def sql1[T](a: DBIO[T]): T     = await(ctx.withSystemContext(a))
  private def authed(req: HttpRequest) =
    req.addHeader(Cookie(SessionCookies.Name -> session))
      .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
  private def build(sourceId: String) =
    authed(Post("/api/first-run/dashboard", HttpEntity(ContentTypes.`application/json`, s"""{"sourceId":"$sourceId"}""")))

  private def csvSource(owner: AuthenticatedUser, name: String, csv: String): String =
    await(dataSourceService.createCsv(name, csv.getBytes("UTF-8"), Vector.empty, owner)).fold(e => fail(e.toString), _.id.value)

  private val datedCsv = "day,region,amount\n2026-01-01,North,10\n2026-01-02,South,20\n2026-01-03,North,30\n"

  private def layoutOf(dashboardId: String): Map[String, Vector[(Int, Int, Int, Int)]] = {
    val raw = sql1(sql"SELECT layout::text FROM dashboards WHERE id = $dashboardId".as[String].head)
    raw.parseJson.asJsObject.fields.map { case (bp, items) =>
      bp -> items.convertTo[Vector[JsObject]].map { o =>
        def n(k: String) = o.fields(k).convertTo[Int]
        (n("x"), n("y"), n("w"), n("h"))
      }
    }
  }

  private def noOverlap(items: Vector[(Int, Int, Int, Int)]): Boolean =
    (for (i <- items.indices; j <- (i + 1) until items.size) yield (items(i), items(j))).forall {
      case ((x1, y1, w1, h1), (x2, y2, w2, h2)) => x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1
    }

  "POST /api/first-run/dashboard" should {

    "build a dashboard with rendered rows for a free-tier user and make ZERO Claude calls" in {
      val srcId  = csvSource(user, "Sales", datedCsv)
      val before = claudeCalls.get
      build(srcId) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val r = responseAs[FirstRunDashboardResponse]
        r.panelCount shouldBe 3
        r.sourceId shouldBe srcId
        sql1(sql"SELECT COUNT(*) FROM panels WHERE dashboard_id = ${r.dashboardId}".as[Int].head) shouldBe 3
        val tableOutput = sql1(sql"SELECT id FROM outputs WHERE pipeline_id = ${r.pipelineId} AND kind = 'table'".as[String].head)
        authed(Get(s"/api/outputs/$tableOutput/rows")) ~> routes ~> check {
          status shouldBe StatusCodes.OK
          val body  = responseAs[String].parseJson.asJsObject
          val items = body.fields("items").convertTo[Vector[JsObject]]
          body.fields("materialized") shouldBe JsBoolean(true)
          items should have size 3
          items.map(_.fields("amount")).foreach(_ shouldBe a[JsNumber])
        }
      }
      claudeCalls.get shouldBe before
    }

    "materialize the chart outputs with real aggregated rows: 3 daily buckets and a 2-category top-n summing amount" in {
      val srcId = csvSource(user, "Sales2", datedCsv)
      build(srcId) ~> routes ~> check {
        val r = responseAs[FirstRunDashboardResponse]
        def itemsOf(name: String): Vector[JsObject] = {
          val id = sql1(sql"SELECT id FROM outputs WHERE pipeline_id = ${r.pipelineId} AND name = ${s"Sales2 $name"}".as[String].head)
          authed(Get(s"/api/outputs/$id/rows")) ~> routes ~> check {
            responseAs[String].parseJson.asJsObject.fields("items").convertTo[Vector[JsObject]]
          }
        }
        itemsOf("over time").map(_.fields("day")) shouldBe Vector("2026-01-01", "2026-01-02", "2026-01-03").map(JsString(_))
        itemsOf("top region").map(o => o.fields("region") -> o.fields("amount_sum")) shouldBe
          Vector(JsString("North") -> JsNumber(40), JsString("South") -> JsNumber(20))
      }
    }

    "reach the counting transport from the same wiring once the user is beta (positive control for the zero-call assertion)" in {
      sql1(sqlu"UPDATE users SET tier = 'beta' WHERE id = $userId::uuid")
      val before = claudeCalls.get
      authed(Post("/api/authoring/dashboard", HttpEntity(ContentTypes.`application/json`, """{"goal":"Show sales"}"""))) ~> routes ~> check {
        status should not be StatusCodes.Forbidden
      }
      claudeCalls.get should be > before
      sql1(sqlu"UPDATE users SET tier = 'free' WHERE id = $userId::uuid")
    }

    "persist a full-width, non-overlapping layout at every breakpoint for 1, 2 and 3 panels" in {
      val oneCol  = csvSource(user, "Names", "name,city\na,x\nb,y\nc,x\n")
      val twoCols = csvSource(user, "Trend", "day,amount\n2026-01-01,1\n2026-01-02,2\n2026-01-03,3\n")
      val widths  = Map("lg" -> 12, "md" -> 10, "sm" -> 6, "xs" -> 2)
      for ((src, expected) <- Seq(oneCol -> 1, twoCols -> 2, csvSource(user, "Full", datedCsv) -> 3)) {
        build(src) ~> routes ~> check {
          status shouldBe StatusCodes.Created
          val r = responseAs[FirstRunDashboardResponse]
          r.panelCount shouldBe expected
          val layout = layoutOf(r.dashboardId)
          widths.foreach { case (bp, cols) =>
            layout(bp) should have size expected.toLong
            layout(bp).foreach { case (x, _, w, _) => (x, w) shouldBe ((0, cols)) }
            noOverlap(layout(bp)) shouldBe true
          }
        }
      }
    }

    "produce a single table panel and no cast step for a CSV with no numeric column" in {
      val src = csvSource(user, "Names", "name,city\na,x\nb,y\nc,x\n")
      build(src) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val r = responseAs[FirstRunDashboardResponse]
        r.panelCount shouldBe 1
        sql1(sql"SELECT COUNT(*) FROM pipeline_steps WHERE pipeline_id = ${r.pipelineId} AND op = 'cast'".as[Int].head) shouldBe 0
      }
    }

    "404 for an unknown source and for another user's source, creating nothing" in {
      val theirs = csvSource(other, "Theirs", datedCsv)
      val pipelinesBefore = sql1(sql"SELECT COUNT(*) FROM pipelines".as[Int].head)
      build(UUID.randomUUID().toString) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      build(theirs) ~> routes ~> check { status shouldBe StatusCodes.NotFound }
      sql1(sql"SELECT COUNT(*) FROM pipelines".as[Int].head) shouldBe pipelinesBefore
    }

    "400 for a header-only CSV and for a non-csv source" in {
      val headerOnly = csvSource(user, "Empty", "a,b\n")
      build(headerOnly) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
      val staticId = UUID.randomUUID().toString
      sql1(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                  VALUES ($staticId::uuid, 'st', 'dataset', '{}'::jsonb, $userId::uuid, now(), now())""")
      build(staticId) ~> routes ~> check { status shouldBe StatusCodes.BadRequest }
    }
  }
}
