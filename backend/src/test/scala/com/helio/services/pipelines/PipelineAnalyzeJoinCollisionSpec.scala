package com.helio.services.pipelines

import com.helio.api.protocols.pipelines._
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
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

/** HEL-1236: the persisted `analyze` route, the un-applied `analyzeProposal` route and the
 *  node-capabilities path must project a `source`-kind join's colliding right column as
 *  `right_<name>` (the secondary source's inferred schema is pre-resolved by
 *  `PipelineServiceSupport.resolveSecondarySourceSchemas`). Unreachable-source behaviour is the
 *  documented left-schema passthrough, and an un-applied proposal can never read another
 *  tenant's source schema.
 *
 *  (Template: HEL-1100 skeptic-final-1.md CR1: `GET /pipelines/:id/analyze` and `POST
 *  /pipelines/analyze-proposal` must both succeed (not 500) for a pipeline/proposal containing a
 *  registered `upsertsource` step -- reproduces and closes the real
 *  `PipelineServiceSupport.toAnalyzeStepResponse` `IllegalStateException` found live against the running
 *  app (`codec returned unexpected config type ... for op 'upsertsource'`).) */
class PipelineAnalyzeJoinCollisionSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser, cols: Vector[String]): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "join-src", owner.id, now, now,
      inferredSchema = cols.map(SchemaField(_, "string"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  private def joinConfig(rightId: String): JsObject = JsObject(
    "joinKey"        -> JsString("id"),
    "joinType"       -> JsString("inner"),
    "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(rightId))
  )

  "PipelineService.analyze" should {
    "project a source-kind join's colliding right column as right_<name>" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id", "cnt"))
      val right = newSource(owner, Vector("id", "cnt", "extra"))
      val req = CreatePipelineRequest(name = "join-collision-pipe", roots = Vector(CreatePipelineRootRequest(sourceId = Some(left.value))))
      val pid = PipelineId(await(service.create(req, owner)).getOrElse(fail("expected Right")).id)
      await(service.addStep(pid, CreatePipelineStepRequest(`type` = "join", config = joinConfig(right.value)), owner)) shouldBe a[Right[_, _]]

      val response = await(service.analyze(pid, owner)).getOrElse(fail("expected Right"))
      val join = response.steps.collectFirst { case j: JoinAnalyzeStepResponse => j }.getOrElse(fail("expected a join step"))
      join.validationError shouldBe None
      join.outputSchema.map(_.name) shouldBe Vector("id", "cnt", "right_cnt", "extra")
    }
  }

  "PipelineService.analyzeProposal" should {
    "project the renamed column for a caller-owned secondary source" in {
      val owner = newUser()
      val left  = newSource(owner, Vector("id", "cnt"))
      val right = newSource(owner, Vector("id", "cnt"))
      val response = await(service.analyzeProposal(proposalWithJoin(left, right), owner)).getOrElse(fail("expected Right"))
      val join = response.steps.collectFirst { case j: JoinAnalyzeStepResponse => j }.getOrElse(fail("expected a join step"))
      join.outputSchema.map(_.name) shouldBe Vector("id", "cnt", "right_cnt")
    }

    "NOT read another tenant's source schema (falls back to the left-schema passthrough)" in {
      val owner    = newUser()
      val stranger = newUser()
      val left     = newSource(owner, Vector("id", "cnt"))
      val foreign  = newSource(stranger, Vector("id", "cnt", "secret_column"))
      val response = await(service.analyzeProposal(proposalWithJoin(left, foreign), owner)).getOrElse(fail("expected Right"))
      val join = response.steps.collectFirst { case j: JoinAnalyzeStepResponse => j }.getOrElse(fail("expected a join step"))
      join.outputSchema.map(_.name) shouldBe Vector("id", "cnt")
    }
  }

  private def proposalWithJoin(left: DataSourceId, right: DataSourceId): PipelineProposal =
    PipelineProposal(
      pipelineName = "join-collision-proposal",
      roots = Vector(PipelineProposalSource(
        sourceId = Some(left.value), `type` = None, name = None, csvConfig = None,
        restConfig = None, sqlConfig = None, staticConfig = None
      )),
      steps = Vector(CreatePipelineTransactionalStepRequest("j1", "join", joinConfig(right.value)))
    )
}
