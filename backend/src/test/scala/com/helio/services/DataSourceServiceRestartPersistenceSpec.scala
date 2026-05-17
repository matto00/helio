package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import com.helio.api.protocols.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, LocalFileSystem}
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

/** Regression coverage for HEL-256 acceptance criterion #2: each source kind
 *  retains its inferred schema across a service-layer "restart". Because the
 *  schema is persisted in `data_types` (PostgreSQL, via Flyway), restart in
 *  this context means re-instantiating the service stack against the same
 *  Slick `Database` — no process bounce required to prove the durability
 *  contract. */
class DataSourceServiceRestartPersistenceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

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
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
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

  /** Build a fresh service stack against the shared DB. Two calls return two
   *  independent service objects with their own repository instances —
   *  exactly the situation the JVM has after restart. */
  private def buildServices(uploadsDir: java.nio.file.Path): (DataSourceService, DataTypeRepository, DataSourceRepository) = {
    val dataSourceRepo = new DataSourceRepository(db)
    val dataTypeRepo   = new DataTypeRepository(db)
    val fileSystem     = new LocalFileSystem(uploadsDir)
    val service        = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
    (service, dataTypeRepo, dataSourceRepo)
  }

  "Schema persistence across a service restart" should {

    "retain the inferred DataType for a CSV source" in {
      cleanDb()
      val uploadsDir = Files.createTempDirectory("helio-restart-csv")
      val (service1, _, _) = buildServices(uploadsDir)
      val createBytes      = "id,name\n1,Alice\n2,Bob".getBytes(StandardCharsets.UTF_8)
      val srcId = await(service1.createCsv("Restart CSV", createBytes, Vector.empty, user)) match {
        case Right(src) => src.id
        case Left(err)  => fail(s"createCsv failed: $err")
      }

      // "Restart": rebuild repositories + service against the same DB.
      val (_, dataTypeRepo2, dataSourceRepo2) = buildServices(uploadsDir)
      val sourceAfter = await(dataSourceRepo2.findByIdInternal(srcId))
      sourceAfter should not be empty

      val dtsAfter = await(dataTypeRepo2.findBySourceId(srcId, owner))
      dtsAfter should have size 1
      dtsAfter.head.sourceId shouldBe Some(srcId)
      dtsAfter.head.fields.map(_.name) should contain allOf ("id", "name")
    }

    "retain the inferred DataType for a Static source" in {
      cleanDb()
      val uploadsDir       = Files.createTempDirectory("helio-restart-static")
      val (service1, _, _) = buildServices(uploadsDir)
      val req = StaticDataSourceRequest(
        name    = "Restart Static",
        `type`  = "static",
        columns = Vector(StaticColumnPayload("id", "integer"), StaticColumnPayload("label", "string")),
        rows    = Vector(Vector[JsValue](JsNumber(1), JsString("Alice")))
      )
      val srcId = await(service1.createStatic(req, user)) match {
        case Right(src) => src.id
        case Left(err)  => fail(s"createStatic failed: $err")
      }

      val (_, dataTypeRepo2, dataSourceRepo2) = buildServices(uploadsDir)
      await(dataSourceRepo2.findByIdInternal(srcId)) should not be empty
      val dtsAfter = await(dataTypeRepo2.findBySourceId(srcId, owner))
      dtsAfter should have size 1
      dtsAfter.head.sourceId shouldBe Some(srcId)
      dtsAfter.head.fields.map(_.name) should contain allOf ("id", "label")
    }

    "retain the inferred DataType for a SQL source" in {
      cleanDb()
      // SqlSource is not created via DataSourceService; the SQL ingest flow
      // sits behind SourceService (REST/SQL routes). We exercise the row
      // round-trip directly through the repositories, which is what
      // SourceService.createSqlSource ultimately writes.
      val (_, _, dataSourceRepo1) = buildServices(Files.createTempDirectory("helio-restart-sql"))
      val dataTypeRepo1           = new DataTypeRepository(db)
      val now                     = java.time.Instant.now()
      val srcId                   = DataSourceId(UUID.randomUUID().toString)
      val sqlSource = SqlSource(
        id        = srcId,
        name      = "Restart SQL",
        ownerId   = owner,
        createdAt = now,
        updatedAt = now,
        config    = SqlSourceConfig(
          dialect  = "postgresql",
          host     = "localhost",
          port     = 5432,
          database = "test",
          user     = "postgres",
          password = "",
          query    = "SELECT 1 AS x, 2.0 AS y"
        )
      )
      await(dataSourceRepo1.insert(sqlSource))
      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = Some(srcId),
        name      = "Restart SQL",
        fields    = Vector(
          DataField("x", "X", "integer", nullable = false),
          DataField("y", "Y", "float",   nullable = false)
        ),
        version   = 1,
        createdAt = now,
        updatedAt = now,
        ownerId   = owner
      )
      await(dataTypeRepo1.insert(dt))

      // "Restart": fresh repos against the same DB.
      val dataSourceRepo2 = new DataSourceRepository(db)
      val dataTypeRepo2   = new DataTypeRepository(db)
      await(dataSourceRepo2.findByIdInternal(srcId)) should not be empty
      val dtsAfter = await(dataTypeRepo2.findBySourceId(srcId, owner))
      dtsAfter should have size 1
      dtsAfter.head.sourceId shouldBe Some(srcId)
      dtsAfter.head.fields.map(_.name) should contain allOf ("x", "y")
    }
  }
}
