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
import spray.json.{JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1105 task 2.4/4.5 (design.md D6, mirrors `PipelineAnalyzeUpsertSourceSpec`'s own
 *  precedent): `GET /pipelines/:id/analyze` must succeed (not 500) for a persisted pipeline
 *  containing a `convertformat` step -- reproduces the same
 *  `PipelineService.toAnalyzeStepResponse`/`PipelineStepRepository.rowToDomain`
 *  "codec returned unexpected config type" class of bug `upsertsource`'s own ticket closed. */
class PipelineAnalyzeConvertFormatSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
      DataSourceId(UUID.randomUUID().toString), "analyze-cf-src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("content", "string-body"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  "PipelineService.analyze" should {
    "succeed (not 500) for a persisted pipeline containing a convertformat step, and reports it in the analyze response" in {
      val owner = newUser()
      val s     = newSource(owner)
      val req   = CreatePipelineRequest(name = "analyze-cf-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(s.value))))
      val pid   = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)

      val cfReq = CreatePipelineStepRequest(
        `type` = "convertformat",
        config = JsObject("field" -> JsString("content"), "from" -> JsString("csv"), "to" -> JsString("json"))
      )
      await(service.addStep(pid, cfReq, owner)) shouldBe a[Right[_, _]]

      val result = await(service.analyze(pid, owner))
      result shouldBe a[Right[_, _]]
      val response = result.getOrElse(fail("expected Right"))

      val cfStep = response.steps.collectFirst { case c: ConvertFormatAnalyzeStepResponse => c }
        .getOrElse(fail("expected a ConvertFormatAnalyzeStepResponse in the analyze response"))
      cfStep.validationError shouldBe None
      cfStep.outputSchema shouldBe cfStep.inputSchema

      // skeptic-final-1.md non-blocking note 2 (promoted to required, cycle 2): proves the
      // persisted-row analyze path AND the HEL-1092 cost classification together in one test --
      // `PipelineCostEstimatorSpec` proves the classification logic in isolation and
      // `PipelineService.analyze`'s cost-input wiring was independently read, but no single test
      // proved both facts end-to-end against a REAL persisted pipeline before this.
      response.costVerdict.autoRunnable shouldBe false
      val cfReason = response.costVerdict.reasons.find(_.code == "content-conversion")
        .getOrElse(fail(s"expected a content-conversion cost reason, got: ${response.costVerdict.reasons}"))
      cfReason.stepId shouldBe Some(cfStep.id)
    }
  }
}
