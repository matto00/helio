package com.helio.api.routes.sources

import com.helio.api.ApiRoutes
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.ImplicitConnectorConfig
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
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

/** HEL-1497 task 3.7: `DELETE /api/data-sources/:id` through the REAL `ApiRoutes` wiring removes the source's
 *  unadopted Auto Connector. A service-level test cannot catch the construction-order hazard (design.md D3):
 *  `ApiRoutes` builds `dataSourceService` and `connectorRepo` as `private val`s, and one read before its
 *  initializer ran is `null`, which would silently disable the cleanup in production. */
class DataSourceDeleteAutoConnectorRoutesSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var ctx: DbContext                       = _
  private var routes: Route                        = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))
  private val token   = "token-owner"

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
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(routeEc)

    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))(routeEc))(routeEc)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(routeEc)

    routes = Route.seal(new ApiRoutes(
      new DashboardRepository(ctx)(routeEc), new PanelRepository(ctx)(routeEc), dataSourceRepo, new ResourcePermissionRepository(ctx)(routeEc),
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(routeEc), stubSessionRepo, new UserPreferenceRepository(db)(routeEc), pipelineRepo, new PipelineStepRepository(ctx)(routeEc),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      dbContext = ctx
    ).routes)

    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'owner-1497@helio.test', now())"""
    ))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  "DELETE /api/data-sources/:id (HEL-1497, real ApiRoutes wiring)" should {
    "remove the source's unadopted Auto Connector and its credential row" in {
      val (name, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource("Auto: route test", "http://example.invalid", RestApiAuth.NoAuth)
      val connector = await(connectorRepo.create(owner.id, name, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      val now       = Instant.now()
      val restCfg = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/data", method = "GET", queryParams = QueryParams(Vector.empty),
        headers = Map.empty, body = None, bodyContentType = None, rootSelector = None, parameters = Map.empty
      )
      val source = await(dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), "route source", owner.id, now, now, restCfg), owner))

      Delete(s"/api/data-sources/${source.id.value}")
        .addHeader(Cookie(SessionCookies.Name -> token))
        .addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)) ~> routes ~> check {
        status shouldBe StatusCodes.NoContent
      }

      await(dataSourceRepo.findByIdOwned(source.id, owner)) shouldBe None
      await(connectorRepo.findByIdOwned(connector.id, owner)) shouldBe None
      val credId = connector.credentialId.get.value
      await(ctx.withSystemContext(sql"SELECT count(*) FROM connector_credentials WHERE id = $credId::uuid".as[Int].head)) shouldBe 0
    }
  }
}
