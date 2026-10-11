package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateSourceRequest, RestApiConfigPayload, SqlCreateSourceRequest, SqlSourceConfigPayload}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.api.JsonProtocols
import com.helio.api.routes.sources.SourceRoutes
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.net.InetAddress
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1475 path 3: `SourceService.createSql`/`createRest` insert the source and then keep working (schema
 *  inference and the schema write). A failed Future after the insert used to leave the row (and a bare-url
 *  call's implicit Connector) behind with its id never reaching the caller. Counts are by the exact owner id.
 *
 *  The "fetch error keeps the source" case is a GUARD, not red-first: it pins that a `Left` from schema
 *  inference stays a success, so the cleanup cannot be widened into deleting it. */
class SourceCreatePostInsertCleanupSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private final class FaultyDataSourceRepository(ctx: DbContext) extends DataSourceRepository(ctx) {
    @volatile var failUpsertSchema = false
    @volatile var failInsert       = false
    override def upsertInferredSchema(id: DataSourceId, schema: Vector[SchemaField], updatedAt: Instant, user: AuthenticatedUser): Future[Option[DataSource]] =
      if (failUpsertSchema) Future.failed(new IllegalStateException("boom: upsertInferredSchema")) else super.upsertInferredSchema(id, schema, updatedAt, user)
    override def insert(source: DataSource, user: AuthenticatedUser): Future[DataSource] =
      if (failInsert) Future.failed(new IllegalStateException("boom: insert")) else super.insert(source, user)
  }

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var dataSourceRepo: FaultyDataSourceRepository = _
  private var connectorRepo: ConnectorRepository     = _

  private val ownerId = UUID.randomUUID().toString
  private val user    = AuthenticatedUser(UserId(ownerId))

  private val admitLocalhostSql: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo = new FaultyDataSourceRepository(ctx)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"o-$ownerId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def count(table: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $ownerId::uuid".as[Int])).head
  }

  private def service(rest: Either[String, JsValue] = Right(JsArray(JsObject("amount" -> JsNumber(1))))): SourceService =
    new SourceService(
      dataSourceRepo, new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(rest))),
      connectorRepo = connectorRepo, sqlIsBlocked = admitLocalhostSql
    )

  private def sqlRequest(query: String) = SqlCreateSourceRequest(
    s"sql-${UUID.randomUUID()}", DataSourceKind.Sql,
    SqlSourceConfigPayload("postgresql", "localhost", embeddedPostgres.getPort, "postgres", "postgres", "postgres", query)
  )

  private def bareUrlRequest() = CreateSourceRequest(
    s"rest-${UUID.randomUUID()}", DataSourceKind.RestApi, RestApiConfigPayload(url = Some("http://example.invalid/data"), method = Some("GET")), None
  )

  private def withFault[T](set: Boolean => Unit)(body: => T): T = {
    set(true)
    try body finally set(false)
  }

  "SourceService.createSql when the schema write fails after the insert (HEL-1475)" should {
    "leave no data source and surface the original failure" in {
      val before = count("data_sources")
      val thrown = withFault(dataSourceRepo.failUpsertSchema = _) {
        intercept[IllegalStateException](await(service().createSql(sqlRequest("SELECT 1 AS one"), user)))
      }
      thrown.getMessage shouldBe "boom: upsertInferredSchema"
      count("data_sources") shouldBe before
    }
  }

  "SourceService.createRest bare-url when the schema write fails after the insert (HEL-1475)" should {
    "leave no data source and no implicit Connector, and surface the original failure" in {
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      val thrown = withFault(dataSourceRepo.failUpsertSchema = _) {
        intercept[IllegalStateException](await(service().createRest(bareUrlRequest(), user)))
      }
      thrown.getMessage shouldBe "boom: upsertInferredSchema"
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }
  }

  "SourceService.createRest bare-url when the source insert itself fails (HEL-1475)" should {
    "leave no implicit Connector and surface the original failure" in {
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      val thrown = withFault(dataSourceRepo.failInsert = _) {
        intercept[IllegalStateException](await(service().createRest(bareUrlRequest(), user)))
      }
      thrown.getMessage shouldBe "boom: insert"
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }
  }

  "a schema-fetch error (GUARD, HEL-1475)" should {
    "still be a success that keeps the source, for REST and SQL" in {
      val before = count("data_sources")
      val rest = await(service(Left("upstream is down")).createRest(bareUrlRequest(), user))
      rest.fold(e => fail(s"expected Right, got $e"), r => r.fetchError shouldBe Some("upstream is down"))
      val sqlResult = await(service().createSql(sqlRequest("SELECT * FROM definitely_not_a_real_table"), user))
      sqlResult.fold(e => fail(s"expected Right, got $e"), r => r.fetchError should not be empty)
      count("data_sources") shouldBe before + 2
    }
  }

  "POST /sources when the schema write fails after the insert (HEL-1475)" should {
    // Bare-url REST cannot reach createRest through this route (SourceRoutes answers 400, HEL-828), so the implicit-Connector
    // clause is proven at service level above; the REST case here names an explicit connectorId.
    "leave no data source for a sql body and for a REST body naming a connectorId" in {
      val route = Route.seal(new SourceRoutes(service(), user).routes)
      val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource("Explicit", "http://example.invalid", RestApiAuth.NoAuth)
      val explicit = await(connectorRepo.create(user.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      val restBody = CreateSourceRequest(s"rest-${UUID.randomUUID()}", DataSourceKind.RestApi, RestApiConfigPayload(connectorId = Some(explicit.id.value), endpoint = Some("/data"), method = Some("GET")), None)
      val before = count("data_sources")
      withFault(dataSourceRepo.failUpsertSchema = _) {
        Post("/sources", sqlRequest("SELECT 1 AS one")) ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
        Post("/sources", restBody) ~> route ~> check { status shouldBe StatusCodes.InternalServerError }
      }
      count("data_sources") shouldBe before
    }
  }
}
