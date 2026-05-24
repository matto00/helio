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
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** Regression tests for HEL-261: inferred `DataType` schemas must derive
 *  field names and types exclusively from the source data — no fabricated
 *  or placeholder fields injected.
 *
 *  One test per source kind (CSV, Static). SQL coverage lives in
 *  `SqlConnectorSpec` because `SqlConnector.inferSchema` is a pure
 *  function requiring no DB. */
class SchemaInferenceRegressionSpec
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
  private var fileSystem: LocalFileSystem        = _
  private var service: DataSourceService         = _

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
    dataTypeRepo   = new DataTypeRepository(db)
    dataSourceRepo = new DataSourceRepository(db)
    val tmpDir     = Files.createTempDirectory("helio-schema-inference-regression")
    fileSystem     = new LocalFileSystem(tmpDir)
    service        = new DataSourceService(dataSourceRepo, dataTypeRepo, fileSystem)
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

  // ── CSV ───────────────────────────────────────────────────────────────────

  "CSV source creation" should {

    "produce a DataType with exactly the fields named in the CSV header — no extras" in {
      cleanDb()
      // 3 data rows, 2 columns: "city" and "population"
      val csv   = "city,population\nLondon,9000000\nParis,2100000\nBerlin,3700000"
      val bytes = csv.getBytes(StandardCharsets.UTF_8)

      val src = await(service.createCsv("Cities", bytes, Vector.empty, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createCsv failed: $e")
      }

      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      val dt = dts.head

      // Exactly 2 fields — no fabricated extras
      dt.fields should have size 2
      // Field names come from the header, not from any constant
      dt.fields.map(_.name) should contain theSameElementsAs Seq("city", "population")
    }

    "derive field types from the data rows, not from a fallback constant" in {
      cleanDb()
      // "score" is all integers; "label" is strings
      val csv   = "score,label\n10,alpha\n20,beta\n30,gamma"
      val bytes = csv.getBytes(StandardCharsets.UTF_8)

      val src = await(service.createCsv("Scores", bytes, Vector.empty, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createCsv failed: $e")
      }

      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      val dt = dts.head

      dt.fields should have size 2
      val byName = dt.fields.map(f => f.name -> f.dataType).toMap
      byName("score") shouldBe "integer"
      byName("label") shouldBe "string"
    }
  }

  // ── Static ────────────────────────────────────────────────────────────────

  "Static source creation" should {

    "produce a DataType with exactly the fields declared in the column spec — no extras" in {
      cleanDb()
      val req = StaticDataSourceRequest(
        name    = "Lookup",
        `type`  = "static",
        columns = Vector(
          StaticColumnPayload("product_id", "integer"),
          StaticColumnPayload("product_name", "string")
        ),
        rows = Vector(
          Vector[JsValue](JsNumber(1), JsString("Widget")),
          Vector[JsValue](JsNumber(2), JsString("Gadget")),
          Vector[JsValue](JsNumber(3), JsString("Doohickey"))
        )
      )

      val src = await(service.createStatic(req, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createStatic failed: $e")
      }

      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      val dt = dts.head

      // Exactly 2 fields — matching the column spec
      dt.fields should have size 2
      dt.fields.map(_.name) should contain theSameElementsAs Seq("product_id", "product_name")
    }

    "use the declared column types directly — no sniffing or fabrication" in {
      cleanDb()
      val req = StaticDataSourceRequest(
        name    = "Booleans",
        `type`  = "static",
        columns = Vector(
          StaticColumnPayload("flag", "boolean"),
          StaticColumnPayload("ts", "timestamp")
        ),
        rows = Vector(
          Vector[JsValue](JsString("true"), JsString("2024-01-01"))
        )
      )

      val src = await(service.createStatic(req, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"createStatic failed: $e")
      }

      val dts = await(dataTypeRepo.findBySourceId(src.id, owner))
      dts should have size 1
      val byName = dts.head.fields.map(f => f.name -> f.dataType).toMap
      byName("flag") shouldBe "boolean"
      byName("ts")   shouldBe "timestamp"
    }
  }
}
