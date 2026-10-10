package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.domain.steps.{CastConfig, FilterCondition, FilterConfig}
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

/** HEL-1436 task 1.6: a CSV source through the REAL run path (`PipelineRunService.submit`, which
 *  executes via `executeTree`, against an embedded Postgres), asserting on the persisted
 *  `node_snapshots` rows. RED = fails on the pre-fix tree. */
class CastPipelineRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

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
    """id,amount,when
      |1,1.50,2026-03-14T09:30:00Z
      |2,2.25,tomorrow
      |3,x,03/14/2026
      |""".stripMargin

  private def seedCsvPipeline(): PipelineId = {
    import PostgresProfile.api._
    val file = newTempFile("hel1436-run-", ".csv")
    Files.write(file, csv.getBytes(StandardCharsets.UTF_8))
    val dsId   = UUID.randomUUID().toString
    val pid    = UUID.randomUUID().toString
    val config = JsObject("path" -> JsString(file.toAbsolutePath.toString)).compactPrint
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'hel1436-csv', 'csv', $config::jsonb, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def castStep(pid: PipelineId) =
    await(stepRepo.insertInternal(pid, "cast", CastConfig(Map("amount" -> "float", "when" -> "timestamp")), enabled = true, None, explicitRootId = None)).id

  /** Runs for real with an Output on `last` and returns its persisted snapshot rows. */
  private def runAndRead(pid: PipelineId, last: PipelineStepId): Vector[JsObject] = {
    await(outputRepo.insertInternal(pid, Some(last), user.id, "out", OutputKind.Table, explicitRootId = None))
    await(service.submit(pid, isDry = false, user)) shouldBe a[Right[_, _]]
    await(nodeSnapshotRepo.listRows(pid.value, Some(last.value), explicitRootId = None))
  }

  "a cast step through a real pipeline run over a CSV source" should {

    "RED: persist float amounts as JSON numbers, keep original timestamp strings and null the junk" in {
      val pid  = seedCsvPipeline()
      val rows = runAndRead(pid, castStep(pid)).sortBy(_.fields("id").compactPrint)
      rows.map(_.fields("amount")) shouldBe Vector(JsNumber(1.5), JsNumber(2.25), JsNull)
      rows.map(_.fields("when")) shouldBe Vector(JsString("2026-03-14T09:30:00Z"), JsNull, JsString("03/14/2026"))
    }

    "RED: a downstream filter amount = 1.5 keeps only the row whose CSV cell is \"1.50\"" in {
      val pid    = seedCsvPipeline()
      val cast   = castStep(pid)
      val filter = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("and", Vector(FilterCondition("amount", "=", Some("1.5")))),
        enabled = true, Some(cast), explicitRootId = None)).id
      val rows = runAndRead(pid, filter)
      rows.map(_.fields("id")) shouldBe Vector(JsString("1"))
      rows.head.fields("amount") shouldBe JsNumber(1.5)
    }
  }
}
