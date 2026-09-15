package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.{JsArray, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1106 task 3.5 (design.md D7, mirrors `PipelineAnalyzeConvertFormatSpec`'s own precedent):
 *  `GET /pipelines/:id/analyze` must succeed (not 500) for a persisted pipeline containing an
 *  `analyzewithai` step -- proves `PipelineStepRepository.rowToDomain` decodes the persisted
 *  step and `PipelineService.toAnalyzeStepResponse` builds its response, entirely without an AI
 *  client (analyze never calls the model, design.md D7). */
class PipelineAnalyzeAnalyzeWithAiSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRootRepo: PipelineRootRepository = _
  private var outputRepo: OutputRepository             = _
  private var service: PipelineService                 = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRootRepo = new PipelineRootRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    service = new PipelineService(
      pipelineRepo, pipelineStepRepo, dataSourceRepo,
      outputRepo = outputRepo, pipelineRootRepo = pipelineRootRepo
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import slick.jdbc.PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "analyze-ai-src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("content", "string-body"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  "PipelineService.analyze" should {
    "succeed (not 500) for a persisted pipeline containing an analyzewithai step, and reports its declared output schema" in {
      val owner = newUser()
      val s     = newSource(owner)
      val req   = CreatePipelineRequest(name = "analyze-ai-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid   = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)

      val aiReq = CreatePipelineStepRequest(
        `type` = "analyzewithai",
        config = JsObject(
          "inputField"   -> JsString("content"),
          "instruction"  -> JsString("Classify sentiment"),
          "outputSchema" -> JsArray(
            JsObject("name" -> JsString("sentiment"), "type" -> JsString("string")),
            JsObject("name" -> JsString("score"), "type" -> JsString("float"))
          )
        )
      )
      await(service.addStep(pid, aiReq, owner)) shouldBe a[Right[_, _]]

      val result = await(service.analyze(pid, owner))
      result shouldBe a[Right[_, _]]
      val response = result.getOrElse(fail("expected Right"))

      val aiStep = response.steps.collectFirst { case a: AnalyzeWithAiAnalyzeStepResponse => a }
        .getOrElse(fail("expected an AnalyzeWithAiAnalyzeStepResponse in the analyze response"))
      aiStep.validationError shouldBe None
      aiStep.outputSchema.map(_.name) shouldBe Vector("content", "sentiment", "score")
      aiStep.outputSchema.map(_.`type`) shouldBe Vector("string-body", "string", "float")

      // Cost verdict: analyzewithai is an AiOps member (unchanged, PipelineCostEstimator.AiOps),
      // so the same classification wiring HEL-1105 proved for convertformat's content-conversion
      // reason holds here for ai-step.
      response.costVerdict.autoRunnable shouldBe false
      val aiReason = response.costVerdict.reasons.find(_.code == "ai-step")
        .getOrElse(fail(s"expected an ai-step cost reason, got: ${response.costVerdict.reasons}"))
      aiReason.stepId shouldBe Some(aiStep.id)
    }
  }
}
