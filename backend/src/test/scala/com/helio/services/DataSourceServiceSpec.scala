package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.{AccessCheckerImpl, ResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.{StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, LocalFileSystem, ResourcePermissionRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.{JsNumber, JsString, JsValue}

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Service-level coverage for `DataSourceService`, focused on the cycle-2
 *  Fix D refresh-upsert behaviour: refresh against a CSV / Static source
 *  whose linked DataType is missing must re-create the DT (instead of the
 *  pre-fix silent no-op), and a CSV refresh against a missing file must
 *  surface an actionable BadRequest. */
class DataSourceServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var dataSourceRepo: DataSourceRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var fileSystem: LocalFileSystem        = _
  private var service: DataSourceService         = _

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    dataTypeRepo   = new DataTypeRepository(db)
    dataSourceRepo = new DataSourceRepository(db)
    permissionRepo = new ResourcePermissionRepository(db)
    val tmpDir     = Files.createTempDirectory("helio-data-source-service-spec")
    fileSystem     = new LocalFileSystem(tmpDir)
    val registry = new ResourceTypeRegistry(
      ResourceType("data-source", id => dataSourceRepo.findById(DataSourceId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    service = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem, accessChecker)
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

  private def createCsvSource(content: String, name: String = "Sales CSV"): DataSource = {
    val bytes = content.getBytes(StandardCharsets.UTF_8)
    await(service.createCsv(name, bytes, Vector.empty, user)) match {
      case Right(src) => src
      case Left(err)  => fail(s"createCsv failed: $err")
    }
  }

  "DataSourceService.refresh (CSV)" should {

    "update the linked DataType when present" in {
      cleanDb()
      val src = createCsvSource("a,b\n1,2\n3,4")

      val result = await(service.refresh(src.id, None, user))

      result.isRight shouldBe true
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      dts.head.fields.map(_.name) should contain allOf ("a", "b")
    }

    "re-create the linked DataType when missing (Fix D)" in {
      cleanDb()
      val src = createCsvSource("col1,col2\n1,2")
      // Simulate the orphan scenario: delete the DT row directly (bypassing
      // the Fix-B′ guard at the service layer).
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts.foreach(dt => await(dataTypeRepo.delete(dt.id)))
      await(dataTypeRepo.findBySourceId(src.id, owner)) shouldBe empty

      val result = await(service.refresh(src.id, None, user))

      result.isRight shouldBe true
      val recreated = await(dataTypeRepo.findBySourceId(src.id, owner))
      recreated should have size 1
      recreated.head.sourceId shouldBe Some(src.id)
      recreated.head.fields.map(_.name) should contain allOf ("col1", "col2")
    }

    "return BadRequest with an actionable message when the source file is missing" in {
      cleanDb()
      val src = createCsvSource("x\n1")
      // Wipe the underlying file so the refresh read fails with NoSuchFileException.
      src match {
        case c: CsvSource => await(fileSystem.delete(c.config.path))
        case _ => fail("expected CsvSource")
      }

      val result = await(service.refresh(src.id, None, user))

      result match {
        case Left(ServiceError.BadRequest(msg)) =>
          msg should include("missing on disk")
          msg should include("re-upload")
        case other => fail(s"Expected BadRequest, got: $other")
      }
    }
  }

  "DataSourceService.refresh (Static)" should {

    "re-create the linked DataType when missing (Fix D)" in {
      cleanDb()
      val createReq = StaticDataSourceRequest(
        name    = "Lookup",
        `type`  = "static",
        columns = Vector(StaticColumnPayload("id", "integer")),
        rows    = Vector(Vector(JsNumber(1)))
      )
      val src = await(service.createStatic(createReq, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createStatic failed: $e")
      }
      // Orphan: delete the linked DT.
      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts.foreach(dt => await(dataTypeRepo.delete(dt.id)))

      val refreshPayload = StaticDataPayload(
        columns = Vector(StaticColumnPayload("id", "integer"), StaticColumnPayload("label", "string")),
        rows    = Vector(Vector[JsValue](JsNumber(1), JsString("Alice")))
      )
      val result = await(service.refresh(src.id, Some(refreshPayload), user))

      result.isRight shouldBe true
      val recreated = await(dataTypeRepo.findBySourceId(src.id, owner))
      recreated should have size 1
      recreated.head.sourceId shouldBe Some(src.id)
      recreated.head.fields.map(_.name) should contain allOf ("id", "label")
    }
  }
}
