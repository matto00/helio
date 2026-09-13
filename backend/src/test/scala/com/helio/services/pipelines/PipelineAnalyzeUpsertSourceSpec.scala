package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.SelectConfig
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
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

/** HEL-1100 skeptic-final-1.md CR1: `GET /pipelines/:id/analyze` and `POST
 *  /pipelines/analyze-proposal` must both succeed (not 500) for a pipeline/proposal containing a
 *  registered `upsertsource` step -- reproduces and closes the real
 *  `PipelineService.toAnalyzeStepResponse` `IllegalStateException` found live against the running
 *  app (`codec returned unexpected config type ... for op 'upsertsource'`). */
class PipelineAnalyzeUpsertSourceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
      DataSourceId(UUID.randomUUID().toString), "analyze-src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  "PipelineService.analyze" should {
    "succeed (not 500) for a persisted pipeline containing an upsertsource step, treating it as schema pass-through" in {
      val owner  = newUser()
      val s      = newSource(owner)
      val target = newSource(owner)
      val req = CreatePipelineRequest(name = "analyze-upsert-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)

      val upsertReq = CreatePipelineStepRequest(
        `type` = "upsertsource",
        config = JsObject(
          "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(target.value)),
          "mode"   -> JsString("append")
        )
      )
      await(service.addStep(pid, upsertReq, owner)) shouldBe a[Right[_, _]]

      // A downstream step, to prove its INPUT schema equals the upsertsource step's input
      // schema (design.md D8's pass-through requirement, the spec's own scenario).
      val selectReq = CreatePipelineStepRequest(`type` = "select", config = JsObject("fields" -> JsArray(JsString("amount"))))
      await(service.addStep(pid, selectReq, owner)) shouldBe a[Right[_, _]]

      val result = await(service.analyze(pid, owner))
      result shouldBe a[Right[_, _]]
      val response = result.getOrElse(fail("expected Right"))

      val upsertStep = response.steps.collectFirst { case u: UpsertSourceAnalyzeStepResponse => u }
        .getOrElse(fail("expected an UpsertSourceAnalyzeStepResponse in the analyze response"))
      upsertStep.validationError shouldBe None
      upsertStep.outputSchema shouldBe upsertStep.inputSchema

      val selectStep = response.steps.collectFirst { case s: SelectAnalyzeStepResponse => s }
        .getOrElse(fail("expected a SelectAnalyzeStepResponse in the analyze response"))
      selectStep.inputSchema shouldBe upsertStep.inputSchema
    }
  }

  "PipelineService.analyzeProposal" should {
    "succeed (not 500) for a proposal containing an upsertsource step, treating it as schema pass-through" in {
      val owner  = newUser()
      val s      = newSource(owner)
      val target = newSource(owner)

      val proposal = PipelineProposal(
        pipelineName = "analyze-proposal-upsert",
        roots = Vector(PipelineProposalSource(
          sourceId = Some(s.value), `type` = None, name = None, csvConfig = None,
          restConfig = None, sqlConfig = None, staticConfig = None
        )),
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "upsertsource",
            JsObject(
              "target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(target.value)),
              "mode"   -> JsString("append")
            )
          ),
          CreatePipelineTransactionalStepRequest("s2", "select", JsObject("fields" -> JsArray(JsString("amount"))))
        )
      )

      val result = await(service.analyzeProposal(proposal, owner))
      result shouldBe a[Right[_, _]]
      val response = result.getOrElse(fail("expected Right"))

      val upsertStep = response.steps.collectFirst { case u: UpsertSourceAnalyzeStepResponse => u }
        .getOrElse(fail("expected an UpsertSourceAnalyzeStepResponse in the analyzeProposal response"))
      upsertStep.validationError shouldBe None
      upsertStep.outputSchema shouldBe upsertStep.inputSchema

      val selectStep = response.steps.collectFirst { case s: SelectAnalyzeStepResponse => s }
        .getOrElse(fail("expected a SelectAnalyzeStepResponse in the analyzeProposal response"))
      selectStep.inputSchema shouldBe upsertStep.inputSchema
    }
  }
}
