package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalStepRequest, UpdatePipelineStepRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1480: service-level assertions for three branches HEL-1463's mutation runs found unasserted
 *  anywhere (the fourth gap, the analyze-proposal static-without-config 400, is at the route in
 *  `PipelineAnalyzeProposalRoutesSpec`; the route-level blank-name 400 is in `PipelineAclSpec`).
 *  Each test was shown RED under a one-line mutation of exactly the branch it guards (see the
 *  change's `mutation-evidence.md`). */
class PipelineServiceCoverageGapsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var stepRepo: PipelineStepRepository     = _
  private var service: PipelineService             = _

  private val owner    = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val outsider = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    stepRepo       = new PipelineStepRepository(ctx)
    service        = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = new OutputRepository(ctx))
    Seq(owner, outsider).foreach { u =>
      val id = u.id.value
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    }
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def ownedPipelineCount(): Int = {
    import PostgresProfile.api._
    val id = owner.id.value
    await(db.run(sql"SELECT count(*) FROM pipelines WHERE owner_id = $id::uuid".as[Int])).head
  }

  private def newSource(): DataSourceId = {
    val now = Instant.now()
    val source = DatasetSource(
      DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"), SchemaField("label", "string"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  /** A pipeline owned by `owner` with one trunk `select` step; returns the pipeline id and the step. */
  private def pipelineWithStep(): (PipelineId, PipelineStep) = {
    val req = CreatePipelineRequest(
      name  = "gap-pipeline",
      roots = Vector(CreatePipelineRootRequest(Some(newSource().value))),
      steps = Vector(CreatePipelineTransactionalStepRequest("s1", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject))
    )
    val pid = PipelineId(await(service.create(req, owner)).toOption.get.id)
    (pid, await(stepRepo.listByPipelineInternal(pid)).head)
  }

  /** A real `PipelineService` over the same database whose step repository reports "no row came back"
   *  from every `updateInternal`, deterministically reaching the update-returned-None arms. */
  private def serviceWhoseUpdateReturnsNone(): PipelineService = {
    val ctx = new DbContext(db, db)
    val noRowAfterUpdate = new PipelineStepRepository(ctx) {
      override def updateInternal(
          id: PipelineStepId, config: Option[Any], position: Option[Int], enabled: Option[Boolean], actingUserId: String
      ): Future[Option[PipelineStep]] = Future.successful(None)
    }
    new PipelineService(pipelineRepo, noRowAfterUpdate, dataSourceRepo, outputRepo = new OutputRepository(ctx))
  }

  "PipelineService.create" should {
    "reject a blank name with BadRequest 'name is required' and write no pipeline row" in {
      val before = ownedPipelineCount()
      val req = CreatePipelineRequest(name = "   ", roots = Vector(CreatePipelineRootRequest(Some(newSource().value))))
      await(service.create(req, owner)) shouldBe Left(ServiceError.BadRequest("name is required"))
      ownedPipelineCount() shouldBe before
    }
  }

  "PipelineService.laneTree" should {
    "return NotFound for an unknown pipeline id" in {
      val missing = PipelineId(UUID.randomUUID().toString)
      await(service.laneTree(missing, owner)) shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${missing.value}"))
    }

    "return the same NotFound for a real pipeline owned by someone else with no grant" in {
      val (pid, _) = pipelineWithStep()
      await(service.laneTree(pid, outsider)) shouldBe Left(ServiceError.NotFound(s"Pipeline not found: ${pid.value}"))
      await(service.laneTree(pid, owner)).isRight shouldBe true
    }
  }

  "PipelineService.updateStep when the update returns no row" should {
    "return NotFound on the no-config branch" in {
      val (_, step) = pipelineWithStep()
      val result = await(serviceWhoseUpdateReturnsNone().updateStep(step.id, UpdatePipelineStepRequest(None, None, None, Some(false)), owner))
      result shouldBe Left(ServiceError.NotFound(s"Pipeline step not found: ${step.id.value}"))
    }

    "return NotFound on the config branch" in {
      val (_, step) = pipelineWithStep()
      val cfg       = JsObject("fields" -> Vector("label").toJson)
      val result    = await(serviceWhoseUpdateReturnsNone().updateStep(step.id, UpdatePipelineStepRequest(None, Some(cfg), None), owner))
      result shouldBe Left(ServiceError.NotFound(s"Pipeline step not found: ${step.id.value}"))
    }
  }
}
