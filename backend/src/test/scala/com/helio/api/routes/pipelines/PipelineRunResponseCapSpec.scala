package com.helio.api.routes.pipelines

import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.DatasetRowsTestSupport
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.server.Route
import com.helio.api.JsonProtocols
import com.helio.domain._
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.domain.steps.SelectConfig
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.PipelineRunService
import com.helio.spark.{PipelineRunCache, RunStatus}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1696: every response that carries a run result returns at most 10 rows, the frame's true total and an explicit
 *  `rowsTruncated`, while the run still persists every row. Bodies are read as raw JSON so the assertions state the wire
 *  contract. The real `POST /run` body is also held to `shared-test-fixtures/pipeline-run/run-capped-response.json`,
 *  which the web client and helio-mcp tests read. Regenerate with `HEL1696_WRITE_FIXTURE=1 sbt "testOnly *PipelineRunResponseCapSpec"`. */
class PipelineRunResponseCapSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var pipelineRepo: PipelineRepository         = _
  private var stepRepo: PipelineStepRepository         = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var outputRepo: OutputRepository             = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    stepRepo         = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def seedDataset(n: Int): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val rows = (1 to n).map(i => s"""["row$i",$i.0]""").mkString(",")
    val cfg  = s"""{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[$rows]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'cap-ds', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, cfg)
    )))
    dsId
  }

  private def seedPipeline(n: Int): PipelineId = {
    import PostgresProfile.api._
    val dsId = seedDataset(n)
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'cap-pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def seedOutput(pid: PipelineId): OutputId =
    await(outputRepo.insertInternal(pid, None, dummyUser.id, "out", OutputKind.Table, explicitRootId = None)).id

  private def makeRoutes(cache: PipelineRunCache): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, null, cache, null, new LocalFileSystem(Paths.get("/")), null, null,
      new RestApiConnectorDriver(None), outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )
    concat(new PipelineRunSubmitRoutes(service, dummyUser).routes, new PipelineRunStatusRoutes(service, dummyUser).routes)
  }

  private def body: JsObject = responseAs[String].parseJson.asJsObject

  private def assertCapped(run: JsObject, total: Int): Unit = {
    run.fields("rows").convertTo[Vector[JsValue]] should have size 10
    run.fields("rowCount").convertTo[Int] shouldBe total
    run.fields("rowsTruncated") shouldBe JsBoolean(true)
  }

  private val dir = Paths.get("../shared-test-fixtures/pipeline-run")

  /** The generated run id to a fixed placeholder, in values and in `stepRowCounts` keys. */
  private def normalise(b: JsObject): JsValue = {
    val runId = b.fields("runId").convertTo[String]
    def walk(v: JsValue): JsValue = v match {
      case JsString(s) => JsString(s.replace(runId, "{{RUN_1}}"))
      case JsObject(f) => JsObject(f.map { case (k, x) => k.replace(runId, "{{RUN_1}}") -> walk(x) })
      case JsArray(e)  => JsArray(e.map(walk))
      case other       => other
    }
    walk(b)
  }

  "Run-result responses" should {

    "cap a real POST /run at 10 rows with the total and rowsTruncated, persisting all 25 rows" in {
      val pid = seedPipeline(25)
      seedOutput(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        assertCapped(body, 25)
      }
      await(nodeSnapshotRepo.listRows(pid.value, None, explicitRootId = None)) should have size 25
    }

    "cap a dry run the same way" in {
      val pid = seedPipeline(25)
      seedOutput(pid)
      Post(s"/pipelines/${pid.value}/run?dry=true") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        assertCapped(body, 25)
      }
    }

    "report rowsTruncated false for a run of exactly 10 rows" in {
      val pid = seedPipeline(10)
      seedOutput(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        val run = body
        run.fields("rows").convertTo[Vector[JsValue]] should have size 10
        run.fields("rowCount").convertTo[Int] shouldBe 10
        run.fields("rowsTruncated") shouldBe JsBoolean(false)
      }
    }

    "cap the saved-step preview (POST /preview) and report the cut" in {
      val pid = seedPipeline(25)
      val oid = seedOutput(pid)
      Post(s"/pipelines/${pid.value}/preview?outputId=${oid.value}") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        val preview = body.fields("outputs").convertTo[Vector[JsValue]].head.asJsObject.fields("preview").asJsObject
        assertCapped(preview, 25)
      }
    }

    "cap the single-step preview (GET /steps/:stepId/preview) and report the cut" in {
      val pid  = seedPipeline(25)
      val step = await(stepRepo.insertRootStep(pid, "select", SelectConfig(Vector("name", "score")), dummyUser))
      Get(s"/pipelines/${pid.value}/steps/${step.id.value}/preview") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        assertCapped(body, 25)
      }
    }

    "cap GET /runs/:runId for a cached 25-row run" in {
      val pid   = seedPipeline(1)
      val cache = new PipelineRunCache()
      val runId = "cap-run-1"
      cache.put(runId, pid.value, RunStatus.Queued)
      cache.update(runId, RunStatus.Succeeded, rows = Some((1 to 25).map(i => Map[String, Any]("x" -> i))))
      Get(s"/pipelines/${pid.value}/runs/$runId") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val b = body
        b.fields("rows").convertTo[Vector[JsValue]] should have size 10
        b.fields("rowCount").convertTo[Int] shouldBe 25
        b.fields("rowsTruncated") shouldBe JsBoolean(true)
      }
    }

    "write the same body the shared fixture holds for a real 25-row run" in {
      val pid = seedPipeline(25)
      seedOutput(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(new PipelineRunCache()) ~> check {
        status shouldBe StatusCodes.OK
        val produced = normalise(body)
        val path     = dir.resolve("run-capped-response.json")
        if (sys.env.contains("HEL1696_WRITE_FIXTURE")) { Files.createDirectories(dir); Files.writeString(path, produced.prettyPrint + "\n") }
        produced shouldBe Files.readString(path).parseJson
      }
    }
  }
}
