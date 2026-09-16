package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, OptionValues}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json.{JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1107 task 4.1 (design.md D6, mirrors `PipelineAnalyzeConvertFormatSpec`'s own precedent):
 *  analyze reports the `generatetext` output column as `string-body` without calling the model,
 *  flags the documented `validationError`s, and `GET /pipelines/:id/analyze` succeeds (not 500)
 *  for a persisted `generatetext` step. */
class PipelineAnalyzeGenerateTextSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OptionValues {

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

  private def newSource(owner: AuthenticatedUser, schema: Vector[SchemaField]): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "analyze-gt-src", owner.id, now, now,
      inferredSchema = schema
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  private def newPipeline(owner: AuthenticatedUser, schema: Vector[SchemaField]): PipelineId = {
    val s   = newSource(owner, schema)
    val req = CreatePipelineRequest(name = "analyze-gt-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
    PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
  }

  "PipelineService.analyze" should {
    "report the generatetext output column as string-body without calling the model, and denies auto-run with ai-step" in {
      val owner = newUser()
      val pid   = newPipeline(owner, Vector(SchemaField("content", "string-body")))

      val gtReq = CreatePipelineStepRequest(
        `type` = "generatetext",
        config = JsObject(
          "inputField"  -> JsString("content"),
          "instruction" -> JsString("Summarize this"),
          "outputField" -> JsString("summary")
        )
      )
      await(service.addStep(pid, gtReq, owner)) shouldBe a[Right[_, _]]

      val result   = await(service.analyze(pid, owner))
      val response = result.getOrElse(fail("expected Right"))

      val gtStep = response.steps.collectFirst { case g: GenerateTextAnalyzeStepResponse => g }
        .getOrElse(fail("expected a GenerateTextAnalyzeStepResponse in the analyze response"))
      gtStep.validationError shouldBe None
      gtStep.outputSchema should contain(SchemaFieldResponse("summary", "string-body"))

      response.costVerdict.autoRunnable shouldBe false
      response.costVerdict.reasons.exists(_.code == "ai-step") shouldBe true
    }

    "flag a validationError with 200 when inputField is unknown" in {
      val owner = newUser()
      val pid   = newPipeline(owner, Vector(SchemaField("content", "string-body")))

      val gtReq = CreatePipelineStepRequest(
        `type` = "generatetext",
        config = JsObject(
          "inputField"  -> JsString("missingField"),
          "instruction" -> JsString("Summarize this"),
          "outputField" -> JsString("summary")
        )
      )
      await(service.addStep(pid, gtReq, owner)) shouldBe a[Right[_, _]]

      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      val gtStep = response.steps.collectFirst { case g: GenerateTextAnalyzeStepResponse => g }
        .getOrElse(fail("expected a GenerateTextAnalyzeStepResponse"))
      gtStep.validationError.value should include("missingField")
    }

    "flag a validationError with 200 when inputField is not a content field" in {
      val owner = newUser()
      val pid   = newPipeline(owner, Vector(SchemaField("content", "string-body"), SchemaField("count", "integer")))

      val gtReq = CreatePipelineStepRequest(
        `type` = "generatetext",
        config = JsObject(
          "inputField"  -> JsString("count"),
          "instruction" -> JsString("Summarize this"),
          "outputField" -> JsString("summary")
        )
      )
      await(service.addStep(pid, gtReq, owner)) shouldBe a[Right[_, _]]

      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      val gtStep = response.steps.collectFirst { case g: GenerateTextAnalyzeStepResponse => g }
        .getOrElse(fail("expected a GenerateTextAnalyzeStepResponse"))
      gtStep.validationError.value should include("string")
    }

    "succeed (not 500) for a persisted pipeline containing a generatetext step" in {
      val owner = newUser()
      val pid   = newPipeline(owner, Vector(SchemaField("content", "string-body")))

      val gtReq = CreatePipelineStepRequest(
        `type` = "generatetext",
        config = JsObject(
          "inputField"  -> JsString("content"),
          "instruction" -> JsString("Summarize this"),
          "outputField" -> JsString("summary")
        )
      )
      await(service.addStep(pid, gtReq, owner)) shouldBe a[Right[_, _]]

      val result = await(service.analyze(pid, owner))
      result shouldBe a[Right[_, _]]
    }
  }
}
