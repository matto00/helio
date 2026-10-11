package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1475 path 2 through the PRODUCTION `ApiRoutes` wiring (real `ConnectorRepository`, real `PipelineService`
 *  cleanup collaborators): a rejected single-call create with a bare-url REST inline root must leave neither the
 *  source nor its implicit Connector behind. Guards against the cleanup being wired as a skippable optional
 *  dependency that tests construct but `ApiRoutes` does not. */
class InlineSourceLeakApiRoutesWiringSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var route: Route                       = _

  private val testUserId = "00000000-0000-0000-0000-000000001475"
  private val testToken  = "valid-test-token"
  private val testUser   = AuthenticatedUser(UserId(testUserId))

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ec  = typedSystem.executionContext
    val ctx = new DbContext(db, db)(ec)
    val dataSourceRepo = new DataSourceRepository(ctx)(ec)
    val fs: FileSystem = new FileSystem {
      def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
      def read(path: String): Future[Array[Byte]]                                                     = Future.successful(Array.empty)
      def delete(path: String): Future[Unit]                                                          = Future.successful(())
      def exists(path: String): Future[Boolean]                                                       = Future.successful(false)
      def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
    }
    val rest = new RestApiConnectorDriver(Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    val sessions = new UserSessionRepository {
      override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
        Future.successful(if (token == testToken) Some(testUser) else None)
    }
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(ec)
    val raw = new ApiRoutes(
      new DashboardRepository(ctx)(ec), new PanelRepository(ctx)(ec), dataSourceRepo, new ResourcePermissionRepository(ctx)(ec), fs, rest,
      new UserRepository(db)(ec), sessions, new UserPreferenceRepository(db)(ec), pipelineRepo, new PipelineStepRepository(ctx)(ec),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(ec),
      dbContext = ctx
    ).routes
    val csrf = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
    route = mapRequest((req: HttpRequest) => req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> testToken) :+ csrf))(raw)
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($testUserId::uuid, 'hel1475@test.local', now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def count(table: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $testUserId::uuid".as[Int])).head
  }

  "POST /api/pipelines through ApiRoutes (HEL-1475)" should {
    "leave no data source and no implicit Connector when a bare-url REST inline root's request is rejected after creation" in {
      val body =
        """{"name":"wired","roots":[{"type":"rest_api","name":"wired-rest","restConfig":{"url":"http://example.invalid/data","method":"GET"}}],
          |"outputs":[{"kind":"metric","name":"o","config":{"fieldMapping":{"value":"does_not_exist"}}}]}""".stripMargin
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      Post("/api/pipelines", HttpEntity(ContentTypes.`application/json`, body)) ~> route ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("does_not_exist")
      }
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }
  }
}
