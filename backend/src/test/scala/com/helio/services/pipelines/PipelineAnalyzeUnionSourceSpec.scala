package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.services.ServiceError
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
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

/** HEL-1520: the persisted `analyze`, `capabilities?stepId=` (node reads), un-applied `analyzeProposal` and
 *  transactional-create paths must resolve a `source`-kind UNION secondary's inferred schema (previously
 *  join/lookup only), through the real `resolveSecondarySourceSchemas` prefetch against a real data source row.
 *
 *  Mutations (each reddens the named tests; all other tests here are unaffected by it):
 *   - M-ids  = remove `union` from `PipelineAnalyzeService.secondarySourceIdOf`: the prefetch set omits the
 *              source, so EVERY test here that expects a resolved secondary goes red (the map is empty).
 *   - M-proj = remove `union` from `PipelineAnalyzeService.sourceDependencyOf`: the prefetch still happens
 *              but `processNode` never consults the map, so the same tests go red. */
class PipelineAnalyzeUnionSourceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
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
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@example.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser, cols: Vector[(String, String)]): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "union-src", owner.id, now, now,
      inferredSchema = cols.map { case (n, t) => SchemaField(n, t) }
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  private def unionConfig(secId: String): JsObject = JsObject(
    "mode"           -> JsString("byName"),
    "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(secId))
  )

  private def createWithUnion(owner: AuthenticatedUser, leftCols: Vector[(String, String)], secCols: Vector[(String, String)]): (PipelineId, String) = {
    val left = newSource(owner, leftCols)
    val sec  = newSource(owner, secCols)
    val req  = CreatePipelineRequest(name = "union-src-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(left.value))))
    val pid  = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
    val step = await(service.addStep(pid, CreatePipelineStepRequest(`type` = "union", config = unionConfig(sec.value)), owner))
    (pid, step.getOrElse(fail(s"expected Right, got $step")).id)
  }

  private def unionOf(r: PipelineAnalyzeResponse): UnionAnalyzeStepResponse =
    r.steps.collectFirst { case u: UnionAnalyzeStepResponse => u }.getOrElse(fail("expected a union step"))

  "PipelineService.analyze" should {
    "project a source-kind union's secondary-only fields after the parent's" in {
      val owner = newUser()
      val (pid, _) = createWithUnion(owner, Vector("id" -> "string"), Vector("id" -> "string", "extra" -> "float"))
      val union = unionOf(await(service.analyze(pid, owner)).getOrElse(fail("expected Right")))
      union.validationError shouldBe None
      union.outputSchema.map(_.name) shouldBe Vector("id", "extra")
    }

    "report the timestamp/numeric collision as a step validationError" in {
      val owner = newUser()
      val (pid, _) = createWithUnion(owner, Vector("ts" -> "timestamp"), Vector("ts" -> "integer"))
      val resp  = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      val union = unionOf(resp)
      union.validationError.getOrElse(fail("expected a validationError")) should (include("ts") and include("timestamp") and include("integer"))
      resp.costVerdict.canRun shouldBe false
      resp.costVerdict.reasons.map(_.code) should contain("step-config-invalid")
    }

    "keep the passthrough when the source has no inferred schema (no error)" in {
      val owner = newUser()
      val (pid, _) = createWithUnion(owner, Vector("id" -> "string"), Vector.empty)
      val union = unionOf(await(service.analyze(pid, owner)).getOrElse(fail("expected Right")))
      union.validationError shouldBe None
      union.outputSchema.map(_.name) shouldBe Vector("id")
    }
  }

  "PipelineService.capabilitiesAtNode" should {
    "list the source-only column for a step BELOW a source-kind union" in {
      val owner = newUser()
      val (pid, _) = createWithUnion(owner, Vector("id" -> "string"), Vector("id" -> "string", "extra" -> "float"))
      val unionId  = unionOf(await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))).id
      val child = await(service.addStep(
        pid,
        CreatePipelineStepRequest(`type` = "select", config = JsObject("fields" -> JsArray(JsString("id"), JsString("extra"))), parentStepId = Some(unionId)),
        owner
      )).getOrElse(fail("expected Right"))
      val caps = await(service.capabilitiesAtNode(pid, Some(PipelineStepId(child.id)), owner)).getOrElse(fail("expected Right"))
      caps.columns.map(_.name) shouldBe Vector("id", "extra")
    }
  }

  "PipelineService.analyzeProposal" should {
    "project the secondary-only fields for a caller-owned source and NOT read another tenant's source" in {
      val owner    = newUser()
      val stranger = newUser()
      val left     = newSource(owner, Vector("id" -> "string"))
      val own      = newSource(owner, Vector("id" -> "string", "extra" -> "float"))
      val foreign  = newSource(stranger, Vector("id" -> "string", "secret" -> "string"))
      def names(sec: DataSourceId): Vector[String] =
        unionStep(await(service.analyzeProposal(proposal(left, sec), owner)).getOrElse(fail("expected Right")).steps).outputSchema.map(_.name)
      names(own) shouldBe Vector("id", "extra")
      names(foreign) shouldBe Vector("id")
    }
  }

  "PipelineService.create (transactional path)" should {
    def create(owner: AuthenticatedUser, secCols: Vector[(String, String)], mappedColumn: String) = {
      val left = newSource(owner, Vector("id" -> "string"))
      val sec  = newSource(owner, secCols)
      val out  = CreatePipelineTransactionalOutputRequest(
        Some("u"), "metric", "o", config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString(mappedColumn))))
      )
      await(service.create(
        CreatePipelineRequest(
          "wide", Vector(CreatePipelineRootRequest(sourceId = Some(left.value))),
          steps = Vector(CreatePipelineTransactionalStepRequest("u", "union", unionConfig(sec.value))),
          outputs = Vector(out)
        ), owner))
    }

    // WIDENING (design.md): red on base (a 400 naming the column), green after. Red under M-ids / M-proj.
    "ACCEPT an Output mapping a column only the source carries, at a source-kind union" in {
      create(newUser(), Vector("id" -> "string", "extra" -> "float"), "extra") shouldBe a[Right[_, _]]
    }

    "still REJECT a mapped column that neither input carries (guard: the widening is not a bypass)" in {
      create(newUser(), Vector("id" -> "string", "extra" -> "float"), "in_neither") match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("in_neither")
        case other                              => fail(s"expected 400, got $other")
      }
    }
  }

  private def unionStep(steps: Vector[AnalyzeStepResponse]): UnionAnalyzeStepResponse =
    steps.collectFirst { case u: UnionAnalyzeStepResponse => u }.getOrElse(fail("expected a union step"))

  private def proposal(left: DataSourceId, sec: DataSourceId): PipelineProposal =
    PipelineProposal(
      pipelineName = "union-src-proposal",
      roots = Vector(PipelineProposalSource(
        sourceId = Some(left.value), `type` = None, name = None, csvConfig = None,
        restConfig = None, sqlConfig = None, staticConfig = None
      )),
      steps = Vector(CreatePipelineTransactionalStepRequest("u1", "union", unionConfig(sec.value)))
    )
}
