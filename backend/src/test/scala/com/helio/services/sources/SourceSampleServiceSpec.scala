package com.helio.services.sources

import com.helio.api.protocols.sources.SourceSampleResponse
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model._
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.net.InetAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Success, Try}

/** HEL-1628 task 1.2: `SourceSampleService` over the real engine, with a stubbed repository (no application DB) and
 *  an embedded Postgres as the SQL target. */
class SourceSampleServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with TempDirectorySupport with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val owner = UserId("00000000-0000-0000-0000-000000000001")
  private val user  = AuthenticatedUser(owner)
  private val now   = Instant.parse("2026-10-16T12:00:00Z")
  private val clock = new Clock { def now(): Instant = SourceSampleServiceSpec.this.now }

  private val baseDir    = newTempDir("sample-service")
  private val fileSystem = new LocalFileSystem(baseDir)

  private var embeddedPostgres: EmbeddedPostgres = _
  override def beforeAll(): Unit =
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
  override def afterAll(): Unit = {
    embeddedPostgres.close()
    super.afterAll()
  }

  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
  private val realResolve: String => Try[Array[InetAddress]] = ContentSourceSupport.defaultResolveHost

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def sourceId(s: String) = DataSourceId(s)

  private def repoOf(ds: DataSource, datasetRows: Option[JsObject] = None) =
    new DataSourceRepository(null)(executor) {
      override def findByIdOwned(id: DataSourceId, u: AuthenticatedUser): Future[Option[DataSource]] =
        Future.successful(if (id == ds.id && u == user) Some(ds) else None)
      override def readDatasetRows(id: DataSourceId): Future[Option[JsObject]] = Future.successful(datasetRows)
    }

  private def serviceFor(repo: DataSourceRepository, connector: RestApiConnectorDriver = null) =
    new SourceSampleService(repo, fileSystem, connector, typedSystem, realResolve, admitLocalhost, null, null, clock)

  private def sample(ds: DataSource, connector: RestApiConnectorDriver = null, datasetRows: Option[JsObject] = None) =
    await(serviceFor(repoOf(ds, datasetRows), connector).sample(ds.id, user))

  private def ok(r: Either[ServiceError, SourceSampleResponse]): SourceSampleResponse = r match {
    case Right(v)  => v
    case Left(err) => fail(s"expected a sample, got $err")
  }

  private def csvSource(id: String, path: String, url: Option[String] = None) =
    CsvSource(sourceId(id), "csv-src", owner, now, now, CsvSourceConfig(path, url))

  private def writeCsv(name: String, rowCount: Int): Unit = {
    val body = "id,name\n" + (1 to rowCount).map(i => s"$i,n$i").mkString("\n") + "\n"
    Files.createDirectories(baseDir.resolve(name).getParent)
    Files.write(baseDir.resolve(name), body.getBytes(StandardCharsets.UTF_8))
  }

  private def sqlSource(id: String, query: String) =
    SqlSource(sourceId(id), "sql-src", owner, now, now,
      SqlSourceConfig("postgresql", "localhost", embeddedPostgres.getPort, "postgres", "postgres", "postgres", query))

  "SourceSampleService" should {

    "return a dataset source whole, exact and static" in {
      val ds   = DatasetSource(sourceId("ds-1"), "ds", owner, now, now)
      val rows = JsObject(
        "columns" -> JsArray(JsObject("name" -> JsString("a")), JsObject("name" -> JsString("b"))),
        "rows"    -> JsArray(JsArray(JsNumber(1), JsString("x")), JsArray(JsNumber(2), JsNull))
      )
      val r = ok(sample(ds, datasetRows = Some(rows)))
      r.rows should have size 2
      r.rows.head.fields("a") shouldBe JsNumber(1)
      r.rows(1).fields("b") shouldBe JsNull
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((Some(2L), false, false))
      r.capturedAt shouldBe now.toString
    }

    "return an uploaded CSV under the cap exactly, in file order" in {
      writeCsv("csv/under.csv", 412)
      val r = ok(sample(csvSource("csv-under", "csv/under.csv")))
      r.rows should have size 412
      r.rows.head.fields("id") shouldBe JsString("1")
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((Some(412L), false, false))
    }

    "return the first 1000 rows of an uploaded CSV over the cap, with the true total" in {
      writeCsv("csv/over.csv", 1500)
      val r = ok(sample(csvSource("csv-over", "csv/over.csv")))
      r.rows should have size 1000
      r.rows.head.fields("id") shouldBe JsString("1")
      r.rows.last.fields("id") shouldBe JsString("1000")
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((Some(1500L), true, false))
    }

    "mark a URL-backed CSV live, and fail a blocked host through the shared seam (502) without reaching it" in {
      // https://localhost resolves to loopback, which the production egress guard refuses; nothing listens there.
      val ds = csvSource("csv-url", "csv/url.csv", Some("https://localhost:1/data.csv"))
      SourceSampleService.isLive(ds) shouldBe true
      val productionGuard = new SourceSampleService(repoOf(ds), fileSystem, null, typedSystem, realResolve, (_, addr) => ContentSourceSupport.isBlockedAddress(addr), null, null, clock)
      await(productionGuard.sample(ds.id, user)) match {
        case Left(ServiceError.BadGateway(m)) =>
          m should include("csv-src")
          m.toLowerCase should (include("blocked") or include("private") or include("not allowed") or include("disallowed"))
        case other => fail(s"expected 502, got $other")
      }
    }

    "load a REST source exactly as the engine does (flattened), not as raw JSON" in {
      val connector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray(
          JsObject("id" -> JsNumber(1), "owner" -> JsObject("name" -> JsString("ann"), "tags" -> JsArray(JsString("a")))),
          JsObject("id" -> JsNumber(2), "owner" -> JsObject("name" -> JsString("bob"), "tags" -> JsArray()))
        )))
      })
      val ds = RestSource(sourceId("rest-1"), "rest", owner, now, now, RestApiConfig(connectorId = "https://rest.test/x"))
      val r  = ok(sample(ds, connector))
      val (engineRows, _) = await(new InProcessPipelineEngine(fileSystem, connector).loadRowsWithStats(ds, null))
      r.rows shouldBe engineRows.map(SampleRowJson.encode).toVector
      r.rows.head.fields.keySet should not contain "owner" // nested object is flattened by the engine
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((Some(2L), false, true))
    }

    "report a truncated REST read with its known total" in {
      val connector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray((1 to 1234).map(i => JsObject("id" -> JsNumber(i))).toVector)))
      })
      val ds = RestSource(sourceId("rest-big"), "rest", owner, now, now, RestApiConfig(connectorId = "https://rest.test/big"))
      val r  = ok(sample(ds, connector))
      r.rows should have size 1000
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((Some(1234L), true, true))
    }

    "report a truncated SQL read with an unknown total as sourceRowCount None" in {
      val r = ok(sample(sqlSource("sql-big", "SELECT * FROM generate_series(1, 1001) AS n")))
      r.rows should have size 1000
      (r.sourceRowCount, r.truncated, r.live) shouldBe ((None, true, true))
    }

    "encode SQL integers losslessly as doubles (the engine's typing), not as $int" in {
      val r = ok(sample(sqlSource("sql-small", "SELECT 1 AS one")))
      r.rows.head.fields("one") shouldBe JsNumber(1)
      (r.sourceRowCount, r.truncated) shouldBe ((Some(1L), false))
    }

    "refuse an image source with 400 and never write" in {
      val ds = ImageSource(sourceId("img-1"), "img", owner, now, now, ImageSourceConfig("image/img-1.png", Some("https://localhost:1/x.png")))
      sample(ds) match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                            => fail(s"expected 400, got $other")
      }
      Files.exists(baseDir.resolve("image/img-1.png")) shouldBe false
    }

    "answer 404 for an unknown or unowned source" in {
      val ds = DatasetSource(sourceId("ds-2"), "ds", owner, now, now)
      await(serviceFor(repoOf(ds)).sample(sourceId("nope"), user)) shouldBe Left(ServiceError.NotFound("Data source not found"))
      await(serviceFor(repoOf(ds)).sample(ds.id, AuthenticatedUser(UserId("00000000-0000-0000-0000-0000000000ff")))) shouldBe
        Left(ServiceError.NotFound("Data source not found"))
    }

    "answer 404 with the re-upload message when the uploaded file is gone" in {
      sample(csvSource("csv-missing", "csv/does-not-exist.csv")) match {
        case Left(ServiceError.NotFound(m)) => m should include("re-uploaded")
        case other                          => fail(s"expected 404, got $other")
      }
    }

    "answer 502 with a curated message when the live source cannot be read (no row contents, no credentials)" in {
      val connector = new RestApiConnectorDriver(Some(_ => Future.successful(Left("endpoint unreachable"))))
      val ds        = RestSource(sourceId("rest-fail"), "rest", owner, now, now, RestApiConfig(connectorId = "https://rest.test/fail"))
      sample(ds, connector) match {
        case Left(ServiceError.BadGateway(m)) => m shouldBe "endpoint unreachable"
        case other                            => fail(s"expected 502, got $other")
      }
    }

    "answer 502 with a generic message for an unexpected read failure" in {
      val connector = new RestApiConnectorDriver(Some(_ => Future.failed(new IllegalStateException("password=hunter2 row=secret"))))
      val ds        = RestSource(sourceId("rest-boom"), "rest", owner, now, now, RestApiConfig(connectorId = "https://rest.test/boom"))
      sample(ds, connector) match {
        case Left(ServiceError.BadGateway(m)) => m shouldBe "Failed to read source"
        case other                            => fail(s"expected 502, got $other")
      }
    }
  }
}
