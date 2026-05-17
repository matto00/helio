package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AccessCheckerImpl, DataTypeRowsResponse, ErrorResponse, JsonProtocols}
import com.helio.domain.{AuthenticatedUser, DataTypeId, UserId}
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, ResourcePermissionRepository}
import com.helio.api.{ResourceType, ResourceTypeRegistry}
import com.helio.services.DataTypeService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

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
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataTypeRepo    = new DataTypeRepository(db)(routeEc)
    dataTypeRowRepo = new DataTypeRowRepository(db)(routeEc)
    dataSourceRepo  = new DataSourceRepository(db)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Build a real AccessChecker against the same repo wiring the service expects.
   *  The /rows route doesn't actually exercise ACL so no extra setup is needed. */
  private def makeAccessChecker: AccessCheckerImpl = {
    implicit val ec: ExecutionContext = routeEc
    val permissionRepo = new ResourcePermissionRepository(db)(ec)
    val registry = new ResourceTypeRegistry(
      ResourceType("data-type", id => dataTypeRepo.findById(DataTypeId(id)).map(_.map(_.ownerId.value)))
    )
    new AccessCheckerImpl(permissionRepo, registry)
  }

  private def makeRoutes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo, makeAccessChecker)
    new DataTypeRoutes(service, dummyUser)(typedSystem).routes
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
  }
}
