package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
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
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1235: the persisted `analyze`, `analyzeConcise` and un-applied `analyzeProposal` services
 *  each surface the schema-only warnings, the full/proposal wire shape always carries a
 *  `warnings` array, and a warning NEVER blocks (D6 guards (a), (b), (d); guard (c) is the
 *  unmodified HEL-1279 auto-run specs).
 *
 *  GUARD NOTE: the "never blocks" cases are guards, not red-first proofs. Each was shown failable
 *  by a temporary mutation that routes a warning into the blocking path (see the change's
 *  verification notes), then reverted. */
class PipelineAnalyzeSchemaWarningsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with JsonProtocols {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var service: PipelineService                 = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    service = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx), dataSourceRepo,
      outputRepo = new OutputRepository(ctx), pipelineRootRepo = new PipelineRootRepository(ctx)
    )
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import slick.jdbc.PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser, cols: Vector[(String, String)]): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now,
      inferredSchema = cols.map { case (n, t) => SchemaField(n, t) }
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  private def joinConfig(rightId: String): JsObject = JsObject(
    "joinKey"        -> JsString("id"),
    "joinType"       -> JsString("inner"),
    "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(rightId))
  )

  private val countMissing: JsObject = """{"groupBy":[],"aggregations":[{"alias":"n","fn":"count","field":"amount"}]}""".parseJson.asJsObject

  private def createPipeline(owner: AuthenticatedUser, left: DataSourceId): PipelineId =
    PipelineId(await(service.create(CreatePipelineRequest(name = "warn-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(left.value)))), owner)).getOrElse(fail("expected Right")).id)

  /** left (id: string, total) JOIN right (id: integer, total) -- all three shapes in one pipeline. */
  private def pipelineWithAllShapes(owner: AuthenticatedUser): (PipelineId, Vector[(String, JsObject)]) = {
    val left  = newSource(owner, Vector("id" -> "string", "total" -> "float"))
    val right = newSource(owner, Vector("id" -> "integer", "total" -> "float"))
    val pid   = createPipeline(owner, left)
    val steps = Vector("join" -> joinConfig(right.value), "aggregate" -> countMissing)
    steps.foreach { case (op, cfg) =>
      await(service.addStep(pid, CreatePipelineStepRequest(`type` = op, config = cfg), owner)) shouldBe a[Right[_, _]]
    }
    (pid, steps)
  }

  "PipelineService.analyze" should {

    "surface all three warning classes on the persisted route" in {
      val owner = newUser()
      val (pid, _) = pipelineWithAllShapes(owner)
      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      response.warnings.map(_.code).sorted shouldBe Vector("field-not-in-input-schema", "join-column-renamed", "join-key-type-mismatch")
      val stepIdByType = response.steps.map(s => s.`type` -> s.id).toMap
      response.warnings.find(_.code == "field-not-in-input-schema").map(_.stepId) shouldBe stepIdByType.get("aggregate")
      response.warnings.find(_.code == "join-key-type-mismatch").map(_.stepId) shouldBe stepIdByType.get("join")
      response.warnings.find(_.code == "field-not-in-input-schema").map(_.message).getOrElse("") should include("not found in this step's inferred input schema")
    }

    "GUARD (D6a): a warned pipeline stays runnable with no warning-derived reason or validationError" in {
      val owner = newUser()
      val (pid, _) = pipelineWithAllShapes(owner)
      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      response.warnings should not be empty
      response.steps.foreach(_.validationError shouldBe None)
      response.costVerdict.canRun shouldBe true
      response.costVerdict.reasons.map(_.code) should not contain PipelineAnalyzeService.StepConfigInvalidCode
    }

    "GUARD (D6b/d): the warned configs are accepted by the auto-run gate's config check and by a step update" in {
      val owner = newUser()
      val (pid, steps) = pipelineWithAllShapes(owner)
      steps.foreach { case (op, cfg) => PipelineAnalyzeService.stepConfigProblem(op, cfg.compactPrint) shouldBe None }
      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      val aggStepId = response.steps.find(_.`type` == "aggregate").map(_.id).getOrElse(fail("no aggregate"))
      await(service.updateStep(PipelineStepId(aggStepId), UpdatePipelineStepRequest(`type` = None, config = Some(countMissing), position = None), owner)) shouldBe a[Right[_, _]]
    }

    "always send a warnings array on the wire, empty for a clean pipeline" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id" -> "string", "amount" -> "float"))
      val pid   = createPipeline(owner, left)
      await(service.addStep(pid, CreatePipelineStepRequest(`type` = "select", config = """{"fields":["id"]}""".parseJson.asJsObject), owner)) shouldBe a[Right[_, _]]
      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      response.warnings shouldBe empty
      response.toJson.asJsObject.fields("warnings") shouldBe JsArray()
    }
  }

  "PipelineService.analyzeConcise" should {
    "carry per-node warning messages, omitting the key on nodes without warnings" in {
      val owner = newUser()
      val (pid, _) = pipelineWithAllShapes(owner)
      val concise = await(service.analyzeConcise(pid, owner)).getOrElse(fail("expected Right"))
      val byOp = concise.nodes.map(n => n.op -> n).toMap
      byOp("aggregate").warnings.getOrElse(Vector.empty).exists(_.contains("'amount'")) shouldBe true
      byOp("join").warnings.getOrElse(Vector.empty) should have size 2
      val json = concise.toJson.asJsObject.fields("nodes").asInstanceOf[JsArray].elements.map(_.asJsObject)
      json.exists(_.fields.contains("warnings")) shouldBe true
    }

    "omit warnings on a clean node" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id" -> "string"))
      val pid   = createPipeline(owner, left)
      await(service.addStep(pid, CreatePipelineStepRequest(`type` = "select", config = """{"fields":["id"]}""".parseJson.asJsObject), owner)) shouldBe a[Right[_, _]]
      val concise = await(service.analyzeConcise(pid, owner)).getOrElse(fail("expected Right"))
      concise.nodes.foreach(_.warnings shouldBe None)
      concise.toJson.compactPrint should not include "warnings"
    }
  }

  "PipelineService.analyzeProposal" should {
    def proposal(left: DataSourceId, right: DataSourceId): PipelineProposal = PipelineProposal(
      pipelineName = "warn-proposal",
      roots = Vector(PipelineProposalSource(sourceId = Some(left.value), `type` = None, name = None, csvConfig = None, restConfig = None, sqlConfig = None, staticConfig = None)),
      steps = Vector(
        CreatePipelineTransactionalStepRequest("j1", "join", joinConfig(right.value)),
        CreatePipelineTransactionalStepRequest("a1", "aggregate", countMissing, parentStepId = Some("j1"))
      )
    )

    "surface the warnings keyed by the proposal's client step ids" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id" -> "string", "total" -> "float"))
      val right = newSource(owner, Vector("id" -> "integer", "total" -> "float"))
      val response = await(service.analyzeProposal(proposal(left, right), owner)).getOrElse(fail("expected Right"))
      response.warnings.map(w => w.stepId -> w.code).sorted shouldBe Vector(
        "a1" -> "field-not-in-input-schema", "j1" -> "join-column-renamed", "j1" -> "join-key-type-mismatch"
      )
      response.steps.foreach(_.validationError shouldBe None)
      response.toJson.asJsObject.fields.contains("warnings") shouldBe true
    }

    "send an empty warnings array for a clean proposal" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id" -> "string"))
      val right = newSource(owner, Vector("id" -> "string", "extra" -> "string"))
      val clean = proposal(left, right).copy(steps = Vector(CreatePipelineTransactionalStepRequest("j1", "join", joinConfig(right.value))))
      val response = await(service.analyzeProposal(clean, owner)).getOrElse(fail("expected Right"))
      response.warnings shouldBe empty
      response.toJson.asJsObject.fields("warnings") shouldBe JsArray()
    }
  }
}
