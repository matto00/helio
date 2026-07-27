package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{DataTypeRowsResponse, ErrorResponse, JsonProtocols}
import com.helio.domain.{AuthenticatedUser, DataField, DataType, DataTypeId, UserId}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, DbContext}
import com.helio.services.{DataTypeService, PanelCapabilityService}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class DataTypeRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var dataSourceRepo: DataSourceRepository = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db, db)(routeEc)
    dataTypeRepo    = new DataTypeRepository(ctx)(routeEc)
    dataTypeRowRepo = new DataTypeRowRepository(ctx)(routeEc)
    dataSourceRepo  = new DataSourceRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def makeRoutes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val capabilityService = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
    new DataTypeRoutes(service, capabilityService, dummyUser)(typedSystem).routes
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private def seedDataType(): String = {
    import PostgresProfile.api._
    val dtId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, 'TestType', '[]', 1,
               '00000000-0000-0000-0000-000000000001', now(), now())"""
    ))
    dtId
  }

  /** HEL-372 4.6: a DataType with a declared `fields` schema (via the real repo,
   *  not raw SQL, so the JSON shape matches `DataFieldProtocol` exactly) — needed
   *  to exercise `?excludeContentFields=true`, which computes `excludeKeys` from
   *  the DataType's own fields. */
  private def seedDataTypeWithFields(fields: Vector[DataField]): String = {
    val now = Instant.now()
    val dt = DataType(
      id             = DataTypeId(UUID.randomUUID().toString),
      sourceId       = None,
      name           = "TestTypeWithFields",
      fields         = fields,
      computedFields = Vector.empty,
      version        = 1,
      createdAt      = now,
      updatedAt      = now,
      ownerId        = dummyUser.id
    )
    await(dataTypeRepo.insert(dt, dummyUser)).id.value
  }

  // ── Tests ────────────────────────────────────────────────────────────────────

  "GET /types/:id/rows" should {

    "return 404 when the DataType does not exist" in {
      Get("/types/nonexistent-dt-id/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.NotFound
        val resp = responseAs[ErrorResponse]
        resp.message should include("not found")
      }
    }

    "return empty rows array when no snapshot has been written" in {
      val dtId = seedDataType()
      Get(s"/types/$dtId/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rows     shouldBe empty
        resp.rowCount shouldBe 0
      }
    }

    "return stored rows with correct rowCount after a snapshot is written" in {
      val dtId = seedDataType()
      val rows = Seq(
        JsObject("name" -> JsString("alice"), "score" -> JsNumber(42)),
        JsObject("name" -> JsString("bob"),   "score" -> JsNumber(37))
      )
      await(dataTypeRowRepo.overwriteRows(dtId, rows))

      Get(s"/types/$dtId/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rowCount shouldBe 2
        resp.rows should have size 2
        resp.rows.head.fields("name") shouldBe JsString("alice")
        resp.rows(1).fields("name")   shouldBe JsString("bob")
      }
    }

    "reflect the latest snapshot after an overwrite" in {
      val dtId = seedDataType()

      // First snapshot
      await(dataTypeRowRepo.overwriteRows(dtId, Seq(
        JsObject("x" -> JsNumber(1)),
        JsObject("x" -> JsNumber(2))
      )))
      Get(s"/types/$dtId/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DataTypeRowsResponse].rowCount shouldBe 2
      }

      // Overwrite with a single row
      await(dataTypeRowRepo.overwriteRows(dtId, Seq(JsObject("x" -> JsNumber(99)))))
      Get(s"/types/$dtId/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rowCount             shouldBe 1
        resp.rows.head.fields("x") shouldBe JsNumber(99)
      }
    }

    // ── HEL-372 4.6: ?limit=/?excludeContentFields= query params ─────────

    "?limit=2 returns at most 2 rows, even when more are stored" in {
      val dtId = seedDataType()
      val rows = (0 until 5).map(i => JsObject("idx" -> JsNumber(i)))
      await(dataTypeRowRepo.overwriteRows(dtId, rows))

      Get(s"/types/$dtId/rows?limit=2") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rowCount shouldBe 2
        resp.rows should have size 2
      }
    }

    "?excludeContentFields=true strips string-body/binary-ref field keys from the response" in {
      val dtId = seedDataTypeWithFields(Vector(
        DataField("title", "Title", "string", nullable = false),
        DataField("body", "Body", "string-body", nullable = true)
      ))
      await(dataTypeRowRepo.overwriteRows(dtId, Seq(
        JsObject("title" -> JsString("doc"), "body" -> JsString("y" * 500))
      )))

      Get(s"/types/$dtId/rows?excludeContentFields=true") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rows should have size 1
        resp.rows.head.fields.keySet should contain("title")
        resp.rows.head.fields.keySet should not contain "body"
      }
    }

    "omitting both limit and excludeContentFields preserves the full, unbounded snapshot" in {
      val dtId = seedDataTypeWithFields(Vector(
        DataField("title", "Title", "string", nullable = false),
        DataField("body", "Body", "string-body", nullable = true)
      ))
      val rows = (0 until 3).map(i => JsObject("title" -> JsString(s"t$i"), "body" -> JsString(s"b$i")))
      await(dataTypeRowRepo.overwriteRows(dtId, rows))

      Get(s"/types/$dtId/rows") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[DataTypeRowsResponse]
        resp.rowCount shouldBe 3
        resp.rows should have size 3
        resp.rows.head.fields.keySet shouldBe Set("title", "body")
      }
    }

    "?limit=0 is rejected with 400" in {
      val dtId = seedDataType()

      Get(s"/types/$dtId/rows?limit=0") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.BadRequest
        val resp = responseAs[ErrorResponse]
        resp.message should include("limit")
      }
    }

    "a negative limit is also rejected with 400" in {
      val dtId = seedDataType()

      Get(s"/types/$dtId/rows?limit=-1") ~> makeRoutes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }
}
