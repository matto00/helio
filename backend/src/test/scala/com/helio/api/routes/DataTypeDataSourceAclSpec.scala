package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{DataSourcesResponse, JsonProtocols}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, LocalFileSystem}
import com.helio.services.{DataSourceService, DataTypeService, PanelService, SourceService}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-265 CS3 — cross-user ACL coverage for DataType + DataSource endpoints.
 *
 *  Seeds data types and sources owned by user A, then asserts that every
 *  read / write endpoint returns 404 when user B (a different authenticated
 *  user) tries to reach them. Also asserts that the same operations succeed
 *  for user A (regression guard for owner read paths). */
class DataTypeDataSourceAclSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var dataTypeRepo: DataTypeRepository       = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var dataSourceRepo: DataSourceRepository   = _

  // Two distinct authenticated users — `userA` owns the resources under test;
  // `userB` is the cross-user probe. Both must exist in the `users` table so
  // the `owner_id` FK is satisfied.
  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataTypeRepo    = new DataTypeRepository(db)(routeEc)
    dataTypeRowRepo = new DataTypeRowRepository(db)(routeEc)
    dataSourceRepo  = new DataSourceRepository(db)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userAId::uuid, ${s"user-a-$userAId@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ($userBId::uuid, ${s"user-b-$userBId@helio.test"}, now())"""
    )))
  }

  private def seedOwnedDataType(ownerId: String): DataTypeId = {
    import PostgresProfile.api._
    val dtId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'TestType', '[]', 1, $ownerId::uuid, now(), now())"""
    ))
    DataTypeId(dtId)
  }

  private def seedOwnedDataSource(ownerId: String): DataSourceId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val cfg  = """{"columns":[],"rows":[]}"""
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'TestSource', 'static', $cfg, $ownerId::uuid, now(), now())"""
    ))
    DataSourceId(dsId)
  }

  // ── Route fixtures ─────────────────────────────────────────────────────────

  private def dataTypeRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val svc = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    new DataTypeRoutes(svc, user)(typedSystem).routes
  }

  private def dataSourceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val tmpDir  = Files.createTempDirectory("helio-acl-spec")
    val fs      = new LocalFileSystem(tmpDir)
    val svc     = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    concat(
      new DataSourceRoutes(svc, user)(typedSystem).routes,
      new DataSourcePreviewRoutes(svc, user)(typedSystem).routes
    )
  }

  private def sourceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val stubConnector = new RestApiConnector(Some(_ => Future.successful(Left("no real HTTP in tests"))))
    val svc           = new SourceService(dataSourceRepo, dataTypeRepo, stubConnector)
    concat(
      new SourceRoutes(svc, user)(typedSystem).routes,
      new SourcePreviewRoutes(svc, user)(typedSystem).routes
    )
  }

  // ── DataType ACL tests ─────────────────────────────────────────────────────

  "GET /types/:id" should {
    "return 200 for the owner" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller (HEL-268 leak closed)" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}") ~> dataTypeRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /types/:id/rows" should {
    "return 200 for the owner" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}/rows") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller (HEL-242 leak closed)" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}/rows") ~> dataTypeRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "GET /types/:id/validate-expression" should {
    "return 200 for the owner" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}/validate-expression?expr=1%2B1") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller" in {
      val dtId = seedOwnedDataType(userAId)
      Get(s"/types/${dtId.value}/validate-expression?expr=1%2B1") ~> dataTypeRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "PATCH /types/:id" should {
    "return 200 for the owner" in {
      val dtId = seedOwnedDataType(userAId)
      val body = JsObject("name" -> JsString("renamed"))
      Patch(s"/types/${dtId.value}", body) ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller" in {
      val dtId = seedOwnedDataType(userAId)
      val body = JsObject("name" -> JsString("hijack"))
      Patch(s"/types/${dtId.value}", body) ~> dataTypeRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "DELETE /types/:id" should {
    "return 204 for the owner" in {
      val dtId = seedOwnedDataType(userAId)
      Delete(s"/types/${dtId.value}") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }
    "return 404 for a cross-user caller and leave the row in place" in {
      val dtId = seedOwnedDataType(userAId)
      Delete(s"/types/${dtId.value}") ~> dataTypeRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // Owner can still read it
      Get(s"/types/${dtId.value}") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  // ── DataSource ACL tests ───────────────────────────────────────────────────

  "GET /data-sources (list)" should {
    "return only the caller's data sources (cross-user sources not leaked)" in {
      val dsIdA = seedOwnedDataSource(userAId)
      val dsIdB = seedOwnedDataSource(userBId)

      Get("/data-sources") ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val ids = responseAs[DataSourcesResponse].items.map(_.id)
        ids should contain(dsIdA.value)
        ids should not contain dsIdB.value
      }
    }
  }

  "PATCH /data-sources/:id" should {
    "return 200 for the owner" in {
      val dsId = seedOwnedDataSource(userAId)
      val body = JsObject("name" -> JsString("renamed-source"))
      Patch(s"/data-sources/${dsId.value}", body) ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
    "return 404 for a cross-user caller" in {
      val dsId = seedOwnedDataSource(userAId)
      val body = JsObject("name" -> JsString("hijack"))
      Patch(s"/data-sources/${dsId.value}", body) ~> dataSourceRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  "DELETE /data-sources/:id" should {
    "return 204 for the owner" in {
      val dsId = seedOwnedDataSource(userAId)
      Delete(s"/data-sources/${dsId.value}") ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.NoContent
      }
    }
    "return 404 for a cross-user caller and leave the row in place" in {
      val dsId = seedOwnedDataSource(userAId)
      Delete(s"/data-sources/${dsId.value}") ~> dataSourceRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
      // Verify the source still exists via the owner's PATCH (which would succeed on a live row)
      val body = JsObject("name" -> JsString("still-alive"))
      Patch(s"/data-sources/${dsId.value}", body) ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  "POST /data-sources/:id/refresh" should {
    "return 404 for a cross-user caller" in {
      val dsId = seedOwnedDataSource(userAId)
      Post(s"/data-sources/${dsId.value}/refresh") ~> dataSourceRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
    "return 200 for the owner (static source with no payload → BadRequest, but not 404)" in {
      val dsId = seedOwnedDataSource(userAId)
      // Static source with no payload returns 400 — not 404.
      Post(s"/data-sources/${dsId.value}/refresh") ~> dataSourceRoutesFor(userA) ~> check {
        // Static source with no payload → 400 (not 404); ownership check passed.
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "GET /data-sources/:id/preview" should {
    "return 404 for a cross-user caller" in {
      val dsId = seedOwnedDataSource(userAId)
      Get(s"/data-sources/${dsId.value}/preview") ~> dataSourceRoutesFor(userB) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
    "return 200 for the owner (static source with empty payload)" in {
      val dsId = seedOwnedDataSource(userAId)
      Get(s"/data-sources/${dsId.value}/preview") ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  // ── Repository-level ACL tests ─────────────────────────────────────────────

  "DataTypeRepository.findByIdOwned" should {
    "return None for wrong owner" in {
      val dtId = seedOwnedDataType(userAId)
      await(dataTypeRepo.findByIdOwned(dtId, userB)) shouldBe None
    }
    "return Some for the correct owner" in {
      val dtId = seedOwnedDataType(userAId)
      await(dataTypeRepo.findByIdOwned(dtId, userA)) shouldBe defined
    }
  }

  "DataTypeRepository.existsBoundToAnyOwnedPanel" should {
    "return false when no panel is bound (cross-user bindings ignored)" in {
      val dtId = seedOwnedDataType(userAId)
      await(dataTypeRepo.existsBoundToAnyOwnedPanel(dtId, userA)) shouldBe false
    }
  }

  "DataSourceRepository.findByIdOwned" should {
    "return None for wrong owner" in {
      val dsId = seedOwnedDataSource(userAId)
      await(dataSourceRepo.findByIdOwned(dsId, userB)) shouldBe None
    }
    "return Some for the correct owner" in {
      val dsId = seedOwnedDataSource(userAId)
      await(dataSourceRepo.findByIdOwned(dsId, userA)) shouldBe defined
    }
  }
}
