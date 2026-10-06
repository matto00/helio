# HEL-1340 probe: rootId arm of POST /pipelines/:id/steps vs `position`

Verdict: **CONFIRMED** (rootId arm ignores `position` and head-splices).

## Command
`cd backend && nice -n 19 sbt --client "testOnly com.helio.api.routes.pipelines.Hel1340ProbeSpec"` (exit 0). Full log: /tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1340-probe-sbt.log

Result: `Tests: succeeded 3, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.` (3 cases executed, each prints PROBE lines). Probe file deleted after the run (not committed).

Trunk seed in every case: three `POST {type:rename,config:{renames:{}}}` with no rootId/position -> A -> B -> C (A parentless, B.parent=A, C.parent=B). Single-root pipeline, rootId == pipelineId. Note: every step's `position` is 0 (position is sibling-index, not trunk depth); tree order below is by parent links.

Short ids: A=02bc.. B=b300.. C=2ab2.. (case 1); A=ec29.. B=2978.. C=90eb.. (case 2); A=06cf.. B=5d0c.. C=c48e.. (case 3).

## Case 1: `{type, config, rootId, position: 2}`
Request: `{"config":{"renames":{}},"position":2,"rootId":"8cd74a47-dd00-45d1-ac8e-26e6a97bea2c","type":"rename"}`
Response 201: id e30bab78.., no parentStepId, position 0, `reparentedStepIds:["02bcd3ef-baad-49d7-ad8f-2d186d53be8e"]` (= A).
Resulting chain (tree order): NEW(e30b, parent none, rootId set) -> A(02bc, parent NEW) -> B(b300, parent A) -> C(2ab2, parent B).
Landed: HEAD (before A), despite position 2. Reparented: A only.

## Case 2: `{type, config, rootId}` (no position; frontend append shape)
Request: `{"config":{"renames":{}},"rootId":"fc34f9ae-3779-46ab-85cd-db4f8ea6b0f6","type":"rename"}`
Response 201: id 0424ec78.., no parentStepId, `reparentedStepIds:["ec296fb8-9c33-45c5-9bc8-a95e686cd3da"]` (= A).
Resulting chain: NEW(0424, parent none) -> A -> B -> C.
Landed: HEAD, not tail. Reparented: A. So the frontend's append (rootId, no position) head-splices instead of appending.

## Case 3 (control): `{type, config, position: 2}` (no rootId)
Request: `{"config":{"renames":{}},"position":2,"type":"rename"}`
Response 201: id 4e9f3f56.., parentStepId = B (5d0cee5d..), `reparentedStepIds:["c48eb72e-a827-4867-a9a8-d8748ecb632f"]` (= C).
Resulting chain: A -> B -> NEW(4e9f, parent B) -> C(parent NEW).
Landed: between B and C (honors position). Reparented: C only.

## Conclusion
CONFIRMED. With `rootId` present and `parentStepId` absent, `position` is ignored (case 1 with position 2 and case 2 with none produce the identical result): the new step becomes the root's parentless head and the existing head step A is reparented under it (`reparentedStepIds=[A]`). Only the `(None, None)` arm honors `position` (case 3 inserts between B and C). Since the frontend sends `rootId` on every trunk create, a frontend "append" lands at the head of the chain, not the tail.

## Probe source (verbatim)
```scala
package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
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
import com.helio.testkit.HelioRouteTest

class Hel1340ProbeSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var stepRepo: PipelineStepRepository   = _
  private var pipelineRepo: PipelineRepository   = _
  private var dataSourceRepo: DataSourceRepository = _
  private var outputRepo: OutputRepository = _


  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(typedSystem.executionContext)
    outputRepo = new OutputRepository(ctx)
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

  // HEL-973: like `seedRootStep`, but for a NON-default root -- `seedRootStep` hardcodes
  // `root_id = pipeline_id`, which only holds for `seedPipeline`'s own root 0.
  private def seedRootStepForRoot(pid: String, rootId: String, op: String, configJson: String, position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, $pid, $position, $op, $configJson::text, true, now(), now(), NULL, $rootId)"""
    ))
    id
  }

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val viewerUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000002"))

  private def routes: Route = routesFor(dummyUser)

  private def routesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = typedSystem.executionContext
    val service = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)
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

  // HEL-950: `defaultConfigFor("join")` seed shape (the palette seeds this shape on
  // "Join tables" since HEL-958, and agent/MCP and patch-set callers reach the
  // addStep/updateStep path with it too).
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

  private def stepsJson(pid: String): String = {
    var out = ""
    Get(s"/pipelines/$pid/steps") ~> routes ~> check { out = responseAs[String] }
    out
  }

  private def seedTrunk(): (String, String) = {
    cleanSteps(); val pid = seedPipeline()
    Vector("A", "B", "C").foreach { n =>
      Post(s"/pipelines/$pid/steps", renameReq()) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        println(s"PROBE seed $n -> " + responseAs[String])
      }
    }
    println(s"PROBE seeded chain for $pid: " + stepsJson(pid))
    (pid, pid)
  }

  private def runCase(label: String, mk: String => JsObject): Unit = {
    val (pid, rootId) = seedTrunk()
    val body = mk(rootId)
    println(s"PROBE $label REQUEST " + body.compactPrint)
    Post(s"/pipelines/$pid/steps", body) ~> routes ~> check {
      println(s"PROBE $label STATUS " + status)
      println(s"PROBE $label RESPONSE " + responseAs[String])
    }
    println(s"PROBE $label CHAIN " + stepsJson(pid))
  }

  "HEL-1340 probe" should {
    "case 1: rootId + position 2" in {
      runCase("CASE1", r => JsObject(renameReq().fields + ("rootId" -> JsString(r)) + ("position" -> JsNumber(2))))
    }
    "case 2: rootId, no position" in {
      runCase("CASE2", r => JsObject(renameReq().fields + ("rootId" -> JsString(r))))
    }
    "case 3: position 2, no rootId" in {
      runCase("CASE3", _ => JsObject(renameReq().fields + ("position" -> JsNumber(2))))
    }
  }
}
```
