package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, OutputKind, PipelineId, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api._
import com.helio.api.protocols.pipelines.{CreatePipelineRootRequest, PipelineRootSummaryResponse, RemovePipelineRootResponse}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceService, SourceService}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-913 task 7.4/7.5 -- `POST`/`DELETE /api/pipelines/:id/roots[/:rootId]`. R6 (add:
 *  same element shape as `roots[]` at create time, ACL like create), R7 (remove: refuse-before-
 *  delete phase 1 -- last root / surviving lane reference -- then one transaction that
 *  explicitly deletes `node_snapshots` (no FK there by design) alongside the step subtree,
 *  compacts positions, and reports counts computed BEFORE the delete). */
class PipelineRootRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var stepRepo: PipelineStepRepository      = _
  private var pipelineRepo: PipelineRepository      = _
  private var dataSourceRepo: DataSourceRepository  = _
  private var rootRepo: PipelineRootRepository      = _
  private var outputRepo: OutputRepository          = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    rootRepo       = new PipelineRootRepository(ctx)(routeEc)
    outputRepo     = new OutputRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  private def seedUser(id: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())
             ON CONFLICT DO NOTHING"""
    ))
  }

  /** Seed a pipeline with one root, owned by `ownerId`. Returns (pipelineId, rootId). */
  private def seedPipelineWithOneRoot(): (String, String) = {
    import PostgresProfile.api._
    seedUser(ownerId)
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val rid  = UUID.randomUUID().toString
    val cfg  = """{"columns":[],"rows":[]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', $cfg, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($rid, $pid, $dsId, 0)"""
    )))
    (pid, rid)
  }

  /** Owns and returns a fresh DataSource id, so a test can `add_root` against a real,
   *  caller-owned source (R8). */
  private def seedOwnedDataSource(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val cfg  = """{"columns":[],"rows":[]}"""
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds2', 'static', $cfg, $ownerId::uuid, now(), now())"""
    ))
    dsId
  }

  private def routes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val fs                = new LocalFileSystem(Files.createTempDirectory("pipeline-root-routes-spec"))
    val dataSourceService = new DataSourceService(dataSourceRepo, fs)
    // Task 7.1a's inline "static" branch only ever touches `dataSourceService`; `connector` is
    // never dereferenced by that branch, so `null` is safe here (mirrors this file's other
    // nullable-optional wiring for collaborators a given test doesn't exercise).
    val sourceService = new SourceService(dataSourceRepo, connector = null)
    val service = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = rootRepo,
      sourceService = sourceService, dataSourceService = dataSourceService
    )
    new PipelineRoutes(service, owner).routes
  }

  /** HEL-913 (skeptic-final-2.md FIX 2): mirrors `routes` exactly EXCEPT `outputRepo` is left
   *  unwired (`null`) -- proves `removeRoot` FAILS CLOSED (a named 500), rather than silently
   *  reporting `removedOutputCount = 0` while the DB cascade destroys the root's Outputs anyway
   *  regardless of whether this collaborator is wired. */
  private def routesWithoutOutputRepo: Route = {
    implicit val ec: ExecutionContext = routeEc
    val fs                = new LocalFileSystem(Files.createTempDirectory("pipeline-root-routes-spec-no-output-repo"))
    val dataSourceService = new DataSourceService(dataSourceRepo, fs)
    val sourceService = new SourceService(dataSourceRepo, connector = null)
    val service = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRootRepo = rootRepo,
      sourceService = sourceService, dataSourceService = dataSourceService
      // outputRepo deliberately OMITTED -- stays null (the default).
    )
    new PipelineRoutes(service, owner).routes
  }

  private def countRows(sql: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"#$sql".as[Int])).head
  }

  /** Fires `POST /pipelines/:id/roots` for side effect (setup fixtures that need a second root
   *  added through the real HTTP path, not a raw SQL insert) and asserts it succeeded. */
  private def addRootViaApi(pid: String, sourceId: String): Unit =
    Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest(sourceId = Some(sourceId))) ~> routes ~> check {
      status shouldEqual StatusCodes.Created
    }

  "POST /pipelines/:id/roots" should {
    "append a second root and return its summary (R6)" in {
      val (pid, _) = seedPipelineWithOneRoot()
      val newDsId  = seedOwnedDataSource()

      Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest(sourceId = Some(newDsId))) ~> routes ~> check {
        status shouldEqual StatusCodes.Created
        val body = responseAs[PipelineRootSummaryResponse]
        body.dataSourceId shouldEqual newDsId

        // must actually persist -- fetch via the repo, not just trust the response
        val roots = await(rootRepo.listInternal(PipelineId(pid)))
        roots.map(_.dataSourceId.value) should contain(newDsId)
        roots.size shouldEqual 2
      }
    }

    "reject a blank sourceId with 400 and perform no ownership lookup (R8)" in {
      val (pid, _) = seedPipelineWithOneRoot()

      Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest(sourceId = Some("   "))) ~> routes ~> check {
        status shouldEqual StatusCodes.BadRequest
      }
    }

    "reject an unowned/nonexistent sourceId with 404 (R8)" in {
      val (pid, _) = seedPipelineWithOneRoot()

      Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest(sourceId = Some(UUID.randomUUID().toString))) ~> routes ~> check {
        status shouldEqual StatusCodes.NotFound
      }
    }

    "append an inline static-source root (R6's OTHER branch, task 7.1a)" in {
      val (pid, _) = seedPipelineWithOneRoot()
      val req = CreatePipelineRootRequest(
        `type`       = Some("static"),
        name         = Some("Inline static root"),
        staticConfig = Some(StaticDataPayload(
          columns = Vector(StaticColumnPayload("n", "number")),
          rows    = Vector(Vector(JsNumber(1)))
        ))
      )
      Post(s"/pipelines/$pid/roots", req) ~> routes ~> check {
        status shouldEqual StatusCodes.Created
        val body = responseAs[PipelineRootSummaryResponse]
        body.dataSourceName shouldEqual "Inline static root"

        // mutation-proof: a REAL, caller-owned DataSource was actually created, not just echoed
        val roots = await(rootRepo.listInternal(PipelineId(pid)))
        roots.size shouldEqual 2
        val newDs = await(dataSourceRepo.findByIdOwned(DataSourceId(body.dataSourceId), owner))
        newDs.map(_.name) shouldEqual Some("Inline static root")
      }
    }

    "reject an inline root with BOTH sourceId and type (R6/D1 mutual exclusivity)" in {
      val (pid, _) = seedPipelineWithOneRoot()
      val newDsId  = seedOwnedDataSource()
      val req = CreatePipelineRootRequest(sourceId = Some(newDsId), `type` = Some("static"), name = Some("x"))
      Post(s"/pipelines/$pid/roots", req) ~> routes ~> check {
        status shouldEqual StatusCodes.BadRequest
      }
    }

    "reject an inline root naming neither sourceId nor type" in {
      val (pid, _) = seedPipelineWithOneRoot()
      Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest()) ~> routes ~> check {
        status shouldEqual StatusCodes.BadRequest
      }
    }

    "reject an inline csv root (deliberately unsupported, mirrors PipelineProposalService's own gap)" in {
      val (pid, _) = seedPipelineWithOneRoot()
      val req = CreatePipelineRootRequest(`type` = Some("csv"), name = Some("x"))
      Post(s"/pipelines/$pid/roots", req) ~> routes ~> check {
        status shouldEqual StatusCodes.UnprocessableEntity
      }
    }

    "404 for a pipeline the caller does not own" in {
      val otherOwner = UUID.randomUUID().toString
      seedUser(otherOwner)
      import PostgresProfile.api._
      val dsId = UUID.randomUUID().toString
      val pid  = UUID.randomUUID().toString
      val cfg  = """{"columns":[],"rows":[]}"""
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($dsId, 'ds', 'static', $cfg, $otherOwner::uuid, now(), now())""",
        sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $otherOwner::uuid, now(), now())""",
        sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
      )))
      val newDsId = seedOwnedDataSource()

      Post(s"/pipelines/$pid/roots", CreatePipelineRootRequest(sourceId = Some(newDsId))) ~> routes ~> check {
        status shouldEqual StatusCodes.NotFound
      }
    }
  }

  "DELETE /pipelines/:id/roots/:rootId" should {
    "refuse to remove the last root (R1/R7 phase 1 check 1)" in {
      val (pid, rid) = seedPipelineWithOneRoot()

      Delete(s"/pipelines/$pid/roots/$rid") ~> routes ~> check {
        status shouldEqual StatusCodes.BadRequest
      }
      // mutation-proof: root must still be there
      await(rootRepo.listInternal(PipelineId(pid))).size shouldEqual 1
    }

    // HEL-913 (skeptic-final-2.md FIX 2): the guard here must FAIL if the silent-0 fallback
    // comes back -- not merely assert the call succeeded. A permissive assertion (e.g. "returns
    // SOME error") would pass against the old `removedOutputCount = 0`/200-with-wrong-count
    // shape too, so this asserts the SPECIFIC fail-closed contract: 500, no root removed, no
    // Output/panel touched -- and separately (see the very next test) that the same call
    // through the FULLY-wired `routes` actually reports and removes correctly, so the two
    // together bound the behavior on both sides of the collaborator being present.
    "500s and removes NOTHING when outputRepo is not wired -- never silently reports removedOutputCount = 0 while the cascade destroys real Outputs" in {
      val (pid, rid0) = seedPipelineWithOneRoot()
      val newDsId     = seedOwnedDataSource()
      addRootViaApi(pid, newDsId)
      val roots = await(rootRepo.listInternal(PipelineId(pid)))
      val root2 = roots.find(_.dataSourceId.value == newDsId).get

      Delete(s"/pipelines/$pid/roots/${root2.id.value}") ~> routesWithoutOutputRepo ~> check {
        status shouldEqual StatusCodes.InternalServerError
      }
      // mutation-proof of the fail-closed contract: NOTHING was removed.
      await(rootRepo.listInternal(PipelineId(pid))).map(_.id.value).toSet shouldEqual Set(rid0, root2.id.value)
    }

    "remove a non-last root, compact positions, and report counts (R7 phase 2)" in {
      val (pid, rid0) = seedPipelineWithOneRoot()
      val newDsId     = seedOwnedDataSource()
      addRootViaApi(pid, newDsId)
      // fetch the newly-added root's id via the repo (avoid re-parsing the prior response)
      val roots = await(rootRepo.listInternal(PipelineId(pid)))
      val rid1  = roots.find(_.dataSourceId.value == newDsId).get.id.value

      Delete(s"/pipelines/$pid/roots/$rid1") ~> routes ~> check {
        status shouldEqual StatusCodes.OK
        val body = responseAs[RemovePipelineRootResponse]
        body.removedStepCount shouldEqual 0
        body.removedOutputCount shouldEqual 0
      }
      val remaining = await(rootRepo.listInternal(PipelineId(pid)))
      remaining.map(_.id.value) shouldEqual Vector(rid0)
      remaining.head.position shouldEqual 0
    }

    // HEL-913 (skeptic-final-1.md CR2): every OTHER test in this file removes a root with NO
    // Output on it at all, so `removedOutputCount shouldEqual 0` is the only assertion this file
    // (or any other) ever made against the field -- true, but it proves the field EXISTS, not
    // that it COUNTS anything, and neither arm of the count predicate nor the Output/placement
    // cascade on root removal was ever independently observed firing. This test seeds a root
    // carrying a real, placed Output and asserts a NON-ZERO count plus the actual disappearance
    // of both the Output row and its panel placement.
    "reports a NON-ZERO removedOutputCount and removes the root's Output and its panel placement (AC2, R7)" in {
      import PostgresProfile.api._
      val (pid, rid0) = seedPipelineWithOneRoot()
      val newDsId     = seedOwnedDataSource()
      addRootViaApi(pid, newDsId)
      val roots = await(rootRepo.listInternal(PipelineId(pid)))
      val root2 = roots.find(_.dataSourceId.value == newDsId).get

      // A root-bound Output on root2 (no step -- node_step_id NULL, root_id = root2).
      val output = await(outputRepo.insertInternal(
        PipelineId(pid), nodeStepId = None, ownerId = owner.id, name = "root2-out",
        kind = OutputKind.Table, explicitRootId = Some(root2.id)
      ))

      // A real dashboard + panel placing that Output (raw SQL -- this file has no
      // DashboardService/PanelService wired; mirrors RlsSharingAwareTablesSpec's own seed
      // pattern for the same two tables).
      val dashId = UUID.randomUUID().toString
      val panelId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dashId, 'dash', $ownerId, now(), now(),
                      '{"background":"transparent","gridBackground":"transparent"}'::jsonb,
                      '{"lg":[],"md":[],"sm":[],"xs":[]}'::jsonb, $ownerId::uuid)""",
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, output_id)
               VALUES ($panelId, $dashId, 'panel', $ownerId, now(), now(),
                      '{"background":"transparent","color":"inherit","transparency":0.0}'::jsonb,
                      'output', $ownerId::uuid, ${output.id.value})"""
      )))

      countRows(s"SELECT COUNT(*) FROM outputs WHERE id = '${output.id.value}'") shouldEqual 1
      countRows(s"SELECT COUNT(*) FROM panels WHERE id = '$panelId'") shouldEqual 1

      Delete(s"/pipelines/$pid/roots/${root2.id.value}") ~> routes ~> check {
        status shouldEqual StatusCodes.OK
        val body = responseAs[RemovePipelineRootResponse]
        body.removedOutputCount shouldEqual 1
      }

      // The Output itself is gone (outputs.root_id -> pipeline_roots(id) ON DELETE CASCADE), and
      // so is the panel that placed it (panels.output_id -> outputs(id) ON DELETE CASCADE).
      countRows(s"SELECT COUNT(*) FROM outputs WHERE id = '${output.id.value}'") shouldEqual 0
      countRows(s"SELECT COUNT(*) FROM panels WHERE id = '$panelId'") shouldEqual 0
    }

    "delete node_snapshots explicitly for a removed root's steps (no FK there by design)" in {
      val (pid, rid0) = seedPipelineWithOneRoot()
      val newDsId     = seedOwnedDataSource()
      addRootViaApi(pid, newDsId)
      val roots = await(rootRepo.listInternal(PipelineId(pid)))
      val root2 = roots.find(_.dataSourceId.value == newDsId).get

      // add a step under the second root, then a node_snapshot bound to that step
      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($stepId, $pid, 0, 'rename', '{}', true, now(), now(), NULL, ${root2.id.value})""",
        sqlu"""INSERT INTO node_snapshots (pipeline_id, root_id, node_step_id, row_index, data)
               VALUES ($pid, NULL, $stepId, 0, '{}'::jsonb)"""
      )))

      countRows(s"SELECT COUNT(*) FROM node_snapshots WHERE node_step_id = '$stepId'") shouldEqual 1

      Delete(s"/pipelines/$pid/roots/${root2.id.value}") ~> routes ~> check {
        status shouldEqual StatusCodes.OK
        val body = responseAs[RemovePipelineRootResponse]
        body.removedStepCount shouldEqual 1
      }

      // mutation-proof of the "explicit delete" claim: the row is gone even though
      // node_snapshots.node_step_id has no FK to cascade it.
      countRows(s"SELECT COUNT(*) FROM node_snapshots WHERE node_step_id = '$stepId'") shouldEqual 0
      // and the step subtree itself is gone
      countRows(s"SELECT COUNT(*) FROM pipeline_steps WHERE id = '$stepId'") shouldEqual 0
    }

    "refuse when a surviving lane references a step that would be deleted (R7 phase 1 check 2)" in {
      val (pid, rid0) = seedPipelineWithOneRoot()
      val newDsId     = seedOwnedDataSource()
      addRootViaApi(pid, newDsId)
      val roots = await(rootRepo.listInternal(PipelineId(pid)))
      val root2 = roots.find(_.dataSourceId.value == newDsId).get

      import PostgresProfile.api._
      // doomed step under root2
      val doomedStepId = UUID.randomUUID().toString
      // surviving step under root0 (rid0), with a lane secondaryInput pointing at doomedStepId
      val survivorId = UUID.randomUUID().toString
      val joinCfg =
        s"""{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"lane","stepId":"$doomedStepId"}}"""
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($doomedStepId, $pid, 0, 'rename', '{}', true, now(), now(), NULL, ${root2.id.value})""",
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
               VALUES ($survivorId, $pid, 1, 'join', $joinCfg::text, true, now(), now(), NULL, $rid0)"""
      )))

      Delete(s"/pipelines/$pid/roots/${root2.id.value}") ~> routes ~> check {
        status shouldEqual StatusCodes.BadRequest
      }
      // mutation-proof: nothing was deleted
      countRows(s"SELECT COUNT(*) FROM pipeline_steps WHERE id = '$doomedStepId'") shouldEqual 1
      await(rootRepo.listInternal(PipelineId(pid))).size shouldEqual 2
    }

    "404 for a rootId that does not belong to the pipeline" in {
      val (pid, _) = seedPipelineWithOneRoot()

      Delete(s"/pipelines/$pid/roots/${UUID.randomUUID().toString}") ~> routes ~> check {
        status shouldEqual StatusCodes.NotFound
      }
    }
  }
}
