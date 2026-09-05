package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.pipelines.{
  CreatePipelineRequest,
  CreatePipelineRootRequest,
  CreatePipelineTransactionalOutputRequest,
  CreatePipelineTransactionalStepRequest,
  JoinStepResponse,
  PipelineSummaryResponse
}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.WorkspaceContextService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-914 task 7.2 — AC1 end-to-end: one `create_pipeline`-shaped call (`PipelineService.create`,
 *  the same single-call transactional path `create_pipeline` maps onto per `pipelinesHandlers.ts`)
 *  builds a two-root, two-lane pipeline with a `join` rejoin and three Outputs;
 *  `place_outputs`-shaped calls (`PanelService.create`, `type: "output"`) place them;
 *  `get_workspace_context`-shaped call (`WorkspaceContextService.assemble`) reflects the graph.
 *
 *  Asserts the PRODUCED GRAPH (design.md D8) — not merely that each call succeeded:
 *    - both root ids, in request order (from the create response)
 *    - each parentless step's bound root (from `listSteps`)
 *    - the join's resolved second-input node (its `secondaryInput.stepId` rewritten from the
 *      request-scoped clientId to the real persisted step id)
 *    - each Output's node (`outputRepo`'s own `node.stepId`)
 *    - the workspace-context lane tree read back (id/parentId/rootId/op/outputIds per node)
 *
 *  `pipelineService`/`workspaceContextService` are wired WITH a real `outputRepo` (a probe-
 *  confirmed prerequisite: `WorkspaceContextServiceSpec`/`PatchSetUndoServiceSpec` both hit a
 *  silent `laneTree: []`/`boundOutputs: []` bug from a fixture missing this exact wiring). */
class Hel914Ac1EndToEndSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var dashboardRepo: DashboardRepository       = _
  private var panelRepo: PanelRepository               = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var outputRepo: OutputRepository             = _

  private var dashboardService: DashboardService             = _
  private var panelService: PanelService                     = _
  private var dataSourceService: DataSourceService           = _
  private var pipelineService: PipelineService               = _
  private var workspaceContextService: WorkspaceContextService = _

  private val userId = UUID.randomUUID().toString
  private val user   = AuthenticatedUser(UserId(userId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dashboardRepo    = new DashboardRepository(ctx)
    panelRepo         = new PanelRepository(ctx)
    dataSourceRepo    = new DataSourceRepository(ctx)
    permissionRepo    = new ResourcePermissionRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)
    outputRepo        = new OutputRepository(ctx)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker: AccessChecker = new AccessCheckerImpl(permissionRepo, registry)
    val fileSystem = new LocalFileSystem(Files.createTempDirectory("hel914-ac1-e2e-spec"))

    dashboardService = new DashboardService(dashboardRepo, accessChecker)
    panelService      = new PanelService(panelRepo, accessChecker, dashboardRepo, null, outputRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    // outputRepo IS wired (positional slot 6) — required for laneTree's bound-Output lookup and
    // for `create`'s own Output-fieldMapping grounding to work at all.
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, null, null, outputRepo)

    workspaceContextService = new WorkspaceContextService(
      dashboardService, dataSourceService, outputRepo, pipelineService
    )

    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userId::uuid, ${s"u-$userId@helio.test"}, now())"""))
  }

  private def seedStaticSource(name: String, columns: Vector[StaticColumnPayload]): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", columns, Vector.empty), user
    )) match {
      case Right(d) => d.id
      case Left(e)  => fail(s"seedStaticSource($name) failed: $e")
    }

  "AC1: create_pipeline -> place_outputs -> get_workspace_context" should {
    "produce a two-root, two-lane, rejoin graph that reads back correctly at every layer" in {
      // ── Arrange: two roots, each with a distinct schema ──
      val root1Id = seedStaticSource("Orders", Vector(StaticColumnPayload("order_id", "string"), StaticColumnPayload("amount", "string")))
      val root2Id = seedStaticSource("Regions", Vector(StaticColumnPayload("order_id", "string"), StaticColumnPayload("region", "string")))

      val createRequest = CreatePipelineRequest(
        name  = "AC1 pipeline",
        roots = Vector(
          CreatePipelineRootRequest(sourceId = Some(root1Id.value), clientId = Some("r1")),
          CreatePipelineRootRequest(sourceId = Some(root2Id.value), clientId = Some("r2"))
        ),
        steps = Vector(
          // Root 1's own parentless (primary) lane.
          CreatePipelineTransactionalStepRequest(
            clientId = "s1", `type` = "select",
            config       = JsObject("fields" -> JsArray(JsString("order_id"), JsString("amount"))),
            rootClientId = Some("r1")
          ),
          // Root 2's own parentless lane.
          CreatePipelineTransactionalStepRequest(
            clientId = "s2", `type` = "select",
            config       = JsObject("fields" -> JsArray(JsString("order_id"), JsString("region"))),
            rootClientId = Some("r2")
          ),
          // Rejoin: s3 continues s1's lane, joining in s2's lane via a lane-kind secondaryInput.
          CreatePipelineTransactionalStepRequest(
            clientId     = "s3", `type` = "join", parentStepId = Some("s1"),
            config       = JsObject(
              "joinKey"        -> JsString("order_id"),
              "joinType"       -> JsString("inner"),
              "secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("s2"))
            )
          )
        ),
        outputs = Vector(
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("s1"), kind = "table", name = "Root1Output"),
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("s2"), kind = "table", name = "Root2Output"),
          CreatePipelineTransactionalOutputRequest(nodeStepClientId = Some("s3"), kind = "table", name = "JoinedOutput")
        )
      )

      // ── Act 1: create_pipeline ──
      val summary: PipelineSummaryResponse = await(pipelineService.create(createRequest, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"pipelineService.create failed: $e")
      }
      val pipelineId = PipelineId(summary.id)

      // Assert 1: both root ids, in REQUEST order.
      summary.roots.map(_.dataSourceId) shouldBe Vector(root1Id.value, root2Id.value)
      val realRoot1Id = summary.roots(0).id
      val realRoot2Id = summary.roots(1).id

      // Assert 2: each parentless step's bound root.
      val steps = await(pipelineService.listSteps(pipelineId, user)) match {
        case Right(s) => s
        case Left(e)  => fail(s"listSteps failed: $e")
      }
      val selects = steps.filter(_.`type` == "select")
      selects should have size 2
      // Both parentless select steps are position 0 (position is scoped per-parent, and neither
      // has one) -- position cannot distinguish them; their bound root can.
      val s1Resp = selects.find(_.rootId.contains(realRoot1Id)).getOrElse(fail("no select step bound to root 1"))
      val s2Resp = selects.find(_.rootId.contains(realRoot2Id)).getOrElse(fail("no select step bound to root 2"))
      s1Resp.parentStepId shouldBe None
      s2Resp.parentStepId shouldBe None
      s1Resp.rootId shouldBe Some(realRoot1Id)
      s2Resp.rootId shouldBe Some(realRoot2Id)

      // Assert 3: the join's resolved second-input node -- its request-scoped clientId "s2" must
      // have been rewritten to s2's REAL persisted step id.
      val joinResp = steps.collectFirst { case j: JoinStepResponse => j }.getOrElse(fail("no join step in response"))
      joinResp.config.secondaryInput shouldBe SecondaryInput.Lane(s2Resp.id)
      joinResp.parentStepId shouldBe Some(s1Resp.id)

      // ── Assert 4: each Output's node ──
      val outputs = await(outputRepo.listByPipelineInternal(pipelineId))
      outputs should have size 3
      def outputFor(name: String) = outputs.find(_.name == name).getOrElse(fail(s"no Output named $name"))
      outputFor("Root1Output").node.stepId shouldBe Some(PipelineStepId(s1Resp.id))
      outputFor("Root2Output").node.stepId shouldBe Some(PipelineStepId(s2Resp.id))
      outputFor("JoinedOutput").node.stepId shouldBe Some(PipelineStepId(joinResp.id))

      // ── Act 2: place_outputs (one output-kind panel per Output) ──
      val dashboard = await(dashboardService.create(DashboardService.CreateDashboardInput(Some("AC1 dashboard")), user))._1
      for (output <- outputs) {
        await(panelService.create(
          CreatePanelRequest(
            Some(dashboard.id.value), Some(output.name), Some("output"),
            Some(JsObject("outputId" -> JsString(output.id.value)))
          ),
          user
        )) match {
          case Right(_) => ()
          case Left(e)  => fail(s"place_outputs panel for ${output.name} failed: $e")
        }
      }

      // ── Act 3: get_workspace_context ──
      val context = await(workspaceContextService.assemble(user))
      val pipelineEntry = context.pipelines.find(_.id == summary.id).getOrElse(fail("pipeline missing from workspace context"))

      // Assert 5: the lane tree read back -- one node per step, correct parent/root/outputIds.
      pipelineEntry.stepsError shouldBe None
      val laneTree = pipelineEntry.laneTree
      laneTree should have size 3
      def nodeFor(stepId: String) = laneTree.find(_.id == stepId).getOrElse(fail(s"lane tree missing node $stepId"))

      val s1Node = nodeFor(s1Resp.id)
      s1Node.parentId shouldBe None
      s1Node.rootId shouldBe realRoot1Id
      s1Node.op shouldBe "select"
      s1Node.outputIds should contain(outputFor("Root1Output").id.value)

      val s2Node = nodeFor(s2Resp.id)
      s2Node.parentId shouldBe None
      s2Node.rootId shouldBe realRoot2Id
      s2Node.op shouldBe "select"
      s2Node.outputIds should contain(outputFor("Root2Output").id.value)

      val joinNode = nodeFor(joinResp.id)
      joinNode.parentId shouldBe Some(s1Resp.id)
      joinNode.op shouldBe "join"
      joinNode.outputIds should contain(outputFor("JoinedOutput").id.value)
    }
  }
}
