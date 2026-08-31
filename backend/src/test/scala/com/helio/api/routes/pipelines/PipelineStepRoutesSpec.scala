package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.{CastConfig, StepConfigTypeMismatch}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.api._
import com.helio.api.protocols.pipelines.{CastStepResponse, ComputeStepResponse, LookupStepResponse, PipelineStepResponse, RenameStepResponse, SelectStepResponse, UnionStepResponse}
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
      
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, created_at, updated_at) VALUES ($pid, 'p', $dsId, now(), now())"""
    )))
    pid
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
      "rightDataSourceId" -> JsString(rightDsId),
      "joinKey"           -> JsString("id"),
      "joinType"          -> JsString("inner")
    )
  )
  private def unionReq(otherDsId: String): JsObject = JsObject(
    "type" -> JsString("union"),
    "config" -> JsObject(
      "otherDataSourceId" -> JsString(otherDsId),
      "mode"              -> JsString("byPosition")
    )
  )
  private def lookupReq(referenceDsId: String): JsObject = JsObject(
    "type" -> JsString("lookup"),
    "config" -> JsObject(
      "referenceDataSourceId" -> JsString(referenceDsId),
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

  // Exact request body the "+ Add transformation step" picker sends on lookup-step
  // creation — frontend/src/features/pipelines/state/stepNarrowing.ts's
  // defaultConfigFor("lookup"). HEL-386 change request 2 regression coverage.
  private def lookupDefaultReq(): JsObject = JsObject(
    "type" -> JsString("lookup"),
    "config" -> JsObject(
      "referenceDataSourceId" -> JsString(""),
      "sourceKey"             -> JsString(""),
      "lookupKey"             -> JsString(""),
      "columns"               -> JsArray()
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
      }
    }

    "POST auto-increments position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineStepResponse].position shouldBe 1
      }
    }

    "GET returns steps ordered by position" in {
      cleanSteps(); val pid = seedPipeline()
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { status shouldBe StatusCodes.Created }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps should have size 2
        steps.map(_.position) shouldBe Vector(0, 1)
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

    "DELETE removes a step and returns 204" in {
      cleanSteps(); val pid = seedPipeline()
      var stepId = ""
      Post(s"/pipelines/$pid/steps", castReq()) ~> routes ~> check {
        val r = responseAs[PipelineStepResponse]
        stepId = r.id
        r shouldBe a [CastStepResponse]
      }
      Delete(s"/pipeline-steps/$stepId") ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        responseAs[Vector[PipelineStepResponse]] shouldBe empty
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
          "otherDataSourceId" -> JsString(otherUserDsId),
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
        union.get.config.otherDataSourceId shouldBe ownDsId
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
          "referenceDataSourceId" -> JsString(otherUserDsId),
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
        lookup.get.config.referenceDataSourceId shouldBe ownDsId
      }
    }

    // HEL-386 evaluation-1.md change request 1+2 (regression): the "+ Add transformation
    // step" picker POSTs defaultConfigFor("lookup") — an entirely empty config, including
    // referenceDataSourceId: "". This MUST succeed (201) with the reference source left
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
        lookup.config.referenceDataSourceId shouldBe ""
      }
    }

    // Same regression, PATCH half: clearing an already-set reference source back to "" must
    // stay allowed (it's un-setting a draft, not referencing a cross-user source).
    "PATCH lookup step config to an empty referenceDataSourceId stays allowed (200)" in {
      cleanSteps(); val pid = seedPipeline()
      val ownDsId = seedDataSource("00000000-0000-0000-0000-000000000001")
      var stepId = ""
      Post(s"/pipelines/${pid}/steps", lookupReq(ownDsId)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        stepId = responseAs[PipelineStepResponse].id
      }

      val patchBody = JsObject(
        "config" -> JsObject(
          "referenceDataSourceId" -> JsString(""),
          "sourceKey"             -> JsString("code"),
          "lookupKey"             -> JsString("code"),
          "columns"               -> JsArray(JsString("label"))
        )
      )
      Patch(s"/pipeline-steps/$stepId", patchBody) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineStepResponse]
        val lookup = resp.asInstanceOf[LookupStepResponse]
        lookup.config.referenceDataSourceId shouldBe ""
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


    "PUT /pipelines/:id/steps/order reorders steps and reindexes positions 0..n-1" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB, idC = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", castReq())   ~> routes ~> check { idC = responseAs[PipelineStepResponse].id }

      val body = JsObject("stepIds" -> JsArray(JsString(idC), JsString(idA), JsString(idB)))
      Put(s"/pipelines/$pid/steps/order", body) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idC, idA, idB)
        steps.map(_.position) shouldBe Vector(0, 1, 2)
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
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

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

    // ── HEL-410: POST /pipelines/:id/steps with optional `position` (insert-at) ──

    "POST with position: 0 inserts before all existing steps and shifts them down" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 0)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.position shouldBe 0
        newId = resp.id
      }

      // Persists and survives reload — a subsequent GET reflects the shifted order.
      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((newId, 0), (idA, 1), (idB, 2))
      }
    }

    "POST with position in the middle shifts only later steps down" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB, idC = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", castReq())   ~> routes ~> check { idC = responseAs[PipelineStepResponse].id }

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(selectReq(), 1)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.position shouldBe 1
        newId = resp.id
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (newId, 1), (idB, 2), (idC, 3))
      }
    }

    "POST with position equal to the current step count behaves like append" in {
      cleanSteps(); val pid = seedPipeline()
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 2)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.position shouldBe 2
        newId = resp.id
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (idB, 1), (newId, 2))
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
      var idA, idB, idC, idD, idE, idF = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id } // pos 0
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id } // pos 1
      Post(s"/pipelines/$pid/steps", castReq())   ~> routes ~> check { idC = responseAs[PipelineStepResponse].id } // pos 2
      Post(s"/pipelines/$pid/steps", selectReq()) ~> routes ~> check { idD = responseAs[PipelineStepResponse].id } // pos 3
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idE = responseAs[PipelineStepResponse].id } // pos 4
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idF = responseAs[PipelineStepResponse].id } // pos 5

      Delete(s"/pipeline-steps/$idB") ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      Delete(s"/pipeline-steps/$idD") ~> routes ~> check { status shouldBe StatusCodes.NoContent }
      Delete(s"/pipeline-steps/$idE") ~> routes ~> check { status shouldBe StatusCodes.NoContent }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (idC, 2), (idF, 5))
      }

      var newId = ""
      Post(s"/pipelines/$pid/steps", reqWithPosition(castReq(), 1)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        newId = responseAs[PipelineStepResponse].id
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(s => (s.id, s.position)) shouldBe Vector((idA, 0), (newId, 1), (idC, 2), (idF, 3))
      }
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
      var idA, idB = ""
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check { idA = responseAs[PipelineStepResponse].id }
      Post(s"/pipelines/$pid/steps", filterReq()) ~> routes ~> check { idB = responseAs[PipelineStepResponse].id }

      var cloneId = ""
      Post(s"/pipeline-steps/$idA/duplicate") ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val resp = responseAs[PipelineStepResponse]
        resp.`type` shouldBe "rename"
        resp.enabled shouldBe true
        resp.position shouldBe 1
        cloneId = resp.id
        cloneId should not be idA
      }

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        val steps = responseAs[Vector[PipelineStepResponse]]
        steps.map(_.id) shouldBe Vector(idA, cloneId, idB)
        steps.map(_.position) shouldBe Vector(0, 1, 2)
      }
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
        INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled)
        VALUES ($stepId, $pid, 0, 'cast', '{"casts":[{"field":"amount","to":"double"}]}', true)
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
        INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled)
        VALUES ($stepId, $pid, 0, 'cast', '{}', true)
      """))

      Get(s"/pipelines/$pid/steps") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[Vector[PipelineStepResponse]].head.asInstanceOf[CastStepResponse]
        resp.config.casts shouldBe empty
      }
    }
  }
}
