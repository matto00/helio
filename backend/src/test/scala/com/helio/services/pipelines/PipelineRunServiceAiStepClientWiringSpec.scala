package com.helio.services.pipelines

import com.helio.ai.{ClaudeAiStepClient, ClaudeApiException, ClaudeApiRequest, ClaudeApiResponse, ClaudeClient, ClaudeConfig, ClaudeStreamEvent, ClaudeTransport}
import com.helio.domain.ai.AiStepClient
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1106 (design.md Risks: "constructor defaults hide a missing wiring"): proves
 *  `PipelineRunService`'s `aiStepClient` constructor param genuinely reaches the execution
 *  context an `analyzewithai` step's `evaluate` sees -- not merely that the parameter compiles.
 *  Runs the SAME pipeline through two `PipelineRunService` instances differing only in that one
 *  constructor argument: the default-wired service fails `ai-unavailable` (proving the DEFAULT is
 *  really `AiStepClient.Unavailable`, tasks.md/design.md D3); the explicitly-wired service (a
 *  real `ClaudeAiStepClient` over a fake `ClaudeTransport`, tasks.md C3 -- zero network) instead
 *  reaches the transport and fails `ai-error` for a canned API failure -- a DIFFERENT reason that
 *  could only be reached if the configured client, not the default, is what the step actually
 *  called. This is the same wiring shape `ApiRoutes` uses in production (`ClaudeConfig.fromEnv()`
 *  -> `ClaudeAiStepClient` -> `PipelineRunService(aiStepClient = ...)`). */
class PipelineRunServiceAiStepClientWiringSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var pipelineRepo: PipelineRepository       = _
  private var stepRepo: PipelineStepRepository       = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository           = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    stepRepo         = new PipelineStepRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRunRepo  = new PipelineRunRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def newRunService(aiStepClient: AiStepClient): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo,
      cache = new PipelineRunCache(), registry = null, fileSystem = new LocalFileSystem(Paths.get("/")),
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo,
      aiStepClient = aiStepClient
    )

  private def seedDsWithData(): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
        (id, name, source_type, config, owner_id, created_at, updated_at)
        VALUES ($dsId, 'ds-wiring', 'dataset', '{}',
          '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  private def seedPipelineWithAnalyzeWithAi(dsId: String): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'pipe-wiring', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
    await(stepRepo.insertInternal(pipelineId, "analyzewithai", cfg, enabled = true, parentStepId = None, explicitRootId = None))
    pipelineId
  }

  private class FailingTransport extends ClaudeTransport {
    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
      Future.failed(ClaudeApiException(503, "canned wiring-proof failure"))
    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("not exercised by this spec")
  }

  "PipelineRunService(aiStepClient = ...)" should {

    "defaults to AiStepClient.Unavailable when the param is omitted -- a run fails ai-unavailable" in {
      val dsId    = seedDsWithData()
      val pid     = seedPipelineWithAnalyzeWithAi(dsId)
      val service = newRunService(AiStepClient.Unavailable)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      result.left.toOption.get.toString should include("ai-unavailable")
    }

    "an explicitly-configured client reaches the execution context -- a run instead fails ai-error, proving the configured client (not the default) was called" in {
      val dsId    = seedDsWithData()
      val pid     = seedPipelineWithAnalyzeWithAi(dsId)
      val config  = ClaudeConfig(apiKey = "sk-ant-test-key-not-a-real-credential", model = "claude-opus-4-8", temperature = 1.0, maxOutputTokens = 4096, maxInputTokens = 100000)
      val client  = new ClaudeAiStepClient(new ClaudeClient(config, new FailingTransport))(ec)
      val service = newRunService(client)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      val message = result.left.toOption.get.toString
      message should include("ai-error")
      message should not include "ai-unavailable"
    }
  }
}
