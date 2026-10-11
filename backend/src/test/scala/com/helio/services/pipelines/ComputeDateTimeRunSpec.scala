package com.helio.services.pipelines

import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.model._
import com.helio.domain.steps.{CastConfig, ComputeConfig}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1314: a CSV source through the REAL run path (cast to timestamp, then compute date/time
 *  functions, `PipelineRunService.submit` against an embedded Postgres), asserting the persisted
 *  `node_snapshots` JSON kinds equal the types analyze projects for the same steps. */
class ComputeDateTimeRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var stepRepo: PipelineStepRepository         = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository             = _
  private var service: PipelineRunService              = _

  private val user = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo           = new PipelineStepRepository(ctx)
    nodeSnapshotRepo   = new NodeSnapshotRepository(ctx)
    outputRepo         = new OutputRepository(ctx)
    service = new PipelineRunService(
      new PipelineRepository(ctx, dataSourceRepo), stepRepo, dataSourceRepo, new PipelineRunRepository(ctx),
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private val csv =
    """id,created_at,started_at
      |1,2026-07-01T12:00:00Z,2026-07-01T12:01:30Z
      |2,2026-07-01 08:00:00,2026-07-01T10:00:00+02:00
      |3,2026-07-01,not a date
      |""".stripMargin

  private val CastJson   = """{"casts":{"created_at":"timestamp","started_at":"timestamp"}}"""
  private val QueueExpr  = "seconds_between($started_at, $created_at)"
  private val BucketExpr = """date_trunc("day", $created_at)"""

  private def seedCsvPipeline(): PipelineId = {
    import PostgresProfile.api._
    val file = newTempFile("hel1314-run-", ".csv")
    Files.write(file, csv.getBytes(StandardCharsets.UTF_8))
    val dsId   = UUID.randomUUID().toString
    val pid    = UUID.randomUUID().toString
    val config = JsObject("path" -> JsString(file.toAbsolutePath.toString)).compactPrint
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'hel1314-csv', 'csv', $config::jsonb, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def computeJson(column: String, expr: String): String =
    JsObject("column" -> JsString(column), "expression" -> JsString(expr)).compactPrint

  "cast to timestamp then compute date/time functions over a CSV source" should {

    "persist numbers and strings of the kinds analyze projects, with an unparseable row null and the run succeeded" in {
      val pid   = seedCsvPipeline()
      val cast  = await(stepRepo.insertInternal(pid, "cast", CastConfig(Map("created_at" -> "timestamp", "started_at" -> "timestamp")), enabled = true, None, explicitRootId = None)).id
      val queue = await(stepRepo.insertInternal(pid, "compute", ComputeConfig("queue_s", QueueExpr, None), enabled = true, Some(cast), explicitRootId = None)).id
      val last  = await(stepRepo.insertInternal(pid, "compute", ComputeConfig("day", BucketExpr, None), enabled = true, Some(queue), explicitRootId = None)).id
      await(outputRepo.insertInternal(pid, Some(last), user.id, "out", OutputKind.Table, explicitRootId = None))
      await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
      val rows = await(nodeSnapshotRepo.listRows(pid.value, Some(last.value), explicitRootId = None)).sortBy(_.fields("id").compactPrint)

      rows.map(_.fields("queue_s")) shouldBe Vector(JsNumber(90), JsNumber(0), JsNull)
      rows.map(_.fields("day")) shouldBe Vector(
        JsString("2026-07-01T00:00:00Z"), JsString("2026-07-01T00:00:00Z"), JsString("2026-07-01T00:00:00Z")
      )

      val roots = Map("L" -> Vector(SchemaField("id", "string"), SchemaField("created_at", "string"), SchemaField("started_at", "string")))
      val steps = Vector(
        NodeStepInput("k", None, 0, "cast", CastJson, Some("L"), true),
        NodeStepInput("c1", Some("k"), 1, "compute", computeJson("queue_s", QueueExpr), Some("L"), true),
        NodeStepInput("c2", Some("c1"), 2, "compute", computeJson("day", BucketExpr), Some("L"), true)
      )
      val out = PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)("c2").outputSchema.map(f => f.name -> f.`type`).toMap
      out("queue_s") shouldBe "float"
      out("day") shouldBe "timestamp"
    }
  }
}
