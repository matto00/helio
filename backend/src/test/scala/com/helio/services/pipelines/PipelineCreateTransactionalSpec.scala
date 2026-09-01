package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
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

/** HEL-906 (P1.3, task 3.1) — the single-call transactional `POST /api/pipelines` shape:
 *  `steps[]` (with `parentStepId` resolved by request-scoped `clientId`) and `outputs[]`
 *  (with `nodeStepClientId` resolved the same way), built inside ONE database transaction with
 *  the pipeline row itself (cycle 5, coordinator ruling D3 -- a REAL `.transactionally` DBIO
 *  chain via `PipelineRepository.runTransactionally`, not the compensating-delete rollback an
 *  earlier cycle used before the ruling required deleting that pattern outright). The two
 *  rollback tests below were verified failable by mutation during cycle-5 development: splitting
 *  `PipelineService.createTransactional`'s single composed `DBIO` into two separate
 *  `runTransactionally` calls (so the pipeline row insert commits in its OWN transaction before
 *  the step/Output build runs in a second one) makes "roll back the whole call... when a step has
 *  an invalid type" fail with the pipeline row still present -- confirming these tests actually
 *  exercise the transaction boundary, not just the service's Either-return-value plumbing. The
 *  mutation was reverted before this cycle's commit (see execution-progress.md for the full
 *  before/after transcript). */
class PipelineCreateTransactionalSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var outputRepo: OutputRepository             = _
  private var service: PipelineService                 = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    service          = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)

    seedUser()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"""))
  }

  private def newSource(): DataSourceId = {
    val now = Instant.now()
    val source = StaticSource(
      DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"), SchemaField("label", "string"))
    )
    await(dataSourceRepo.insert(source, owner)).id
  }

  "PipelineService.create (single-call transactional shape)" should {

    "build a source-referencing pipeline with a trunk step, a tail step (parentStepId), and two Outputs in one call" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Full pipeline",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("trunk-1", "select", JsObject("fields" -> Vector("amount", "label").toJson).asJsObject),
          CreatePipelineTransactionalStepRequest("tail-1", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject, parentStepId = Some("trunk-1"))
        ),
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = None, kind = "table", name = "Source Output"),
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("tail-1"), kind = "metric", name = "Tail Metric",
            config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("amount")))))
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
      val pipelineId = PipelineId(result.getOrElse(fail("expected Right")).id)

      val steps = await(pipelineStepRepo.listByPipelineInternal(pipelineId))
      steps should have size 2
      val trunkStep = steps.find(_.parentStepId.isEmpty).getOrElse(fail("expected a root/trunk step"))
      val tailStep  = steps.find(_.parentStepId.contains(trunkStep.id)).getOrElse(fail("expected tail-1 parented under trunk-1"))

      val outputs = await(outputRepo.listByPipelineInternal(pipelineId))
      outputs.map(_.name) should contain theSameElementsAs Vector("Source Output", "Tail Metric")
      outputs.find(_.name == "Tail Metric").get.node.stepId shouldBe Some(tailStep.id)
      outputs.find(_.name == "Source Output").get.node.stepId shouldBe None
    }

    "roll back the whole call (pipeline gone, nothing persisted) when a step has an invalid type" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Rollback on bad step",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("s1", "not-a-real-step-kind", JsObject.empty)
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]

      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Rollback on bad step"

      import PostgresProfile.api._
      val rawCount = await(db.run(sql"select count(*) from pipelines where name = 'Rollback on bad step'".as[Int].head))
      rawCount shouldBe 0
    }

    "roll back the whole call (pipeline AND the already-created step gone) when an Output has a bad fieldMapping slot" in {
      val sourceId = newSource()
      // Give the pipeline a unique tag so we can find the row it created (if any survived the
      // rollback) directly by tag, rather than relying only on the name not appearing in the
      // owner's summary list.
      val tag = s"rollback-probe-${UUID.randomUUID()}"
      val req = CreatePipelineRequest(
        name               = "Rollback on bad output",
        sourceDataSourceId = sourceId.value,
        tag                = Some(tag),
        steps = Vector(
          CreatePipelineTransactionalStepRequest("s1", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject)
        ),
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("s1"), kind = "metric", name = "Bad Output",
            config = Some(JsObject("fieldMapping" -> JsObject("bogusSlot" -> JsString("amount")))))
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]

      val summaries = await(pipelineRepo.listSummaries(owner, Some(tag)))
      summaries shouldBe empty
    }

    "reject (with nothing persisted) a step whose parentStepId references a clientId not present earlier in the request" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Bad parent reference",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("s1", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject, parentStepId = Some("does-not-exist"))
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Bad parent reference"
    }

    "the pre-existing simple create shape (no steps/outputs) is unaffected" in {
      val sourceId = newSource()
      val result = await(service.create(CreatePipelineRequest("Simple", sourceId.value), owner))
      result shouldBe a[Right[_, _]]
    }
  }
}
