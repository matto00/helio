package com.helio.api.routes.proposals

import com.helio.api.ApiRoutes
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1496: `POST /api/proposals/apply` through the REAL `ApiRoutes` wiring. A pipeline half with a bare-url REST root
 *  applies, then the dashboard phase fails (a `$pipelineOutput` panel while the pipeline made no Output, the 422 from
 *  `applyDashboardPhase`), so `CombinedProposalService` calls the public `PipelineProposalService.rollback`. That
 *  rollback must leave no "Auto:" Connector behind. Only the real wiring can show the `ConnectorRepository` reaches
 *  the `DataSourceService` the rollback deletes through. Counts are by the exact owner id. */
class CombinedApplyProposalRollbackConnectorSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var routes: Route                      = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))
  private val token   = "token-owner-1496"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (t == token) Some(owner) else None)
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                        = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                            = Future.successful(())
    def exists(path: String): Future[Boolean]                                                         = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)

    routes = Route.seal(new ApiRoutes(
      new DashboardRepository(ctx)(routeEc), new PanelRepository(ctx)(routeEc), dataSourceRepo, new ResourcePermissionRepository(ctx)(routeEc),
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(routeEc), stubSessionRepo, new UserPreferenceRepository(db)(routeEc), pipelineRepo, new PipelineStepRepository(ctx)(routeEc),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      pipelineRunRepo = new PipelineRunRepository(ctx)(routeEc),
      dbContext = ctx
    ).routes)

    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"hel1496-$ownerId@example.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def count(table: String): Int = table match {
    case "data_sources"          => await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $ownerId::uuid".as[Int].head))
    case "connectors"            => await(db.run(sql"SELECT count(*) FROM connectors WHERE owner_id = $ownerId::uuid".as[Int].head))
    case "connector_credentials" => await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE user_id = $ownerId::uuid".as[Int].head))
    case "pipelines"             => await(db.run(sql"SELECT count(*) FROM pipelines WHERE owner_id = $ownerId::uuid".as[Int].head))
    case "dashboards"            => await(db.run(sql"SELECT count(*) FROM dashboards WHERE owner_id = $ownerId::uuid".as[Int].head))
  }

  "POST /api/proposals/apply (HEL-1496, real ApiRoutes wiring)" should {
    "leave no Auto Connector, source or pipeline when the dashboard phase fails after a bare-url REST root applied" in {
      val before = Seq("data_sources", "connectors", "connector_credentials", "pipelines", "dashboards").map(t => t -> count(t))
      val body =
        s"""{
           |  "pipeline": {
           |    "pipelineName": "hel1496 rollback",
           |    "roots": [{"type":"rest_api","name":"rest-1496","config":{"url":"http://example.invalid/data","method":"GET"}}],
           |    "steps": []
           |  },
           |  "dashboard": {
           |    "dashboardName": "hel1496 dashboard",
           |    "panels": [{"title":"Total","type":"output","outputId":"$$pipelineOutput"}]
           |  }
           |}""".stripMargin

      Post("/api/proposals/apply", HttpEntity(ContentTypes.`application/json`, body))
        .addHeader(Cookie(SessionCookies.Name -> token))
        .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)) ~> routes ~> check {
        // 422 comes from the sentinel resolution AFTER the pipeline applied; a pre-apply rejection would be a 400.
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
      }

      Seq("data_sources", "connectors", "connector_credentials", "pipelines", "dashboards").map(t => t -> count(t)) shouldBe before
    }
  }
}
