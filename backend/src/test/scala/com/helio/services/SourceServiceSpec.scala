package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.protocols._
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DbContext}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** Service-level coverage for HEL-473: `SourceService`'s create/infer/refresh paths now dispatch
 *  through `Connector[Config].inferSchema` (the SPI trait method, HEL-449) and the shared
 *  `SchemaInferenceFacade.toDataFields` projection instead of hand-rolling `execute`/`fetch` +
 *  inline inference. These tests confirm the observable output — including the `fetchError`
 *  early-return path and field-override handling — is unchanged after that routing swap
 *  (design.md Decision 3). `previewSql`/`previewRest` are untouched by this ticket and are not
 *  covered here. */
class SourceServiceSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataSourceRepo: DataSourceRepository = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    dataTypeRepo   = new DataTypeRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"TRUNCATE TABLE data_types, data_sources RESTART IDENTITY CASCADE"))
  }

  /** A SQL config that queries the embedded Postgres instance itself — same pattern
   *  `SqlConnectorSpec.liveConfig` uses, so `SqlConnector.execute` runs a real query. */
  private def sqlConfig(query: String): SqlSourceConfigPayload =
    SqlSourceConfigPayload(
      dialect  = "postgresql",
      host     = "localhost",
      port     = embeddedPostgres.getPort,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  /** A `RestApiConnector` whose response is driven by an in-memory function rather than a real HTTP
   *  request. `RestApiConnector.inferSchema`/the trait `fetch(config, maxRows)` both delegate to the
   *  single-arg `fetch(config)`, which honors `fetchOverride` (see `RestApiConnector.scala`), so this
   *  is a faithful unit-level stand-in for both `SourceService`'s SPI-routed calls. */
  private def restConnector(response: Either[String, JsValue]): RestApiConnector =
    new RestApiConnector(fetchOverride = Some(_ => Future.successful(response)))

  private def service(connector: RestApiConnector): SourceService =
    new SourceService(dataSourceRepo, dataTypeRepo, connector)

  private val restConfigPayload =
    RestApiConfigPayload(url = "http://example.invalid/data", method = Some("GET"), auth = None, headers = None)

  // ── createSql ────────────────────────────────────────────────────────────

  "SourceService.createSql" should {

    "create the DataType with fields derived via the shared projection when the query succeeds" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("Numbers", DataSourceKind.Sql, sqlConfig("SELECT 1 AS one, 'x' AS label"))

      val result = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }

      result.fetchError shouldBe None
      val dt = result.dataType.getOrElse(fail("expected a DataType"))
      dt.fields.map(_.name) should contain theSameElementsAs Seq("one", "label")
      dt.fields.find(_.name == "one").get.dataType   shouldBe "integer"
      dt.fields.find(_.name == "label").get.dataType shouldBe "string"
    }

    "surface fetchError (not fail the request) and create no DataType when the query fails" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("Broken", DataSourceKind.Sql, sqlConfig("SELECT * FROM definitely_not_a_real_table"))

      val result = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }

      result.fetchError shouldBe defined
      result.dataType shouldBe None
    }
  }

  // ── createRest ───────────────────────────────────────────────────────────

  "SourceService.createRest" should {

    "create the DataType with override-aware fields when the fetch succeeds" in {
      cleanDb()
      val json: JsValue = JsArray(
        JsObject("id" -> JsNumber(1), "label" -> JsString("a")),
        JsObject("id" -> JsNumber(2), "label" -> JsString("b"))
      )
      val svc       = service(restConnector(Right(json)))
      val overrides = Vector(FieldOverridePayload(name = "label", displayName = "Label Override", dataType = "string"))
      val request   = CreateSourceRequest("Widgets", DataSourceKind.RestApi, restConfigPayload, Some(overrides))

      val result = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      result.fetchError shouldBe None
      val dt = result.dataType.getOrElse(fail("expected a DataType"))
      dt.fields.find(_.name == "id").get.dataType shouldBe "integer"
      val labelField = dt.fields.find(_.name == "label").get
      labelField.displayName shouldBe "Label Override"
      labelField.dataType    shouldBe "string"
    }

    "surface fetchError and create no DataType when the fetch fails" in {
      cleanDb()
      val svc     = service(restConnector(Left("Request failed")))
      val request = CreateSourceRequest("Broken", DataSourceKind.RestApi, restConfigPayload, None)

      val result = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      result.fetchError shouldBe Some("Request failed")
      result.dataType shouldBe None
    }
  }

  // ── inferSql / inferRest ─────────────────────────────────────────────────

  "SourceService.inferSql" should {

    "return the inferred schema for a successful query" in {
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlInferRequest(DataSourceKind.Sql, sqlConfig("SELECT 1 AS one, 'x' AS label"))

      val schema = await(svc.inferSql(request)).getOrElse(fail("expected Right"))
      schema.fields.map(_.name) should contain theSameElementsAs Seq("one", "label")
    }

    "return a BadGateway ServiceError when the query fails" in {
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlInferRequest(DataSourceKind.Sql, sqlConfig("SELECT * FROM definitely_not_a_real_table"))

      val result = await(svc.inferSql(request))
      result.isLeft shouldBe true
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.BadGateway]
    }
  }

  "SourceService.inferRest" should {

    "return the inferred schema for a successful fetch" in {
      val json: JsValue = JsObject("id" -> JsNumber(1), "active" -> JsBoolean(true))
      val svc            = service(restConnector(Right(json)))

      val schema = await(svc.inferRest(restConfigPayload)).getOrElse(fail("expected Right"))
      schema.fields.map(_.name) should contain theSameElementsAs Seq("id", "active")
    }

    "return a BadGateway ServiceError carrying the connector's error message when the fetch fails" in {
      val svc    = service(restConnector(Left("Request failed")))
      val result = await(svc.inferRest(restConfigPayload))
      result shouldBe Left(ServiceError.BadGateway("Request failed"))
    }
  }

  // ── refresh ──────────────────────────────────────────────────────────────

  "SourceService.refresh (SQL)" should {

    "re-create a DataType (version 1) via inferSchema when the linked DataType is missing" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("RefreshMe", DataSourceKind.Sql, sqlConfig("SELECT 1 AS one"))
      val created = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val existing = await(dataTypeRepo.findBySourceId(sourceId, owner))
      existing.foreach(dt => await(dataTypeRepo.delete(dt.id, user)))

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(dt) => dt
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.version shouldBe 1
      refreshed.fields.map(_.name) shouldBe Seq("one")
    }

    "bump the version when refreshing an existing SQL-sourced DataType" in {
      cleanDb()
      val svc     = service(restConnector(Right(JsArray())))
      val request = SqlCreateSourceRequest("RefreshMe2", DataSourceKind.Sql, sqlConfig("SELECT 1 AS one"))
      val created = await(svc.createSql(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createSql failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(dt) => dt
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.version shouldBe 2
    }
  }

  "SourceService.refresh (REST)" should {

    "re-create a DataType (version 1) via inferSchema when the linked DataType is missing" in {
      cleanDb()
      val json: JsValue = JsArray(JsObject("id" -> JsNumber(1)))
      val svc            = service(restConnector(Right(json)))
      val request        = CreateSourceRequest("RefreshRest", DataSourceKind.RestApi, restConfigPayload, None)
      val created = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val existing = await(dataTypeRepo.findBySourceId(sourceId, owner))
      existing.foreach(dt => await(dataTypeRepo.delete(dt.id, user)))

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(dt) => dt
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.version shouldBe 1
      refreshed.fields.map(_.name) shouldBe Seq("id")
    }

    "bump the version when refreshing an existing REST-sourced DataType" in {
      // Note: `refreshRest`'s `upsertDataType(..., bumpVersion = false, ...)` argument is inert
      // for this branch — `DataTypeRepository.update` unconditionally computes
      // `existing.version + 1` and ignores the `version` field on the `DataType` passed in. This
      // is pre-existing repository-layer behavior, unrelated to and unchanged by this ticket; the
      // test asserts the actual observed output rather than the `bumpVersion` flag's nominal intent.
      cleanDb()
      val json: JsValue = JsArray(JsObject("id" -> JsNumber(1)))
      val svc            = service(restConnector(Right(json)))
      val request        = CreateSourceRequest("RefreshRest2", DataSourceKind.RestApi, restConfigPayload, None)
      val created = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }
      val sourceId = DataSourceId(created.source.id)

      val refreshed = await(svc.refresh(sourceId, user)) match {
        case Right(dt) => dt
        case Left(e)   => fail(s"refresh failed: $e")
      }
      refreshed.version shouldBe 2
    }
  }
}
