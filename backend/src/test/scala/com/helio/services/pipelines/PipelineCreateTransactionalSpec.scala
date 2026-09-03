package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.domain.engine.{InProcessPipelineEngine, SchemaField}
import com.helio.domain.model._
import com.helio.domain.steps.{RenameStep, SecondaryInput, UnionStep}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
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

    "reject (with nothing persisted) a join step whose secondaryInput dataSourceId references another owner's data source" in {
      val sourceId = newSource()
      val foreignId = newForeignSource()
      val req = CreatePipelineRequest(
        name               = "Cross-owner join rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "join",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(foreignId.value)), "joinKey" -> JsString("amount"), "joinType" -> JsString("inner"))
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

    "accept a join step whose secondaryInput dataSourceId references the caller's OWN data source" in {
      val sourceId = newSource()
      val ownSecondSource = newSource()
      val req = CreatePipelineRequest(
        name               = "Own-owner join success",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "join",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(ownSecondSource.value)), "joinKey" -> JsString("amount"), "joinType" -> JsString("inner"))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
    }

    // HEL-911 evaluation-1.md CR5b (cycle 2): the single-call transactional create path had
    // NO lane-reference validation at all -- `validateStepCrossOwnerRefs` only ever checked
    // `secondaryDataSourceId` (source-kind). A `lane`-kind `stepId` naming a nonexistent
    // clientId, or the referencing step's own ancestor, persisted silently.
    "reject (with nothing persisted) a union step whose lane secondaryInput names a clientId absent from this same request" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Dangling lane reference rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "union",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("does-not-exist")), "mode" -> JsString("byPosition"))
          )
        )
      )
      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Dangling lane reference rejection"
    }

    // HEL-911 skeptic-final-2.md (cycle 4): pins the FORWARD-lane-reference rejection --
    // design.md's cycle-3 change record documents `rewriteLaneClientId`'s `Left` arm as the
    // guard against this shape (a `lane` `stepId` naming a LATER clientId, not yet in
    // `clientIdMap` when `buildStepsAction`'s left-to-right fold reaches the referencing
    // step). Simplifying that `Left` arm back to `Right(typedConfig)` would silently
    // re-introduce the unresolved-clientId-persisted-verbatim bug this ticket already
    // shipped once (cycle 3) -- an untested rejection branch is exactly how that one
    // survived. Verified (change record) to fail RED against a temporarily simplified
    // `Right(typedConfig)` arm before being accepted.
    "reject (with nothing persisted) a union step whose lane secondaryInput names a LATER clientId in the same request (forward reference, not yet supported)" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Forward lane reference rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "rejoin", "union",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("laneB")), "mode" -> JsString("byPosition"))
          ),
          CreatePipelineTransactionalStepRequest("laneB", "rename", JsObject("renames" -> JsObject()))
        )
      )
      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      result.swap.toOption.get.message should include ("laneB")
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Forward lane reference rejection"
    }

    "reject (with nothing persisted) a union step whose lane secondaryInput names its own ancestor (a cycle)" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Cyclic lane reference rejection",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("s1", "rename", JsObject("renames" -> JsObject())),
          CreatePipelineTransactionalStepRequest(
            "s2", "union",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("s1")), "mode" -> JsString("byPosition")),
            parentStepId = Some("s1")
          )
        )
      )
      val result = await(service.create(req, owner))
      result shouldBe a[Left[_, _]]
      val summaries = await(pipelineRepo.listSummaries(owner, None))
      summaries.map(_.name) should not contain "Cyclic lane reference rejection"
    }

    // HEL-911 skeptic-final-1.md (cycle 3): the pre-fix version of this test asserted ONLY
    // that `create` returned `Right` -- which is exactly why it certified the actual defect
    // (`buildStepsAction` persisting the clientId "laneB" itself, verbatim, into
    // `secondaryInput.stepId`, instead of resolving it through `clientIdMap` to the real
    // `PipelineStepId`) as correct. A test asserting only that a call succeeded, never what
    // it produced, is not coverage -- this is the same species of gap CR1's `TreeWalkResult
    // .rows` corruption hid behind. Replaced with two INDEPENDENT assertions on persisted
    // state and behaviour, so neither can pass by conjunction while guarding the other:
    // (a) the persisted `secondaryInput.stepId` is a real step id, not the literal clientId;
    // (b) the created pipeline ACTUALLY RUNS (via the real engine, not merely returns 2xx).
    "accept a union step whose lane secondaryInput names a valid sibling clientId, persist the REAL step id (not the clientId), and the pipeline actually runs" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Valid lane reference accepted",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest("laneA", "rename", JsObject("renames" -> JsObject())),
          // laneB is distinguished from laneA by its OWN config (renames "amount" ->
          // "laneBMarker") so the persisted rows can be matched back to "laneB" specifically,
          // not merely "some rename step that isn't laneA".
          CreatePipelineTransactionalStepRequest("laneB", "rename", JsObject("renames" -> JsObject("amount" -> JsString("laneBMarker")))),
          CreatePipelineTransactionalStepRequest(
            "rejoin", "union",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("laneB")), "mode" -> JsString("byPosition")),
            parentStepId = Some("laneA")
          )
        )
      )
      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
      val pipelineId = PipelineId(result.getOrElse(fail("expected Right")).id)

      val steps  = await(pipelineStepRepo.listByPipelineInternal(pipelineId))
      val laneBStep = steps.collectFirst { case s: RenameStep if s.config.renames.contains("amount") => s }
        .getOrElse(fail("expected laneB (the rename step with the amount->laneBMarker marker)"))
      val rejoinStep = steps.find(_.kind == "union").getOrElse(fail("expected the rejoin union step")).asInstanceOf[UnionStep]

      // (a) persisted state: the stored secondaryInput.stepId is a REAL step id (matches
      // laneB's actual persisted id, identified above by its distinguishing config, not by
      // guessing), and is NOT the literal clientId "laneB" -- this leg is broken
      // independently of (b) below (a real id that happens to be wrong would still pass (b)
      // if it accidentally pointed at some other real, resolvable node; asserted exactly,
      // not just "is a UUID", to close that gap).
      rejoinStep.config.secondaryInput shouldBe SecondaryInput.Lane(laneBStep.id.value)
      rejoinStep.config.secondaryInput should not be SecondaryInput.Lane("laneB")

      // (b) behaviour: the persisted pipeline ACTUALLY RUNS through the real engine -- this
      // leg is broken independently of (a): a stub/mocked "it resolved to some real-looking
      // id" could still pass (a) while the graph is unrunnable for an unrelated reason: this
      // proves the specific `LaneReferenceError` this defect caused (secondaryInput.stepId ==
      // the clientId, unresolvable against the persisted graph's real ids) does NOT occur.
      val engine = new InProcessPipelineEngine(new LocalFileSystem(java.nio.file.Paths.get("/")))
      val sourceRows = Seq(Map("amount" -> 1.0, "label" -> "x"))
      val runResult = await(engine.executeTree(sourceRows, steps, pipelineStepRepo, dataSourceRepo))
      runResult.nodeOutcomes.keySet should contain(Some(rejoinStep.id.value))
    }

    // HEL-950 (evaluation-1.md CR1): validateStepCrossOwnerRefs -- the cross-owner pre-check
    // this transactional single-call path runs BEFORE buildStepsAction -- had an unconditional
    // join arm identical to the addStep/updateStep/patch-set defect this ticket closes
    // elsewhere. Reverting ITS guard alone left the whole suite green, because nothing here
    // asserted the empty-id case; this is that missing assertion. The empty value is the
    // frontend's defaultConfigFor("join") seed shape, reaching this path from agent/MCP and
    // patch-set callers -- NOT from the op picker, which excludes join entirely (HEL-958).
    // Mirrors the empty-default coverage already added to
    // PipelineStepRoutesSpec/PatchSetApplyServiceSpec.
    "accept a join step whose secondaryInput dataSourceId is empty without a spurious cross-owner rejection" in {
      val sourceId = newSource()
      val req = CreatePipelineRequest(
        name               = "Empty join right-source succeeds",
        sourceDataSourceId = sourceId.value,
        steps = Vector(
          CreatePipelineTransactionalStepRequest(
            "s1", "join",
            JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")), "joinKey" -> JsString(""), "joinType" -> JsString("inner"))
          )
        )
      )

      val result = await(service.create(req, owner))
      result shouldBe a[Right[_, _]]
    }
  }
}
