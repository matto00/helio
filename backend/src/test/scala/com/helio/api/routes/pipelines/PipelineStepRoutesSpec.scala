package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineStepId, UserId}
import com.helio.domain.{CastConfig, StepConfigTypeMismatch}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.api._
import com.helio.api.protocols.pipelines.{CastStepResponse, ComputeStepResponse, DeletePipelineStepResponse, JoinStepResponse, LookupStepResponse, PipelineStepResponse, RenameStepResponse, SelectStepResponse, UnionStepResponse}
import com.helio.api.routes.pipelines.PipelineStepRoutes
import com.helio.services.pipelines.PipelineService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import spray.json._
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import com.helio.domain.steps.SecondaryInput

class PipelineStepRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var stepRepo: PipelineStepRepository   = _
  private var pipelineRepo: PipelineRepository   = _
  private var dataSourceRepo: DataSourceRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(typedSystem.executionContext)
    dataSourceRepo = new DataSourceRepository(ctx)(typedSystem.executionContext)
    stepRepo     = new PipelineStepRepository(ctx)(typedSystem.executionContext)
    pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(typedSystem.executionContext)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanSteps(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_steps"))
  }

  private def seedPipeline(): String = {
    import PostgresProfile.api._
    val pid  = UUID.randomUUID().toString
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",

      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'p', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  // HEL-913 task 7.3b: appends a second root to an already-seeded pipeline (`seedPipeline`
  // always creates exactly root 0). Raw SQL against the shared superuser connection, matching
  // this file's existing fixture convention.
  private def addSecondRoot(pipelineId: String): String = {
    import PostgresProfile.api._
    val rootId = UUID.randomUUID().toString
    val dsId   = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at) VALUES ($dsId, 'ds2', 'rest_api', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rootId, $pipelineId, $dsId, 1)"""
    )))
    rootId
  }

  // HEL-904 cycle-9: `addStep` with no `position` now extends the trunk
  // (splices as the current trunk-last step's sole child) rather than
  // creating a flat root sibling, so fixtures that need genuine flat ROOT
  // siblings (to test sibling-scoped splice/reorder behavior, which the
  // fixed `addStep` path no longer produces) seed directly via SQL, same
  // idiom as the pre-existing sibling-group reorder test below.
  private def seedRootStep(pid: String, op: String, configJson: String, position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, $pid, $position, $op, $configJson::text, true, now(), now(), NULL, $pid)"""
    ))
    id
  }

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val viewerUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000002"))

  private def routes: Route = routesFor(dummyUser)

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = typedSystem.executionContext
    val service = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo)
    new PipelineStepRoutes(service, user).routes
  }

  // -- HEL-407 fixture: grant `viewerUser` a viewer-only role on `pipelineId` --
  private def grantViewer(pipelineId: String): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${viewerUser.id.value}::uuid, 'viewer@test.local', now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('pipeline', $pipelineId, ${viewerUser.id.value}::uuid, 'viewer', now())"""
    )))
  }

  // ── Request body helpers (CS2c-3a discriminated-union shape) ─────────────
  private def renameReq(): JsObject = JsObject("type" -> JsString("rename"), "config" -> JsObject("renames" -> JsObject()))
  private def filterReq(): JsObject = JsObject(
    "type" -> JsString("filter"),
    "config" -> JsObject("combinator" -> JsString("AND"), "conditions" -> JsArray())
  )
  private def castReq(): JsObject = JsObject("type" -> JsString("cast"), "config" -> JsObject("casts" -> JsObject()))
  private def selectReq(fields: Vector[String] = Vector.empty): JsObject =
    JsObject("type" -> JsString("select"), "config" -> JsObject("fields" -> JsArray(fields.map(JsString(_)))))
  private def joinReq(rightDsId: String): JsObject = JsObject(
    "type" -> JsString("join"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(rightDsId)),
      "joinKey"           -> JsString("id"),
      "joinType"          -> JsString("inner")
    )
  )
  private def unionReq(otherDsId: String): JsObject = JsObject(
    "type" -> JsString("union"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherDsId)),
      "mode"              -> JsString("byPosition")
    )
  )
  private def lookupReq(referenceDsId: String): JsObject = JsObject(
    "type" -> JsString("lookup"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(referenceDsId)),
      "sourceKey"             -> JsString("code"),
      "lookupKey"             -> JsString("code"),
      "columns"               -> JsArray(JsString("label"))
    )
  )
  private def computeReq(column: String, expression: String): JsObject = JsObject(
    "type"   -> JsString("compute"),
    "config" -> JsObject("column" -> JsString(column), "expression" -> JsString(expression))
  )
  // HEL-410: merge an optional `position` list-index into a request body built by
  // one of the *Req() helpers above.
  private def reqWithPosition(base: JsObject, position: Int): JsObject =
    JsObject(base.fields + ("position" -> JsNumber(position)))

  // HEL-412: merge an optional `enabled` flag into a request body built by one
  // of the *Req() helpers above.
  private def reqWithEnabled(base: JsObject, enabled: Boolean): JsObject =
    JsObject(base.fields + ("enabled" -> JsBoolean(enabled)))

  // HEL-906 cycle 7 (task 3.2): merge an explicit `parentStepId` into a request body built
  // by one of the *Req() helpers above.
  private def reqWithParentStepId(base: JsObject, parentStepId: String): JsObject =
    JsObject(base.fields + ("parentStepId" -> JsString(parentStepId)))

  // Evaluation-1 cycle-2 CR1: merge `attachAsTail: true` alongside an explicit `parentStepId`.
  private def reqWithParentStepIdAsTail(base: JsObject, parentStepId: String): JsObject =
    JsObject(base.fields + ("parentStepId" -> JsString(parentStepId)) + ("attachAsTail" -> JsBoolean(true)))

  // Exact request body the "+ Add transformation step" picker sends on lookup-step
  // creation — frontend/src/features/pipelines/state/stepNarrowing.ts's
  // defaultConfigFor("lookup"). HEL-386 change request 2 regression coverage.
  private def lookupDefaultReq(): JsObject = JsObject(
    "type" -> JsString("lookup"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
      "sourceKey"             -> JsString(""),
      "lookupKey"             -> JsString(""),
      "columns"               -> JsArray()
    )
  )

  // HEL-950: `defaultConfigFor("join")` seed shape (join is picker-excluded per
  // ticket.md CORRECTION, but the seed shape is still what agent/MCP and patch-set
  // callers reach the addStep/updateStep path with).
  private def joinDefaultReq(): JsObject = JsObject(
    "type" -> JsString("join"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
      "joinKey"           -> JsString(""),
      "joinType"          -> JsString("inner")
    )
  )

  // Exact request body the "+ Add transformation step" picker sends on union-step
  // creation — frontend/src/features/pipelines/state/stepNarrowing.ts's
  // defaultConfigFor("union") ({ secondaryInput: {kind:"source",dataSourceId:""}, mode: "byPosition" }).
  // HEL-620 regression coverage.
  private def unionDefaultReq(): JsObject = JsObject(
    "type" -> JsString("union"),
    "config" -> JsObject(
      "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
      "mode"              -> JsString("byPosition")
    )
  )

  // -- HEL-278 fixtures: seed a data source owned by ownerId, return its id --
  private def seedDataSource(ownerId: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES (${dsId}, 'join-right', 'rest_api', '{}', ${ownerId}::uuid, now(), now())"""
    ))
    dsId
  }

  "PipelineStepRoutes" should {

    "GET /pipelines/:id/steps returns empty list for new pipeline" in {
      cleanSteps(); val pid = seedPipeline()
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    // HEL-913 task 7.6a: every step response carries its owning root's id -- the wire half of
    // the 4.4 side-map substitution design.md R4's representation table names as load-bearing.
    // `seedPipeline` gives the pipeline exactly one root, whose id equals the pipeline's own id
    // (V98's backfill convention), so a trunk step's `rootId` must equal `pid` here.
    "GET /pipelines/:id/steps carries each step's rootId on the wire (HEL-913 7.6a)" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps should have size 1
        steps.head.rootId shouldBe Some(pid)
      }
    }

    // HEL-913 task 7.3b: POST /pipelines/:id/steps carries rootId, an alternative anchor to
    // parentStepId for a genuinely multi-root pipeline.
    "POST /pipelines/:id/steps with rootId attaches the new step to THAT root, not the other one" in {
      cleanSteps(); val pid = seedPipeline()
      val root2Id = addSecondRoot(pid)

      Post(s"/pipelines/$pid/steps", JsObject(renameReq().fields + ("rootId" -> JsString(root2Id)))) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.rootId shouldBe Some(root2Id)
      }
    }

    "POST /pipelines/:id/steps rejects both parentStepId and rootId with 400" in {
      cleanSteps(); val pid = seedPipeline()
      var existingStepId = ""
      // Seeded BEFORE the second root exists -- unambiguous single-root create at this point.
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        existingStepId = responseAs[PipelineStepResponse].id
      }
      val root2Id = addSecondRoot(pid)

      val body = JsObject(renameReq().fields ++ Map("parentStepId" -> JsString(existingStepId), "rootId" -> JsString(root2Id)))
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "POST /pipelines/:id/steps rejects neither parentStepId nor rootId with 400 once the pipeline has more than one root" in {
      cleanSteps(); val pid = seedPipeline()
      addSecondRoot(pid)

      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "POST /pipelines/:id/steps rejects a rootId naming another pipeline's root with 422" in {
      cleanSteps(); val pid = seedPipeline()
      val otherPid = seedPipeline()
      val otherRootId = otherPid // seedPipeline's V98-backfill convention: root 0's id == the pipeline's own id

      Post(s"/pipelines/$pid/steps", JsObject(renameReq().fields + ("rootId" -> JsString(otherRootId)))) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "POST /pipelines/:id/steps creates a step and returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "rename"
        resp.position shouldBe 0
        resp.id should not be empty
        resp shouldBe a [RenameStepResponse]
        // HEL-913 task 7.6a-i: the create response also carries the new step's real root id,
        // not a silently-inherited `None`.
        resp.rootId shouldBe Some(pid)
      }
    }

    // HEL-904 cycle-9 fix (round-6 skeptic Finding 1): the no-`position`
    // append path now extends the TRUNK -- each new step splices in as the
    // current trunk-last step's sole child, at sibling-scoped `position`
    // 0 (a fresh, previously-empty child group), not a whole-pipeline
    // incrementing index. `position` is a sibling-scoped tiebreaker only.
    "POST without an explicit position extends the trunk (sibling-scoped position 0, not a whole-pipeline increment)" in {
      cleanSteps(); val pid = seedPipeline()
      var idA = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        idA = responseAs[PipelineStepResponse].id
      }
      var idB = ""
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.position shouldBe 0
        idB = resp.id
      }
      // Verify the persisted parent link directly, not merely the wire
      // `position` (which does not carry `parentStepId`).
      val persisted = await(stepRepo.findByIdInternal(PipelineStepId(idB)))
      persisted.map(_.parentStepId) shouldBe Some(Some(PipelineStepId(idA)))
    }

    // HEL-904 cycle-9 fix (round-6 skeptic Finding 1, required-proof test):
    // the primary, default step-creation path (`addStep` with no `position`)
    // must extend the trunk, not fan out into flat root siblings -- else
    // `PipelineRunService`'s run-result node key (`trunkOf(steps).lastOption`)
    // and `PipelineProposalService`'s Output binding (`createdSteps.lastOption`)
    // silently diverge on every pipeline built through the ordinary UI/API
    // path (Probe A in the round-6 skeptic report).
    "addStep x3 with no explicit position builds a genuine trunk -- trunkOf returns all steps in order, and its lastOption is the same id the run-result node key and an Output binding would use" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB, idC = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", castReq())   ~> routes ~> check { idC = responseAs[PipelineStepResponse].id }

      val allSteps = await(stepRepo.listByPipelineInternal(PipelineId(pid)))
      val trunk    = stepRepo.trunkOf(allSteps)

      // The trunk contains all 3 steps, in creation order -- NOT just the
      // first one (the pre-fix bug: every step after the first became a
      // root-level sibling, so `trunkOf` returned only `idA`).
      trunk.map(_.id.value) shouldBe Vector(idA, idB, idC)

      // The run-result node key (`PipelineRunService.trunkOf(steps).lastOption`)
      // and an Output binding (`PipelineProposalService`'s
      // `createdSteps.lastOption`, since `addSteps` calls this same `addStep`
      // path for every proposal step) must agree on which step is "last" --
      // both are `idC` here. Pre-fix, the node key was `idA` (the trunk's
      // sole member) while the binding was `idC`, silently diverging.
      trunk.lastOption.map(_.id.value) shouldBe Some(idC)
    }

    "GET returns steps in trunk order (structural order, not a raw position sort)" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps should have size 2
        steps.map(_.id) shouldBe Vector(idA, idB)
      }
    }

    "PATCH updates a rename step's config and returns 200" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val patchBody = JsObject(
        "config" -> JsObject("renames" -> JsObject("foo" -> JsString("bar")))
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "rename"
        resp shouldBe a [RenameStepResponse]
        // HEL-913 task 7.6a-i: the update response also carries the step's real root id.
        resp.rootId shouldBe Some(pid)
      }
    }

    "PATCH with cross-type discriminator returns 400 (cross-type lock)" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val crossBody = JsObject(
        "type" -> JsString("filter"),
        "config" -> JsObject("combinator" -> JsString("AND"), "conditions" -> JsArray())
      )
      Patch(s"/pipeline-steps/$stepId", crossBody) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "PATCH returns 404 for unknown id" in {
      val body = JsObject("config" -> JsObject("renames" -> JsObject()))
      Patch("/pipeline-steps/nonexistent-id", body) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "DELETE removes a step and returns 200 with a splice-on-delete report" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        val r = responseAs[PipelineStepResponse]
        stepId = r.id
        r shouldBe a [CastStepResponse]
      }
      // HEL-906 cycle 7 (task 3.2): DELETE now returns 200 with a
      // DeletePipelineStepResponse (splice-on-delete removed-tail-step report) instead of
      // a bare 204 -- a leaf/trunk step with no children removes nothing beyond itself.
      Delete(s"/pipeline-steps/$stepId") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DeletePipelineStepResponse].removedTailStepCount shouldBe 0
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "DELETE on a branch point reports the removed-tail-step splice count (HEL-906 task 3.2)" in {
      import PostgresProfile.api._
      val pid = seedPipeline()
      val rootId = seedRootStep(pid, "cast", """{"casts":{}}""", 0)
      // Two real children of root, seeded directly (the per-step POST route's own
      // spliceInsertAtInternal semantics can never create a genuine branch -- every insert
      // there reparents the anchor's EXISTING children onto the new step, so a raw-SQL seed is
      // the only way to set up an actual branch point for this splice-on-delete assertion).
      val headChildId = UUID.randomUUID().toString
      val tailRootId  = UUID.randomUUID().toString
      val tailChildId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($headChildId, $pid, 0, 'cast', '{"casts":{}}', true, now(), now(), $rootId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tailRootId, $pid, 1, 'cast', '{"casts":{}}', true, now(), now(), $rootId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tailChildId, $pid, 0, 'cast', '{"casts":{}}', true, now(), now(), $tailRootId)"""
      )))

      // Deleting root: headChild (the position-0 child) is promoted onto root's old slot;
      // tailRoot AND its own child (tailChild) are removed outright -- removedTailStepCount = 2.
      Delete(s"/pipeline-steps/$rootId") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[DeletePipelineStepResponse].removedTailStepCount shouldBe 2
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val ids = responseAs[Vector[PipelineStepResponse]].map(_.id)
        ids should contain(headChildId)
        ids should not contain tailRootId
        ids should not contain tailChildId
      }
    }

    "POST with an explicit parentStepId splices the new step in directly after the anchor (HEL-906 task 3.2)" in {
      val pid = seedPipeline()
      var rootId = ""
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        rootId = responseAs[PipelineStepResponse].id
      }
      var childId = ""
      Post(s"/pipelines/$pid/steps", reqWithParentStepId(castReq(), rootId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        childId = responseAs[PipelineStepResponse].id
      }
      // No PipelineStepResponse field carries parentStepId directly -- verify the splice via
      // real persisted tree order instead, mirroring `stepRepo.listByPipelineInternal`'s own
      // `trunkOf` contract: root, then the new child, in execution order.
      import PostgresProfile.api._
      val persistedParent = await(db.run(
        sql"SELECT parent_step_id FROM pipeline_steps WHERE id = $childId".as[Option[String]].head
      ))
      persistedParent shouldBe Some(rootId)
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) should contain(childId)
      }
    }

    "POST with a parentStepId not belonging to this pipeline returns 422, persisting nothing" in {
      val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", reqWithParentStepId(castReq(), "not-a-real-step-id")) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "POST with attachAsTail: true on a LEAF anchor (no existing children) still attaches at position >= 1, not the trunk (evaluation-1 cycle-2 CR1)" in {
      val pid = seedPipeline()
      var rootId = ""
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        rootId = responseAs[PipelineStepResponse].id
      }
      var tailId = ""
      Post(s"/pipelines/$pid/steps", reqWithParentStepIdAsTail(castReq(), rootId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        tailId = responseAs[PipelineStepResponse].id
      }
      import PostgresProfile.api._
      val (persistedParent, persistedPosition) = await(db.run(
        sql"SELECT parent_step_id, position FROM pipeline_steps WHERE id = $tailId".as[(Option[String], Int)].head
      ))
      persistedParent shouldBe Some(rootId)
      // This is the whole point of the fix: a leaf anchor must NOT fall back to position 0
      // (which would silently make the "tail" the anchor's trunk continuation instead).
      persistedPosition should be >= 1
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        // The route's own listing is trunk-order; a real tail must not appear as the
        // second trunk entry -- only `rootId` belongs to the trunk here.
        steps.map(_.id) should contain(tailId)
      }
    }

    "DELETE returns 404 for unknown id" in {
      Delete("/pipeline-steps/nonexistent-id") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET returns 404 for unknown pipeline id" in {
      Get("/pipelines/nonexistent-pipeline/steps") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST returns 404 for unknown pipeline id" in {
      Post("/pipelines/nonexistent-pipeline/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST returns 400 for invalid type discriminator" in {
      val pid = seedPipeline()
      val bad = JsObject("type" -> JsString("invalid-op"), "config" -> JsObject())
      Post(s"/pipelines/$pid/steps", bad) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    // 3.2 — select op accepted by the API with the discriminated-union shape
    "POST with type 'select' returns 201 with typed SelectStepResponse" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", selectReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "select"
        resp.pipelineId shouldBe pid
        resp shouldBe a [SelectStepResponse]
      }
    }

    // HEL-278: cross-user JoinStep right-source must return 404
    "POST with join type and cross-user right-source returns 404" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by a different user (user 2)
      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      Post(s"/pipelines/${pid}/steps", joinReq(otherUserDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-278: owner JoinStep with own source must return 201
    "POST with join type and own right-source returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by the request user (user 1)
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      Post(s"/pipelines/${pid}/steps", joinReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "join"
      }
    }

    // HEL-950 (design.md Decision 6, ticket.md AC4/AC6a): the empty-id join body reaches
    // addStep from the agent/MCP surface, not the picker (join is picker-excluded). This
    // MUST succeed (201) with the right source left unset -- an empty/unselected id is an
    // incomplete draft, not a security violation. Before the fix, joinCheckF unconditionally
    // called findByIdOwned(DataSourceId(""), user) => None => 404 for EVERY join create,
    // including a fully-specified one whose id happened to decode alongside an empty one --
    // this is the primary regression this change closes.
    "POST with join type and the picker's exact empty-default config succeeds (201), right source unset" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/${pid}/steps", joinDefaultReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "join"
        val join = resp.asInstanceOf[JoinStepResponse]
        join.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // HEL-911 evaluation-1.md CR4a (cycle 2): Decision 1a's headline behaviour, exercised
    // at the ROUTE layer (422, not just a codec-layer Failure) -- a legacy flat
    // secondary-source field is a hard, named error, never a silently-accepted config.
    "POST with join type and a legacy flat rightDataSourceId config returns 422, creating nothing" in {
      cleanSteps(); val pid = seedPipeline()
      val legacyReq = JsObject(
        "type" -> JsString("join"),
        "config" -> JsObject(
          "rightDataSourceId" -> JsString("ds-1"),
          "joinKey"           -> JsString("id"),
          "joinType"          -> JsString("inner")
        )
      )
      Post(s"/pipelines/${pid}/steps", legacyReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include ("rightDataSourceId")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "POST with union type and a legacy flat otherDataSourceId config returns 422, creating nothing" in {
      cleanSteps(); val pid = seedPipeline()
      val legacyReq = JsObject(
        "type" -> JsString("union"),
        "config" -> JsObject(
          "otherDataSourceId" -> JsString("ds-1"),
          "mode"              -> JsString("byPosition")
        )
      )
      Post(s"/pipelines/${pid}/steps", legacyReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include ("otherDataSourceId")
      }
    }

    "POST with lookup type and a legacy flat referenceDataSourceId config returns 422, creating nothing" in {
      cleanSteps(); val pid = seedPipeline()
      val legacyReq = JsObject(
        "type" -> JsString("lookup"),
        "config" -> JsObject(
          "referenceDataSourceId" -> JsString("ds-1"),
          "sourceKey"             -> JsString("a"),
          "lookupKey"             -> JsString("b"),
          "columns"               -> JsArray()
        )
      )
      Post(s"/pipelines/${pid}/steps", legacyReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include ("referenceDataSourceId")
      }
    }

    // Same regression, PATCH half: clearing an already-set right source back to "" must
    // stay allowed (it's un-setting a draft, not referencing a cross-user source).
    "PATCH join step config to an empty secondaryInput stays allowed (200)" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", joinReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
          "joinKey"           -> JsString("id"),
          "joinType"          -> JsString("inner")
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        val join = resp.asInstanceOf[JoinStepResponse]
        join.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // HEL-278 (design.md Decision 9): cross-user JoinStep right-source on PATCH must return
    // 404 with the persisted config left unchanged -- the updateStep half of the ACL check,
    // mirroring union's/lookup's equivalent tests. Proves the shared-extractor rewrite did
    // not weaken updateStep's cross-user check for join.
    "PATCH join step config to cross-user right-source returns 404 and leaves config unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", joinReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherUserDsId)),
          "joinKey"           -> JsString("id"),
          "joinType"          -> JsString("inner")
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        val join = steps.collectFirst { case j: JoinStepResponse => j }
        join should not be empty
        join.get.config.secondaryInput shouldBe SecondaryInput.Source(ownDsId)
      }
    }

    // HEL-384 (design.md Decision 9): cross-user UnionStep other-source must return 404
    "POST with union type and cross-user other-source returns 404" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by a different user (user 2)
      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      Post(s"/pipelines/${pid}/steps", unionReq(otherUserDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-384 (design.md Decision 9): owner UnionStep with own source must return 201
    "POST with union type and own other-source returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      // Seed a data source owned by the request user (user 1)
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      Post(s"/pipelines/${pid}/steps", unionReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "union"
      }
    }

    // HEL-384 (design.md Decision 9): cross-user UnionStep other-source on PATCH must return
    // 404 with the persisted config left unchanged — the updateStep half of the ACL check that
    // the POST pair above doesn't reach (no join equivalent exists for this scenario).
    "PATCH union step config to cross-user other-source returns 404 and leaves config unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", unionReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherUserDsId)),
          "mode"              -> JsString("byPosition")
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        val union = steps.collectFirst { case u: UnionStepResponse => u }
        union should not be empty
        union.get.config.secondaryInput shouldBe SecondaryInput.Source(ownDsId)
      }
    }

    // HEL-620 (mirrors HEL-386 change request 2 regression, design.md Decision 1's "empty is
    // a no-op, not an error" philosophy): the "+ Add transformation step" picker POSTs
    // defaultConfigFor("union") — { secondaryInput: {kind:"source",dataSourceId:""}, mode: "byPosition" }. This MUST
    // succeed (201) with the other source left unset — an empty/unselected id is an
    // incomplete draft, not a security violation (nothing to leak against an unset id).
    // Before the fix, unionCheckF unconditionally called
    // findByIdOwned(DataSourceId(""), user) => None => 404, so a union step could never be
    // created via the primary UI flow.
    "POST with union type and the picker's exact empty-default config succeeds (201), other source unset" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/${pid}/steps", unionDefaultReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "union"
        val union = resp.asInstanceOf[UnionStepResponse]
        union.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // Same regression, PATCH half: clearing an already-set other source back to "" must stay
    // allowed (it's un-setting a draft, not referencing a cross-user source).
    "PATCH union step config to an empty secondaryInput stays allowed (200)" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", unionReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
          "mode"              -> JsString("byPosition")
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        val union = resp.asInstanceOf[UnionStepResponse]
        union.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // HEL-386 (design.md Decision 9): cross-user LookupStep reference-source must return 404
    "POST with lookup type and cross-user reference-source returns 404" in {
      cleanSteps(); val pid = seedPipeline()
      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      Post(s"/pipelines/${pid}/steps", lookupReq(otherUserDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-386 (design.md Decision 9): owner LookupStep with own source must return 201
    "POST with lookup type and own reference-source returns 201" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      Post(s"/pipelines/${pid}/steps", lookupReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "lookup"
      }
    }

    // HEL-386 (design.md Decision 9): cross-user LookupStep reference-source on PATCH must
    // return 404 with the persisted config left unchanged — the updateStep half of the ACL
    // check, mirroring union's task 6.8 (no join equivalent exists for this scenario).
    "PATCH lookup step config to cross-user reference-source returns 404 and leaves config unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", lookupReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val otherUserDsId = seedDataSource("00000000-0000-0000-0000-000000000002")
      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(otherUserDsId)),
          "sourceKey"             -> JsString("code"),
          "lookupKey"             -> JsString("code"),
          "columns"               -> JsArray(JsString("label"))
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        val lookup = steps.collectFirst { case l: LookupStepResponse => l }
        lookup should not be empty
        lookup.get.config.secondaryInput shouldBe SecondaryInput.Source(ownDsId)
      }
    }

    // HEL-386 evaluation-1.md change request 1+2 (regression): the "+ Add transformation
    // step" picker POSTs defaultConfigFor("lookup") — an entirely empty config, including
    // secondaryInput: {kind:"source",dataSourceId:""}. This MUST succeed (201) with the reference source left
    // unset — an empty/unselected reference id is an incomplete draft, not a security
    // violation (nothing to leak against an unset id), matching design.md Decision 1's
    // "empty is a no-op, not an error" philosophy and Decision 6's execute-time-only
    // failure scoping. Before the fix, lookupCheckF unconditionally called
    // findByIdOwned(DataSourceId(""), user) => None => 404, so a lookup step could never
    // be created via the primary UI flow.
    "POST with lookup type and the picker's exact empty-default config succeeds (201), reference source unset" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/${pid}/steps", lookupDefaultReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.pipelineId shouldBe pid
        resp.`type` shouldBe "lookup"
        val lookup = resp.asInstanceOf[LookupStepResponse]
        lookup.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // Same regression, PATCH half: clearing an already-set reference source back to "" must
    // stay allowed (it's un-setting a draft, not referencing a cross-user source).
    "PATCH lookup step config to an empty secondaryInput stays allowed (200)" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", lookupReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString("")),
          "sourceKey"             -> JsString("code"),
          "lookupKey"             -> JsString("code"),
          "columns"               -> JsArray(JsString("label"))
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        val lookup = resp.asInstanceOf[LookupStepResponse]
        lookup.config.secondaryInput shouldBe SecondaryInput.Source("")
      }
    }

    // CS2c-3a -- aggregate was previously absent from PipelineService.AllowedOps
    "POST with type 'aggregate' is accepted (regression: AllowedOps drift)" in {
      cleanSteps(); val pid = seedPipeline()
      val body = JsObject(
        "type" -> JsString("aggregate"),
        "config" -> JsObject(
          "groupBy"      -> JsArray(),
          "aggregations" -> JsArray()
        )
      )
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].`type` shouldBe "aggregate"
      }
    }

    // HEL-219 -- splittext is the 11th step kind; regression coverage for the
    // same AllowedOps/CHECK-constraint drift class the aggregate test above guards.
    "POST with type 'splittext' is accepted" in {
      cleanSteps(); val pid = seedPipeline()
      val body = JsObject(
        "type" -> JsString("splittext"),
        "config" -> JsObject(
          "field"      -> JsString("content"),
          "mode"       -> JsString("paragraph"),
          "indexField" -> JsString("segmentIndex")
        )
      )
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].`type` shouldBe "splittext"
      }
    }

    // HEL-220 -- extractheadings is the 12th step kind; regression coverage for the
    // same AllowedOps/CHECK-constraint drift class the splittext test above guards.
    "POST with type 'extractheadings' is accepted" in {
      cleanSteps(); val pid = seedPipeline()
      val body = JsObject(
        "type" -> JsString("extractheadings"),
        "config" -> JsObject(
          "field"      -> JsString("content"),
          "indexField" -> JsString("headingIndex"),
          "levelField" -> JsString("headingLevel")
        )
      )
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].`type` shouldBe "extractheadings"
      }
    }

    // HEL-221 -- chunkbytokencount is the 13th and final "text op" step kind;
    // regression coverage for the same AllowedOps/CHECK-constraint drift class
    // the splittext/extractheadings tests above guard.
    "POST with type 'chunkbytokencount' is accepted" in {
      cleanSteps(); val pid = seedPipeline()
      val body = JsObject(
        "type" -> JsString("chunkbytokencount"),
        "config" -> JsObject(
          "field"            -> JsString("content"),
          "targetTokenCount" -> JsNumber(500),
          "encoding"         -> JsString("o200k_base"),
          "indexField"       -> JsString("chunkIndex"),
          "tokenCountField"  -> JsString("tokenCount")
        )
      )
      Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].`type` shouldBe "chunkbytokencount"
      }
    }


    // HEL-908 (design.md decision 15, cycle 9): `PUT /pipelines/:id/steps/order`'s
    // request-shape contract is now TRUNK-ONLY -- `reorderSteps` is repointed
    // at `reorderTrunkInternal`, which relinks the trunk's `parentStepId`
    // chain (not `reorderInternal`'s sibling-scoped position renumber, which
    // is a no-op for a pure trunk since every trunk step has a distinct
    // parent). This test used to seed 3 flat ROOT SIBLINGS and exercise the
    // old sibling-scoped renumber -- superseded: 3 root siblings are not a
    // valid trunk permutation under the new contract (only the position-0
    // root sibling is trunk; the other two are root-level tails), so it is
    // rewritten here to seed a genuine parent-chained trunk and assert the
    // real relink + persistence, end to end through the live route.
    // HEL-913 task 7.3d-i (coordinator ruling): reorderTrunkInternal's notion of "the trunk" is
    // root-unaware, and its idx==0 update writes root_id from firstRootIdAction (always the
    // lowest-positioned root) unconditionally -- on a multi-root pipeline this could silently
    // reassign a step from root B's trunk onto root A. Fenced closed with a named 400 rather
    // than left reachable; the real multi-root reorder semantics are HEL-973.
    "PUT /pipelines/:id/steps/order returns 400 once the pipeline has more than one root" in {
      cleanSteps(); val pid = seedPipeline()
      var idA = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      addSecondRoot(pid)

      Put(s"/pipelines/$pid/steps/order", JsObject("stepIds" -> Vector(idA).toJson)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "PUT /pipelines/:id/steps/order reorders a genuine trunk, relinking parentStepId end to end" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB, idC = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", castReq())   ~> routes ~> check { idC = responseAs[PipelineStepResponse].id }

      val body = JsObject("stepIds" -> JsArray(JsString(idC), JsString(idA), JsString(idB)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        // executionOrder-shaped response: the NEW trunk, c -> a -> b.
        steps.map(_.id) shouldBe Vector(idC, idA, idB)
        steps.map(_.parentStepId) shouldBe Vector(None, Some(idC), Some(idA))
        steps.foreach(_.position shouldBe 0)
      }

      // Persists and survives reload — a subsequent GET reflects the new order.
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idC, idA, idB)
      }
    }

    "PUT /pipelines/:id/steps/order returns 404 for unknown pipeline id" in {
      val body = JsObject("stepIds" -> JsArray())
      Put("/pipelines/nonexistent-pipeline/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "PUT /pipelines/:id/steps/order returns 403 for a viewer grantee" in {
      cleanSteps(); val pid = seedPipeline()
      var idA = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      grantViewer(pid)

      val body = JsObject("stepIds" -> JsArray(JsString(idA)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routesFor(viewerUser) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "PUT /pipelines/:id/steps/order returns 422 when stepIds omits an existing step" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

      val body = JsObject("stepIds" -> JsArray(JsString(idA)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "PUT /pipelines/:id/steps/order returns 422 when stepIds contains an unknown id" in {
      cleanSteps(); val pid = seedPipeline()
      var idA = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }

      val body = JsObject("stepIds" -> JsArray(JsString(idA), JsString("nonexistent-step-id")))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "PUT /pipelines/:id/steps/order returns 422 when stepIds repeats an id" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

      val body = JsObject("stepIds" -> JsArray(JsString(idA), JsString(idA)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "PUT /pipelines/:id/steps/order failed reorder (422) leaves positions unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: flat ROOT siblings seeded directly via SQL (see the
      // "reindexes positions" test above for why).
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)

      val body = JsObject("stepIds" -> JsArray(JsString(idB), JsString("nonexistent-step-id")))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.find(_.id == idA).map(_.position) shouldBe Some(0)
        steps.find(_.id == idB).map(_.position) shouldBe Some(1)
      }
    }

    // ── HEL-908 (design.md decision 15, cycle 9): trunk-only request-shape ──
    //
    // Seeds a real multi-level tree via raw SQL (the shape a V94-migrated
    // pipeline with an aggregate tail has):
    //   a (root, pos 0)
    //     -> b (pos 0, trunk continuation)  -> c (pos 0, further trunk)
    //     -> t (pos 1, tail sibling of b -- NOT part of the trunk)
    // `reorderSteps` is now repointed at `reorderTrunkInternal`, whose
    // request-shape contract is TRUNK-ONLY: exactly the pipeline's current
    // trunk ids (here, {a, b, c}), no tail ids, no missing/duplicate ids.
    // This supersedes the pre-cycle-9 sibling-scoped-renumber test that used
    // to live here (which asserted 200 OK for a request interleaving a tail
    // id across sibling groups) -- that request now correctly 422s, per the
    // "reject rather than silently no-op" contract Decision 15 documents.
    "PUT /pipelines/:id/steps/order rejects a request containing a tail id, naming it, and touches nothing" in {
      import PostgresProfile.api._
      cleanSteps(); val pid = seedPipeline()
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val tId = UUID.randomUUID().toString
      val cId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($aId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tId, $pid, 1, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($cId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $bId)"""
      )))

      // Interleaves the tail id (t) into the request -- rejected under the
      // new trunk-only contract, not silently accepted or no-op'd.
      val body = JsObject("stepIds" -> JsArray(JsString(tId), JsString(aId), JsString(cId), JsString(bId)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      // Nothing touched: every row's position/parent is exactly as seeded.
      val rows = await(db.run(
        sql"SELECT id, position, parent_step_id FROM pipeline_steps WHERE pipeline_id = $pid".as[(String, Int, Option[String])]
      )).map { case (id, pos, parent) => id -> (pos, parent) }.toMap
      rows(aId) shouldBe (0, None)
      rows(bId) shouldBe (0, Some(aId))
      rows(tId) shouldBe (1, Some(aId))
      rows(cId) shouldBe (0, Some(bId))

      val steps = await(stepRepo.listByPipelineInternal(PipelineId(pid)))
      stepRepo.trunkOf(steps).map(_.id.value) shouldBe Vector(aId, bId, cId)
    }

    "PUT /pipelines/:id/steps/order reorders the trunk-only subset of a tail-bearing pipeline, leaving the tail attached to its own node" in {
      import PostgresProfile.api._
      cleanSteps(); val pid = seedPipeline()
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val tId = UUID.randomUUID().toString
      val cId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($aId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tId, $pid, 1, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($cId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $bId)"""
      )))

      // Trunk-only permutation, no tail id: b -> a -> c (b becomes root,
      // a becomes b's trunk continuation, c stays a's -- wait, c is now a's
      // continuation since a comes right before it in this order).
      val body = JsObject("stepIds" -> JsArray(JsString(bId), JsString(aId), JsString(cId)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      // "The tail follows its trunk step": t's own parentStepId is still a,
      // untouched by the reorder -- regardless of where a now sits.
      val rows = await(db.run(
        sql"SELECT id, position, parent_step_id FROM pipeline_steps WHERE pipeline_id = $pid".as[(String, Int, Option[String])]
      )).map { case (id, pos, parent) => id -> (pos, parent) }.toMap
      rows(tId) shouldBe (1, Some(aId))

      val steps = await(stepRepo.listByPipelineInternal(PipelineId(pid)))
      stepRepo.trunkOf(steps).map(_.id.value) shouldBe Vector(bId, aId, cId)
      // b (the new root, occupying a's old slot) has no tail of its own.
      stepRepo.childrenOf(steps, Some(PipelineStepId(bId))).count(_.position != 0) shouldBe 0
    }

    // ── HEL-410: POST /pipelines/:id/steps with optional `position` (insert-at) ──

    "POST with position: 0 inserts before all existing steps and shifts them down" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: seeded as flat ROOT siblings directly via SQL (see
      // the reorder tests above for why `addStep` no longer produces this
      // shape by itself).
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 0)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.position shouldBe 0
        newId = resp.id
      }

      // Persists and survives reload — a subsequent GET reflects the shifted
      // order. HEL-904 cycle-7 fix: `position` is sibling-scoped (the new
      // step splices in as the pipeline root) — NOT a whole-pipeline index.
      //
      // HEL-904 cycle-8 fix (round-5 skeptic Finding 1): BOTH of root's
      // existing children (`idA` at position 0 AND `idB` at position 1) are
      // now re-parented onto the new step, not just the position-0 one —
      // `idB` was itself already a root-level "tail" sibling (position 1)
      // before this insert, exactly the shape the round-5 report reproduced
      // a misplacement on. Re-parenting it too means the new step correctly
      // inherits everything root used to own downstream. `executionOrder`
      // then emits `newId`'s tails (`idB`, preserved at its own position 1)
      // BEFORE `newId`'s trunk continuation (`idA`, preserved at position 0)
      // — this is a genuine, intentional order-of-emission consequence of
      // the same trunk/tail model every other splice already uses, not a
      // fresh inconsistency: `idA` and `idB` were always sibling-scoped
      // peers, never chained to each other, so there was never a
      // "sequential a-then-b" guarantee between them to begin with.
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(newId, idB, idA)
        steps.map(s => (s.id, s.position)) shouldBe Vector((newId, 0), (idB, 1), (idA, 0))
      }
    }

    "POST with position in the middle shifts only later steps down" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: flat ROOT siblings seeded directly via SQL.
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)
      val idC = seedRootStep(pid, "cast",   """{"casts":{}}""", 2)

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(selectReq(), 1)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        // HEL-904 cycle-7 fix: sibling-scoped position -- the new step
        // splices in as idA's trunk-continuation child (position 0 within
        // idA's own, previously-empty, child group), not whole-pipeline
        // index 1.
        resp.position shouldBe 0
        newId = resp.id
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idA, newId, idB, idC)
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (newId, 0), (idB, 1), (idC, 2))
      }
    }

    "POST with position equal to the current step count behaves like append" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: flat ROOT siblings seeded directly via SQL.
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 2)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        // HEL-904 cycle-7 fix: sibling-scoped position -- appending extends
        // the trunk by splicing the new step in as idB's (the current last
        // step's) trunk-continuation child, position 0 within idB's own
        // child group, not whole-pipeline index 2.
        resp.position shouldBe 0
        newId = resp.id
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idA, idB, newId)
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (idB, 1), (newId, 0))
      }
    }

    "POST with negative position returns 422 and persists nothing" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }

      Post(s"/pipelines/$pid/steps", reqWithPosition(filterReq(), -1)) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] should have size 1
      }
    }

    "POST with position greater than the current step count returns 422 and persists nothing" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }

      Post(s"/pipelines/$pid/steps", reqWithPosition(filterReq(), 5)) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] should have size 1
      }
    }

    // HEL-407 finding: deleteStep never renumbers, so positions can be non-contiguous
    // (e.g. 0, 2, 5 after deletions). insert-at must be correct under gaps: it reads
    // the sorted step list (not raw positions), splices the new row in at the given
    // list index, and renumbers every step contiguously 0..n as a side effect.
    "POST with position heals pre-existing position gaps into a contiguous order" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: flat ROOT siblings seeded directly via SQL.
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)
      val idC = seedRootStep(pid, "cast",   """{"casts":{}}""", 2)
      val idD = seedRootStep(pid, "select", """{"fields":[]}""", 3)
      val idE = seedRootStep(pid, "rename", """{"renames":{}}""", 4)
      val idF = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 5)

      Delete(s"/pipeline-steps/$idB") ~> routes ~> check { status shouldBe StatusCodes.OK }
      Delete(s"/pipeline-steps/$idD") ~> routes ~> check { status shouldBe StatusCodes.OK }
      Delete(s"/pipeline-steps/$idE") ~> routes ~> check { status shouldBe StatusCodes.OK }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (idC, 2), (idF, 5))
      }

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 1)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        newId = responseAs[PipelineStepResponse].id
      }

      // HEL-904 cycle-7 fix: sibling-scoped position -- the new step splices
      // in as idA's trunk-continuation child (position 0 within idA's own,
      // previously-empty, child group); idC/idF stay root siblings at their
      // own (still-gapped) positions, unaffected.
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idA, newId, idC, idF)
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (newId, 0), (idC, 2), (idF, 5))
      }
    }

    // ── HEL-904 cycle-7 fix (round-4 skeptic Finding 1) ───────────────────
    //
    // The `addStep(position=…)` half of the same reproduced bug: on a
    // MIGRATED (parent-chained) pipeline, `position` is a whole-pipeline
    // execution-order index (per the schema's own contract), which
    // `persistNewStep` used to pass straight into `insertAtInternal`'s
    // sibling-scoped (root-group-only) index space -- silently appending to
    // the end instead of splicing in at the requested slot, while the
    // response echoed the REQUESTED (wrong) position rather than what
    // persisted.
    "POST /pipelines/:id/steps with an explicit position on a migrated (parent-chained) pipeline splices in at the requested slot, and the response position matches the persisted row" in {
      import PostgresProfile.api._
      cleanSteps(); val pid = seedPipeline()
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val cId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($aId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($cId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $bId)"""
      )))
      // Pre-condition: a pure 3-step trunk chain, execution order a,b,c.
      val before = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      before shouldBe Vector(aId, bId, cId)

      var newId = ""
      var reportedPosition = -1
      // Requesting whole-pipeline index 2 ("insert directly before the step
      // currently at index 2", i.e. directly after `b`).
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 2)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        newId = resp.id
        reportedPosition = resp.position
      }

      // (a) Correct sibling-scoped splice position: the new step lands
      // between `b` and `c` in execution order (a, b, NEW, c) -- not
      // appended to the end (a, b, c, NEW), which was the reproduced bug.
      val after = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      after shouldBe Vector(aId, bId, newId, cId)

      // (b) The response's reported position equals what is ACTUALLY
      // persisted, read back independently of the response object.
      val persisted = await(stepRepo.findByIdInternal(PipelineStepId(newId)))
      persisted.map(_.position) shouldBe Some(reportedPosition)
    }

    "POST without enabled creates an enabled step" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].enabled shouldBe true
      }
    }

    "POST with enabled: false creates a disabled step" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", reqWithEnabled(renameReq(), enabled = false)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].enabled shouldBe false
      }
    }

    "PATCH enabled toggles and round-trips across a re-GET" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }

      Patch(s"/pipeline-steps/$stepId", JsObject("enabled" -> JsBoolean(false))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineStepResponse].enabled shouldBe false
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]].head.enabled shouldBe false
      }

      Patch(s"/pipeline-steps/$stepId", JsObject("enabled" -> JsBoolean(true))) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineStepResponse].enabled shouldBe true
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]].head.enabled shouldBe true
      }
    }

    "PATCH config only leaves enabled unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", reqWithEnabled(renameReq(), enabled = false)) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val patchBody = JsObject("config" -> JsObject("renames" -> JsObject("foo" -> JsString("bar"))))
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[PipelineStepResponse].enabled shouldBe false
      }
    }


    "POST /pipeline-steps/:id/duplicate clones the step directly after the original" in {
      cleanSteps(); val pid = seedPipeline()
      // HEL-904 cycle-9: flat ROOT siblings seeded directly via SQL.
      val idA = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val idB = seedRootStep(pid, "filter", """{"combinator":"AND","conditions":[]}""", 1)

      var cloneId = ""
      Post(s"/pipeline-steps/$idA/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "rename"
        resp.enabled shouldBe true
        // HEL-904 cycle-7 fix: sibling-scoped position -- the clone splices
        // in as idA's trunk-continuation child (position 0 within idA's own,
        // previously-empty, child group), not whole-pipeline index 1. This
        // is the exact "response position doesn't match the persisted row"
        // regression round-4 skeptic Finding 1 flagged: the response MUST
        // report what actually persisted, verified independently below.
        resp.position shouldBe 0
        cloneId = resp.id
        cloneId should not be idA
        // HEL-913 task 7.6a-i: the duplicate response also carries the clone's real root id.
        resp.rootId shouldBe Some(pid)
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        // Order: the clone lands directly after the original (not appended
        // to the end, which was round-4 skeptic Finding 1's reproduced bug).
        steps.map(_.id) shouldBe Vector(idA, cloneId, idB)
        steps.map(_.position) shouldBe Vector(0, 0, 1)
      }

      // Read the row back independently of the create response, per the
      // coordinator's explicit two-part test requirement: (a) correct
      // sibling-scoped splice position [asserted above via the ordered GET],
      // (b) the response's reported position equals what is ACTUALLY
      // persisted, read back via a separate repository call rather than
      // trusting the create response's own echo.
      val persisted = await(stepRepo.findByIdInternal(PipelineStepId(cloneId)))
      persisted.map(_.position) shouldBe Some(0)
    }

    // ── HEL-904 cycle-7 fix (round-4 skeptic Finding 1) ───────────────────
    //
    // Reproduces the reported bug on a MIGRATED (parent-chained) pipeline
    // shape -- a real `parent_step_id` chain seeded directly via SQL, NOT
    // built through the API (which only ever produces flat root siblings
    // today, ordinary sibling group == whole pipeline, the exact reason the
    // pre-existing flat-pipeline coverage above never caught this). Before
    // the fix, `duplicateStep` computed a whole-pipeline `executionOrder`
    // index and passed it straight to `insertAtInternal`'s sibling-scoped
    // (root-group-only) index space, silently appending the clone to the
    // very end instead of splicing it in after the original, while the
    // response still echoed the REQUESTED (wrong) position.
    "POST /pipeline-steps/:id/duplicate on a migrated (parent-chained) pipeline splices the clone directly after the original, and the response position matches the persisted row" in {
      import PostgresProfile.api._
      cleanSteps(); val pid = seedPipeline()
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val cId = UUID.randomUUID().toString
      val dId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($aId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($cId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $bId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($dId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $cId)"""
      )))
      // Pre-condition: a pure 4-step trunk chain, execution order a,b,c,d.
      val before = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      before shouldBe Vector(aId, bId, cId, dId)

      var cloneId = ""
      var reportedPosition = -1
      Post(s"/pipeline-steps/$bId/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        cloneId = resp.id
        reportedPosition = resp.position
      }

      // (a) Correct sibling-scoped splice position: the clone lands directly
      // after `b` in execution order (a, b, CLONE, c, d) -- not appended to
      // the end (a, b, c, d, CLONE), which was the reproduced bug.
      val after = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      after shouldBe Vector(aId, bId, cloneId, cId, dId)

      // (b) The response's reported position equals what is ACTUALLY
      // persisted, read back independently of the response object (never
      // trusting the create response's own echo).
      val persisted = await(stepRepo.findByIdInternal(PipelineStepId(cloneId)))
      persisted.map(_.position) shouldBe Some(reportedPosition)
    }

    "POST /pipeline-steps/:id/duplicate on a migrated (parent-chained) pipeline WITH a tail-bearing anchor splices the clone directly after the original, before the pre-existing tail (HEL-904 cycle-8, round-5 skeptic Finding 1)" in {
      // Shape: trunk a -> b (b is the trunk-last step, NO position-0 child),
      // plus a `position = 1` child of b -- exactly what V94 produces for a
      // trunk step whose migrated aggregate tail is its only child. The
      // round-5 report proved the pure-chain tests above (a->b->c->d, no
      // tails) provably cannot catch this class of defect.
      import PostgresProfile.api._
      cleanSteps(); val pid = seedPipeline()
      val aId = UUID.randomUUID().toString
      val bId = UUID.randomUUID().toString
      val tailId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($aId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $pid)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($bId, $pid, 0, 'rename', '{"renames":{}}', true, now(), now(), $aId)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id)
               VALUES ($tailId, $pid, 1, 'rename', '{"renames":{}}', true, now(), now(), $bId)"""
      )))
      val before = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      before shouldBe Vector(aId, bId, tailId)

      var cloneId = ""
      Post(s"/pipeline-steps/$bId/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        cloneId = responseAs[PipelineStepResponse].id
      }

      // The clone lands directly after `b`, BEFORE the pre-existing tail
      // (a, b, CLONE, tail) -- not after it (a, b, tail, CLONE), which is
      // the exact misplacement the round-5 report reproduced on 3 real
      // migrated pipelines.
      val after = await(stepRepo.listByPipelineInternal(PipelineId(pid))).map(_.id.value)
      after shouldBe Vector(aId, bId, cloneId, tailId)

      // The tail is now the clone's child, not `b`'s -- `b` has exactly one
      // child (the clone).
      val allSteps = await(stepRepo.listByPipelineInternal(PipelineId(pid)))
      stepRepo.childrenOf(allSteps, Some(PipelineStepId(bId))).map(_.id.value) shouldBe Vector(cloneId)
    }

    "POST /pipeline-steps/:id/duplicate on a disabled step yields a disabled clone" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", reqWithEnabled(renameReq(), enabled = false)) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }

      Post(s"/pipeline-steps/$stepId/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].enabled shouldBe false
      }
    }

    "POST /pipeline-steps/:id/duplicate preserves the original's config" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      val patchedConfig = JsObject("renames" -> JsObject("foo" -> JsString("bar")))
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      Patch(s"/pipeline-steps/$stepId", JsObject("config" -> patchedConfig)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      Post(s"/pipeline-steps/$stepId/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val clone = responseAs[PipelineStepResponse].asInstanceOf[RenameStepResponse]
        clone.config.renames shouldBe Map("foo" -> "bar")
      }
    }

    "POST /pipeline-steps/:id/duplicate returns 404 for an unknown step id" in {
      Post("/pipeline-steps/nonexistent-id/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST /pipeline-steps/:id/duplicate returns 403 for a viewer grantee" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      grantViewer(pid)

      Post(s"/pipeline-steps/$stepId/duplicate") ~> routesFor(viewerUser) ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    // ── HEL-860: reject mistyped cast/rename config (AC1, AC2, AC5) ─────────

    "POST /pipelines/:id/steps returns 422 for a list-shaped casts config and creates no step (4.1)" in {
      cleanSteps(); val pid = seedPipeline()
      val badReq = JsObject(
        "type"   -> JsString("cast"),
        "config" -> JsObject("casts" -> JsArray(JsObject("field" -> JsString("stats.adp_ppr"), "to" -> JsString("float"))))
      )
      Post(s"/pipelines/$pid/steps", badReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[ErrorResponse].message
        msg should include("casts")
        msg should include("object mapping field name to type name")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "POST /pipelines/:id/steps returns 422 for a casts object with non-string values and creates no step (4.2)" in {
      cleanSteps(); val pid = seedPipeline()
      val badReq = JsObject(
        "type"   -> JsString("cast"),
        "config" -> JsObject("casts" -> JsObject("amount" -> JsNumber(1)))
      )
      Post(s"/pipelines/$pid/steps", badReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[ErrorResponse].message
        msg should include("casts")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    "POST /pipelines/:id/steps returns 422 for a list-shaped renames config and creates no step (4.3)" in {
      cleanSteps(); val pid = seedPipeline()
      val badReq = JsObject(
        "type"   -> JsString("rename"),
        "config" -> JsObject("renames" -> JsArray(JsString("order_id")))
      )
      Post(s"/pipelines/$pid/steps", badReq) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[ErrorResponse].message
        msg should include("renames")
        // evaluation-1.md CR-1: `renames` is a from-field-name -> to-field-name
        // map, NOT a field -> type map — the two kinds must NOT share wording.
        // A caller following "type name" guidance for `renames` would send
        // {"renames":{"amount":"double"}}, which this validator ACCEPTS and
        // which silently renames the column `amount` to the string "double"
        // — the exact green-run/wrong-result shape this ticket exists to
        // prevent, now reachable through the rejection message itself.
        msg should include("from-field-name to to-field-name")
        msg should not include "type name"
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    // ── HEL-888: reject a statically unparseable compute expression on write ──

    // PROOF (task 2.2). Run on unmodified `main`: 200s and stores the step —
    // the production defect (measured on v0.7.6). Uses the real step-create
    // route + real Postgres-backed repository, not a direct companion call.
    "POST /pipelines/:id/steps returns 422 for an unparseable compute expression and creates no step" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", computeReq("value_vs_adp", "stats.adp_ppr - stats.pts_ppr")) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[ErrorResponse].message
        msg should include("expression")
        msg should include("Invalid number literal")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
      }
    }

    // PROOF (task 2.6), relabelled up from an initial GUARD claim per
    // evaluation-1.md's non-blocking correction: run against `main`, this
    // 200s the PATCH and stores the unparseable expression — a genuine
    // behavioural red, not a mutation-only one. The update surface
    // (`PipelineService:670`) reaches the same `validateRawConfig` override
    // as create — a valid compute step cannot be edited into an unparseable
    // one.
    "PATCH /pipeline-steps/:id returns 422 when updating a compute step to an unparseable expression, leaving it unchanged" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", computeReq("doubled", "$amount * 2")) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val badPatch = JsObject(
        "config" -> JsObject("column" -> JsString("doubled"), "expression" -> JsString("stats.a - stats.b"))
      )
      Patch(s"/pipeline-steps/$stepId", badPatch) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[ErrorResponse].message should include("expression")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]].head.asInstanceOf[ComputeStepResponse].config.expression shouldBe "$amount * 2"
      }
    }

    // GUARD: a legacy bare-identifier compute expression remains creatable
    // through the real route (design.md Decision 1's write-surface guarantee).
    "POST /pipelines/:id/steps still accepts a legacy bare-identifier compute expression" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", computeReq("revenue", "price * qty")) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "POST /pipelines/:id/steps still accepts a correctly-shaped cast config, storing the supplied mapping, and still accepts {} (4.4)" in {
      cleanSteps(); val pid = seedPipeline()
      val goodReq = JsObject(
        "type"   -> JsString("cast"),
        "config" -> JsObject("casts" -> JsObject("amount" -> JsString("double")))
      )
      Post(s"/pipelines/$pid/steps", goodReq) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse].asInstanceOf[CastStepResponse]
        resp.config.casts shouldBe Map("amount" -> "double")
      }
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse].asInstanceOf[CastStepResponse]
        resp.config.casts shouldBe empty
      }
    }

    "PATCH /pipeline-steps/:id returns 422 for a mistyped config and leaves the stored config unchanged (4.5)" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      val goodReq = JsObject(
        "type"   -> JsString("cast"),
        "config" -> JsObject("casts" -> JsObject("amount" -> JsString("double")))
      )
      Post(s"/pipelines/$pid/steps", goodReq) ~> routes ~> check {
        stepId = responseAs[PipelineStepResponse].id
      }
      val badPatch = JsObject(
        "config" -> JsObject("casts" -> JsArray(JsString("amount")))
      )
      Patch(s"/pipeline-steps/$stepId", badPatch) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val msg = responseAs[ErrorResponse].message
        msg should include("casts")
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val resp = responseAs[Vector[PipelineStepResponse]].head.asInstanceOf[CastStepResponse]
        resp.config.casts shouldBe Map("amount" -> "double")
      }
    }

    // HEL-814 task 2.6 — PROOF that D1 took effect, not incidental churn.
    //
    // This test previously asserted (as HEL-860's AC3) that a legacy
    // list-shaped stored `casts` row still returned 200 with an EMPTY cast
    // map, "because this change only adds a WRITE-path check". HEL-814
    // knowingly NARROWS that read-tolerance guarantee for the wrong-TYPE half:
    // a stored key present but of a JSON type that cannot represent the
    // field now fails to decode, and `PipelineStepRepository.rowToDomain`
    // turns that decode failure into a 500.
    //
    // Why that narrowing is acceptable, and why it is only the wrong-TYPE
    // half: 0 of 233 configs measured across dev and prod carry a wrong-type
    // value, so no real row is reachable — whereas ABSENT and EMPTY keys have
    // 20 real rows behind them (steps a user added and has not configured
    // yet) and stay fully tolerant, which is why the sibling test below still
    // asserts a 200. Reversing that half instead would have turned a silently
    // degraded run into a failure to open the pipeline editor at all.
    //
    // The residual risk this asserts is real and is stated in the PR: a
    // wrong-type row created between the measurement and the deploy would
    // become a 500 on listing rather than a silently degraded read.
    "GET /pipelines/:id/steps now FAILS to decode a legacy list-shaped stored casts config, instead of returning an empty cast map (HEL-814 D1, narrowing HEL-860 AC3)" in {
      cleanSteps(); val pid = seedPipeline()
      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      await(db.run(sqlu"""
        INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, root_id)
        VALUES ($stepId, $pid, 0, 'cast', '{"casts":[{"field":"amount","to":"double"}]}', true, $pid)
      """))

      // Bound to the mechanism, not just the status: the same raw config the
      // row holds is asserted to raise `StepConfigTypeMismatch` naming the
      // offending key, so this cannot pass for some unrelated 500.
      val thrown = intercept[StepConfigTypeMismatch] {
        CastConfig.decode("""{"casts":[{"field":"amount","to":"double"}]}""")
      }
      thrown.getMessage should include("casts")
      thrown.getMessage should include("got an array")

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.InternalServerError
      }
    }

    // GUARD (HEL-814 task 2.5 / 7.5), sited next to the proof above so the
    // pair is legible in one place: the ABSENT half of HEL-860's read
    // tolerance is untouched. Failable by mutation — make `stringMap` raise
    // on an absent key and this goes red while the proof above stays green.
    "GET /pipelines/:id/steps still returns 200 for a stored cast row that OMITS casts entirely (absence stays tolerant)" in {
      cleanSteps(); val pid = seedPipeline()
      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      await(db.run(sqlu"""
        INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, root_id)
        VALUES ($stepId, $pid, 0, 'cast', '{}', true, $pid)
      """))

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[Vector[PipelineStepResponse]].head.asInstanceOf[CastStepResponse]
        resp.config.casts shouldBe empty
      }
    }
  }

  // HEL-911 evaluation-1.md CR5 (cycle 2): the write-time lane-reference arm -- contract
  // item 6a's security boundary -- was entirely untested at the route layer. Every case
  // here is verified (change record) to have FAILED against the pre-existing code (the
  // `laneCheckF`/`validateLaneReference` wiring added in cycle 1 had no direct test).
  private def laneUnionReq(parentStepId: String, laneStepId: String): JsObject =
    reqWithParentStepId(
      JsObject(
        "type" -> JsString("union"),
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(laneStepId)),
          "mode"           -> JsString("byPosition")
        )
      ),
      parentStepId
    )

  "PipelineStepRoutes -- lane-kind secondaryInput write-time validation (evaluation-1.md CR5)" should {

    "POST rejects a lane stepId belonging to ANOTHER user's pipeline, naming it (CR5a)" in {
      cleanSteps(); val pid = seedPipeline()
      val rootId = { val id = seedRootStep(pid, "rename", """{"renames":{}}""", 0); id }

      // A second pipeline, owned by a DIFFERENT user, with its own step.
      import PostgresProfile.api._
      val foreignPid = UUID.randomUUID().toString
      val foreignDs  = UUID.randomUUID().toString
      val foreignStepId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO users (id, email, created_at)
               VALUES ('00000000-0000-0000-0000-000000000002'::uuid, 'viewer@test.local', now())
               ON CONFLICT DO NOTHING""",
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($foreignDs, 'ds', 'rest_api', '{}', '00000000-0000-0000-0000-000000000002', now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($foreignPid, 'p2', '00000000-0000-0000-0000-000000000002', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($foreignPid, $foreignPid, $foreignDs, 0)""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($foreignStepId, $foreignPid, 0, 'rename', '{"renames":{}}', true, now(), now(), NULL, $foreignPid)"""
      )))

      Post(s"/pipelines/$pid/steps", laneUnionReq(rootId, foreignStepId)) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include (foreignStepId)
      }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]].map(_.id) should not contain foreignStepId
        responseAs[Vector[PipelineStepResponse]] should have size 1 // only rootId; the union was NOT persisted
      }
    }

    "POST rejects a lane stepId that does not exist, naming it (CR5a)" in {
      cleanSteps(); val pid = seedPipeline()
      val rootId = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      Post(s"/pipelines/$pid/steps", laneUnionReq(rootId, "does-not-exist")) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include ("does-not-exist")
      }
    }

    "POST rejects a lane stepId naming the new step's own ancestor, 400 naming the cycle (CR5a)" in {
      cleanSteps(); val pid = seedPipeline()
      val rootId = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      // The new union step's parent IS rootId -- referencing rootId as its own lane input is
      // a cycle (rootId is its ancestor).
      Post(s"/pipelines/$pid/steps", laneUnionReq(rootId, rootId)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String].toLowerCase should include ("cycle")
      }
    }

    "POST accepts a lane stepId naming a valid sibling-lane node in THIS pipeline (201) (CR5a)" in {
      cleanSteps(); val pid = seedPipeline()
      val rootId = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      val laneBId = seedRootStep(pid, "rename", """{"renames":{}}""", 1) // sibling lane, not an ancestor
      Post(s"/pipelines/$pid/steps", laneUnionReq(rootId, laneBId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse].asInstanceOf[UnionStepResponse]
        resp.config.secondaryInput shouldBe SecondaryInput.Lane(laneBId)
      }
    }

    "PATCH rejects a lane stepId naming a nonexistent step, naming it (CR5a, updateStep arm)" in {
      cleanSteps(); val pid = seedPipeline()
      val rootId = seedRootStep(pid, "rename", """{"renames":{}}""", 0)
      var unionId = ""
      val laneBId = seedRootStep(pid, "rename", """{"renames":{}}""", 1)
      Post(s"/pipelines/$pid/steps", laneUnionReq(rootId, laneBId)) ~> routes ~> check {
        unionId = responseAs[PipelineStepResponse].id
      }
      val patchBody = JsObject(
        "config" -> JsObject(
          "secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("does-not-exist")),
          "mode"           -> JsString("byPosition")
        )
      )
      Patch(s"/pipeline-steps/$unionId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        responseAs[String] should include ("does-not-exist")
      }
    }
  }
}
