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

  // HEL-907 evaluator-final-2 non-blocking note 2: `validateStepCrossOwnerRefs`
  // (PipelineService.scala) is create_pipeline's own version of the sibling addStep
  // path's cross-owner join/union/lookup ACL check (PipelineStepRoutesSpec.scala's six
  // POST/PATCH tests) -- until now it had ZERO direct test coverage of its own, despite
  // being the exact same security-relevant class of check (an unauthorized secondary
  // data-source reference smuggled into a join/union/lookup step's config).
  private val otherOwnerId = UUID.randomUUID().toString
  private val otherOwner   = AuthenticatedUser(UserId(otherOwnerId))

  private def newForeignSource(): DataSourceId = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherOwnerId::uuid, ${s"other-$otherOwnerId@helio.test"}, now())"""))
    val now = Instant.now()
    val source = StaticSource(
      DataSourceId(UUID.randomUUID().toString), "foreign-src", otherOwner.id, now, now,
      inferredSchema = Vector(SchemaField("amount", "float"))
    )
    await(dataSourceRepo.insert(source, otherOwner)).id
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

    // ── HEL-907 task 1.4/5.4: per-node fieldMapping grounding ──────────────
    //
    // `newSource()`'s inferredSchema is {amount: float, label: string}. A `select` step that
    // keeps only `amount` PROJECTS a narrower schema at its own node -- `label` is a VALID slot
    // name (OutputBindingSpec accepts `label` for `metric`) but does NOT exist as a column past
    // that select, so grounding must reject it there even though the identical mapping would be
    // accepted at the trunk/source (proving "the tail's own projected schema, not the trunk's").

    "reject an Output on a tail whose fieldMapping references a column the tail's own select step already dropped" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Tail grounding rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("narrow", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject)
        ),
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(
            nodeStepClientId = Some("narrow"), kind = "metric", name = "Bad tail mapping",
            config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("amount"), "label" -> JsString("label"))))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.message should include("label")

      // Nothing persisted -- the whole transactional call rolled back, same contract the
      // pre-existing "bad fieldMapping slot" test above already asserts for the sibling defect.
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Tail grounding rejection"
    }

    "accept the IDENTICAL fieldMapping on an Output attached to the raw source (nodeStepClientId absent), where the column still exists" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Source-attached grounding success",
        sourceDataSourceId = sourceId.value,
        // Same narrowing step present in the request (proving the trunk step's own narrower
        // schema is NOT what a source-attached Output is grounded against) -- but the Output
        // below has no nodeStepClientId, so it must be grounded against the SOURCE's own
        // inferredSchema (both `amount` and `label`) instead, per `analyzeNodes` omitting the
        // source from its per-node map (design.md decision 5).
        steps = Vector(
          CreatePipelineTransactionalStepRequest("narrow", "select", JsObject("fields" -> Vector("amount").toJson).asJsObject)
        ),
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(
            nodeStepClientId = None, kind = "metric", name = "Source-attached mapping",
            config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("amount"), "label" -> JsString("label"))))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
      val pipelineId = PipelineId(result.getOrElse(fail("expected Right")).id)
      val outputs = await(outputRepo.listByPipelineInternal(pipelineId))
      outputs.map(_.name) should contain("Source-attached mapping")
    }

    "reject a source-attached Output (nodeStepClientId absent) whose fieldMapping references a column absent from the source's own inferredSchema" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Source-attached grounding rejection",
        sourceDataSourceId = sourceId.value,
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(
            nodeStepClientId = None, kind = "metric", name = "Bad source mapping",
            config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("does_not_exist"))))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.message should include("does_not_exist")
    }

    "reject (with nothing persisted) a join step whose rightDataSourceId references another owner's data source" in {
      val sourceId = newSource()
      val foreignId = newForeignSource()
      val req = CreatePipelineRequest(
        name               = "Cross-owner join rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "join",
            JsObject("rightDataSourceId" -> JsString(foreignId.value), "joinKey" -> JsString("amount"), "joinType" -> JsString("inner"))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Cross-owner join rejection"

      import PostgresProfile.api._
      val rawCount = await(db.run(sql"select count(*) from pipelines where name = 'Cross-owner join rejection'".as[Int].head))
      rawCount shouldBe 0
    }

    "accept a join step whose rightDataSourceId references the caller's OWN data source" in {
      val sourceId = newSource()
      val ownSecondSource = newSource()
      val req = CreatePipelineRequest(
        name               = "Own-owner join success",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "join",
            JsObject("rightDataSourceId" -> JsString(ownSecondSource.value), "joinKey" -> JsString("amount"), "joinType" -> JsString("inner"))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
    }
  }
}
