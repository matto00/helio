package com.helio.services.proposals

import com.helio.api.JsonProtocols
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.api.protocols.proposals.{CombinedProposal, DashboardProposal, ProposalPanel, ProposalPanelLayout}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload, StaticDataSourceRequest}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialRepository, ResourcePermissionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{OutputControlsValidator, PanelService}
import com.helio.services.patchsets.{PatchSetApplyService, PatchSetPreviewService}
import com.helio.services.pipelines.{PipelineProposalService, PipelineRunService, PipelineService}
import com.helio.services.ratelimit.{InMemoryRateLimiter, SourceFetchBudget}
import com.helio.services.sources.{ContentSourceSupport, DataSourceService, SourceService}
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.jdk.CollectionConverters._

/** HEL-1638 D6: the propose/apply parity corpus. Every entry builds a fresh fixture (its own user, its own sources), runs the
 *  propose-side check (`validate`, or `preview` for a patch set) AND the real apply (real `PipelineService`, real run service,
 *  real panel/dashboard services) and asserts: accepted iff accepted, and every rejection carries the same message (the one
 *  documented exception is the fetch-failure reword, where propose names the fetch failure and apply's check sees the same).
 *  A rejected apply must also have written no pipeline. The embedded Postgres is private to this spec and discarded in
 *  `afterAll`; every entry uses its own freshly inserted user, so no row is shared between entries.
 *
 *  The discriminating `url`-root `queryParams`/`parameters` entry (C10) is `ProposalDryRunRestSchemaSpec`'s "issue the same
 *  composed request as apply's create" test, which records the composed request from a real local HTTP stub for the dry run
 *  and for `createRest` and fails if they differ; it is not duplicated here. */
class ProposalDryRunParitySpec
    extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with JsonProtocols with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres        = _
  private var db: JdbcBackend.Database                  = _
  private var dataSourceService: DataSourceService      = _
  private var pipelineProposalService: PipelineProposalService = _
  private var combinedService: CombinedProposalService  = _
  private var dashboardProposalService: DashboardProposalService = _
  private var applyService: PatchSetApplyService        = _
  private var previewService: PatchSetPreviewService    = _
  private var pipelineRepo: PipelineRepository          = _
  private var binding: Http.ServerBinding               = _
  private var port: Int                                 = _

  private val seen = new ConcurrentLinkedQueue[String]()
  private def recorded: Vector[String] = seen.asScala.toVector

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    val route =
      pathPrefix("boom") {
        extractRequest { req => seen.add(req.uri.path.toString); complete(StatusCodes.InternalServerError, "nope") }
      } ~ pathPrefix("items") {
        extractRequest { req =>
          seen.add(req.uri.path.toString)
          complete(HttpEntity(ContentTypes.`application/json`, """[{"id":1,"name":"x"}]"""))
        }
      }
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(route), 10.seconds)
    port    = binding.localAddress.getPort

    val dashboardRepo  = new DashboardRepository(ctx)
    val panelRepo      = new PanelRepository(ctx)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val permissionRepo = new ResourcePermissionRepository(ctx)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)
    val stepRepo       = new PipelineStepRepository(ctx)
    val outputRepo     = new OutputRepository(ctx)
    val credRepo       = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))
    val connectorRepo  = new ConnectorRepository(ctx, credRepo)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard",   id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("panel",       id => panelRepo.findByIdInternal(PanelId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("data-source", id => dataSourceRepo.findByIdInternal(DataSourceId(id)).map(_.map(_.ownerId.value))),
      AclResourceType("pipeline",    id => pipelineRepo.findByIdInternal(PipelineId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)

    val fs = new LocalFileSystem(newTempDir("proposal-dry-run-parity"))
    dataSourceService = new DataSourceService(dataSourceRepo, fs, connectorRepo = connectorRepo)
    val admitLocalhost: (String, InetAddress) => Boolean = (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
    val driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)
    val sourceService = new SourceService(dataSourceRepo, driver, connectorRepo = connectorRepo)
    val pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx),
      sourceService = sourceService, dataSourceService = dataSourceService
    )
    val runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new PipelineRunRepository(ctx), new PipelineRunCache, registry = null, fs,
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    )
    val budget = new SourceFetchBudget(new InMemoryRateLimiter(), 1000, 60)
    pipelineProposalService = new PipelineProposalService(sourceService, dataSourceService, pipelineService, runService, dataSourceRepo, outputRepo, budget)

    val dashboardService = new DashboardService(dashboardRepo, accessChecker, outputRepo = outputRepo)
    val panelService     = new PanelService(panelRepo, accessChecker, dashboardRepo, outputRepo = outputRepo, dataSourceRepo = dataSourceRepo, dataSourceService = dataSourceService)
    val controls         = new OutputControlsValidator(outputRepo, new NodeSnapshotRepository(ctx))
    dashboardProposalService = new DashboardProposalService(dashboardService, panelService, outputRepo, controls, dataSourceRepo)
    combinedService          = new CombinedProposalService(pipelineProposalService, dashboardProposalService)

    applyService = new PatchSetApplyService(
      panelService, dashboardService, dataSourceService, pipelineService,
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo,
      accessChecker, new PatchSetApplicationRepository(ctx), outputRepo
    )
    previewFactory = b => new PatchSetPreviewService(
      panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo, sourceService, b
    )
    previewService = previewFactory(budget)
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"parity-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def pipelineCount(owner: AuthenticatedUser): Int = await(pipelineRepo.listSummaries(owner)).size

  /** A caller-owned static dataset source: team (string), wins (integer), losses (integer). */
  private def teamSource(owner: AuthenticatedUser, name: String = "Teams"): String =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest(
        name, "static",
        Vector(StaticColumnPayload("team", "string"), StaticColumnPayload("wins", "integer"), StaticColumnPayload("losses", "integer")),
        Vector(Vector(JsString("a"), JsNumber(1), JsNumber(2)))
      ), owner
    )).fold(e => fail(s"seed source failed: $e"), _.id.value)

  private def existing(id: String, clientId: Option[String] = None) =
    PipelineProposalSource(Some(id), None, None, None, None, None, None, clientId)

  private def restRoot(path: String, clientId: Option[String] = None) =
    PipelineProposalSource(None, Some(DataSourceKind.RestApi), Some("Inline"), None, Some(ProposalRestApiConfig(url = Some(s"http://localhost:$port$path"))), None, None, clientId)

  private def chart(node: Option[String], x: String, y: String, root: Option[String] = None) =
    CreatePipelineTransactionalOutputRequest(node, "chart", "Out",
      Some(s"""{"chartType":"bar","fieldMapping":{"xAxis":"$x","yAxis":"$y"}}""".parseJson.asJsObject), root)

  private def step(clientId: String, kind: String, config: String, enabled: Option[Boolean] = None, root: Option[String] = None, parent: Option[String] = None) =
    CreatePipelineTransactionalStepRequest(clientId, kind, config.parseJson.asJsObject, parent, enabled, root)

  private def pipeline(roots: Vector[PipelineProposalSource], steps: Vector[CreatePipelineTransactionalStepRequest], outputs: Vector[CreatePipelineTransactionalOutputRequest]) =
    PipelineProposal(s"P-${UUID.randomUUID()}", roots, steps, outputs)

  // ── corpus machinery ──────────────────────────────────────────────────────────────────────────────────────────────

  private final case class Outcome(accepted: Boolean, message: String)
  private def outcomeOf[A](r: Either[ServiceError, A]): Outcome = r.fold(e => Outcome(false, e.message), _ => Outcome(true, ""))

  /** `accept` is the expected shared verdict; a rejection must include `fragment` and (unless `rewordedFetch`) be identical
   *  on both sides. `rewordedFetch`: the documented fetch-failure reword; both sides must still reject, naming the fetch failure. */
  private final case class Entry(family: String, name: String, accept: Boolean, fragment: String = "", rewordedFetch: Boolean = false)(
      val run: AuthenticatedUser => (Outcome, Outcome, Boolean)
  )

  private def pipelineEntry(name: String, accept: Boolean, fragment: String = "", reworded: Boolean = false)(build: AuthenticatedUser => PipelineProposal) =
    Entry("pipeline", name, accept, fragment, reworded) { owner =>
      val proposal = build(owner)
      val v        = await(pipelineProposalService.validate(proposal, owner))
      val a        = await(pipelineProposalService.apply(proposal, owner))
      (outcomeOf(v), outcomeOf(a), pipelineCount(owner) == 0)
    }

  private def combinedEntry(name: String, accept: Boolean, fragment: String = "")(build: AuthenticatedUser => CombinedProposal) =
    Entry("combined", name, accept, fragment) { owner =>
      val proposal = build(owner)
      val v        = await(combinedService.validate(proposal, owner))
      val a        = await(combinedService.apply(proposal, owner))
      (outcomeOf(v), outcomeOf(a), pipelineCount(owner) == 0)
    }

  private def patchEntry(name: String, accept: Boolean, fragment: String = "")(build: AuthenticatedUser => Edit) =
    Entry("patch-set", name, accept, fragment) { owner =>
      val patchSet = PatchSet(None, Vector(build(owner)))
      val v        = await(previewService.preview(patchSet, owner))
      val a        = await(applyService.apply(patchSet, owner)).flatMap(r => r.failure.toLeft(r).left.map(ServiceError.UnprocessableEntity(_)))
      (outcomeOf(v), outcomeOf(a), pipelineCount(owner) == 0)
    }

  private def sentinelPanel(title: String = "Total", layout: Option[ProposalPanelLayout] = None, outputId: String = CombinedProposalService.OutputRefSentinel): ProposalPanel =
    ProposalPanel(
      title = title, `type` = "output", outputId = Some(outputId), fieldMapping = Some(JsObject("value" -> JsString("team"))),
      aggregation = None, content = None, url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
      seriesColors = None, label = None, unit = None, sort = None, layout = layout, config = None
    )

  private def tablePipeline(sourceId: String, outputs: Int): PipelineProposal =
    pipeline(Vector(existing(sourceId)), Vector.empty, (1 to outputs).map(i => CreatePipelineTransactionalOutputRequest(None, "table", s"Out$i")).toVector)

  private def pipelineCreateEdit(name: String, root: JsObject, column: String): Edit = {
    val patch = JsObject(
      "name"    -> JsString(name),
      "roots"   -> JsArray(root),
      "outputs" -> JsArray(JsObject(
        "kind" -> JsString("chart"), "name" -> JsString("Out"), "rootClientId" -> JsString("r0"),
        "config" -> JsObject("chartType" -> JsString("bar"), "fieldMapping" -> JsObject("xAxis" -> JsString("team"), "yAxis" -> JsString(column)))
      ))
    )
    Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(patch))
  }

  private def inlineStaticRoot(): JsObject = JsObject(
    "type" -> JsString("static"), "name" -> JsString("Inline"), "clientId" -> JsString("r0"),
    "staticConfig" -> JsObject(
      "columns" -> JsArray(JsObject("name" -> JsString("team"), "type" -> JsString("string")), JsObject("name" -> JsString("wins"), "type" -> JsString("integer"))),
      "rows"    -> JsArray(JsArray(JsString("a"), JsNumber(1)))
    )
  )

  private val corpus: Vector[Entry] = Vector(
    // ── pipeline: Output column checks
    pipelineEntry("Output maps a column present at its node (select keeps it)", accept = true) { o =>
      pipeline(Vector(existing(teamSource(o))), Vector(step("sel", "select", """{"fields":["team","wins"]}""")), Vector(chart(Some("sel"), "team", "wins")))
    },
    pipelineEntry("Output maps a column dropped by an upstream select", accept = false, "Available columns: team, wins") { o =>
      pipeline(Vector(existing(teamSource(o))), Vector(step("sel", "select", """{"fields":["team","wins"]}""")), Vector(chart(Some("sel"), "team", "losses")))
    },
    pipelineEntry("Output maps a column that was never in the source", accept = false, "display_name") { o =>
      pipeline(Vector(existing(teamSource(o))), Vector.empty, Vector(chart(None, "team", "display_name")))
    },
    pipelineEntry("disabled step upstream of an Output: a column the source has is accepted", accept = true) { o =>
      pipeline(Vector(existing(teamSource(o))), Vector(step("c", "compute", """{"column":"total","expression":"wins + losses"}""", enabled = Some(false))), Vector(chart(Some("c"), "team", "wins")))
    },
    pipelineEntry("disabled step upstream of an Output: the column it would have produced is rejected", accept = false, "total") { o =>
      pipeline(Vector(existing(teamSource(o))), Vector(step("c", "compute", """{"column":"total","expression":"wins + losses"}""", enabled = Some(false))), Vector(chart(Some("c"), "team", "total")))
    },
    // ── pipeline: fetch-failure rule (rest root whose fetch returns HTTP 500)
    pipelineEntry("failed rest root plus an Output on a healthy root", accept = true) { o =>
      pipeline(Vector(restRoot("/boom", Some("bad")), existing(teamSource(o), Some("good"))), Vector.empty, Vector(chart(None, "team", "wins", Some("good"))))
    },
    pipelineEntry("failed rest root plus a step-produced mapped column", accept = true) { o =>
      pipeline(Vector(restRoot("/boom", Some("bad"))), Vector(step("c", "compute", """{"column":"total","expression":"1 + 1"}""", root = Some("bad"))), Vector(chart(Some("c"), "total", "total")))
    },
    pipelineEntry("failed rest root plus a source column of that root", accept = false, "could not read the source schema", reworded = true) { o =>
      pipeline(Vector(restRoot("/boom", Some("bad")), existing(teamSource(o), Some("good"))), Vector.empty, Vector(chart(None, "team", "wins", Some("bad"))))
    },
    // ── pipeline: inline roots, preflight, cross-owner
    pipelineEntry("inline static root, mapped column exists", accept = true) { _ =>
      val root = PipelineProposalSource(None, Some(DataSourceKind.Static), Some("Inline"), None, None, None,
        Some(StaticDataPayload(Vector(StaticColumnPayload("team", "string"), StaticColumnPayload("wins", "integer")), Vector(Vector(JsString("a"), JsNumber(1))))))
      pipeline(Vector(root), Vector.empty, Vector(chart(None, "team", "wins")))
    },
    pipelineEntry("inline static root, mapped column missing", accept = false, "losses") { _ =>
      val root = PipelineProposalSource(None, Some(DataSourceKind.Static), Some("Inline"), None, None, None,
        Some(StaticDataPayload(Vector(StaticColumnPayload("team", "string"), StaticColumnPayload("wins", "integer")), Vector(Vector(JsString("a"), JsNumber(1))))))
      pipeline(Vector(root), Vector.empty, Vector(chart(None, "team", "losses")))
    },
    pipelineEntry("preflight: two roots and a root-bound Output that names none", accept = false, "rootClientId") { o =>
      pipeline(Vector(existing(teamSource(o, "A"), Some("r1")), existing(teamSource(o, "B"), Some("r2"))), Vector.empty, Vector(chart(None, "team", "wins")))
    },
    pipelineEntry("cross-owner secondary source on a join", accept = false, "Data source not found") { o =>
      val foreign = teamSource(newUser(), "Foreign")
      val join = step("j", "join", s"""{"joinKey":"team","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"$foreign"}}""")
      pipeline(Vector(existing(teamSource(o))), Vector(join), Vector(CreatePipelineTransactionalOutputRequest(Some("j"), "table", "Joined")))
    },
    // ── patch set (preview vs apply)
    patchEntry("patch-set pipeline create, existing-source root, Output maps a missing column", accept = false, "display_name") { o =>
      pipelineCreateEdit(s"PS-${UUID.randomUUID()}", JsObject("sourceId" -> JsString(teamSource(o)), "clientId" -> JsString("r0")), "display_name")
    },
    patchEntry("patch-set pipeline create, inline static root, existing column", accept = true) { _ =>
      pipelineCreateEdit(s"PS-${UUID.randomUUID()}", inlineStaticRoot(), "wins")
    },
    patchEntry("patch-set pipeline create, inline static root, missing column", accept = false, "losses") { _ =>
      pipelineCreateEdit(s"PS-${UUID.randomUUID()}", inlineStaticRoot(), "losses")
    },
    // ── combined (sentinel panels, layout, bindings)
    combinedEntry("sentinel panel with exactly one pipeline Output", accept = true) { o =>
      CombinedProposal(tablePipeline(teamSource(o), 1), DashboardProposal("Sales", Vector(sentinelPanel())))
    },
    combinedEntry("sentinel panel with two pipeline Outputs", accept = false, "created 2 Output(s)") { o =>
      CombinedProposal(tablePipeline(teamSource(o), 2), DashboardProposal("Sales", Vector(sentinelPanel())))
    },
    combinedEntry("overlapping panel layouts", accept = false, "lg") { o =>
      val a = sentinelPanel(layout = Some(ProposalPanelLayout(0, 0, 4, 3)))
      val b = sentinelPanel("Total 2", Some(ProposalPanelLayout(2, 1, 4, 3)))
      CombinedProposal(tablePipeline(teamSource(o), 1), DashboardProposal("Sales", Vector(a, b)))
    },
    combinedEntry("non-sentinel panel bound to a missing Output", accept = false, "not found") { o =>
      CombinedProposal(tablePipeline(teamSource(o), 1), DashboardProposal("Sales", Vector(sentinelPanel(outputId = UUID.randomUUID().toString))))
    },
    // ── dashboard
    Entry("dashboard", "form panel with a duplicate sourceField", accept = false, "duplicate sourceField: team") { owner =>
      val src   = teamSource(owner)
      val field = JsObject("sourceField" -> JsString("team"), "control" -> JsString("text"))
      val form = ProposalPanel(
        title = "Form", `type` = "form", outputId = None, fieldMapping = None, aggregation = None, content = None, url = None,
        orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None, seriesColors = None, label = None, unit = None,
        sort = None, layout = None, config = Some(JsObject("fields" -> JsArray(field, field))), dataSourceId = Some(src)
      )
      val proposal = DashboardProposal("Forms", Vector(form))
      val v = await(dashboardProposalService.validate(proposal, owner))
      val a = await(dashboardProposalService.apply(proposal, owner))
      (outcomeOf(v), outcomeOf(a), true)
    }
  )

  "ProposalDryRunParitySpec corpus" should {
    "span at least 16 proposals across every check family" in {
      corpus.size should be >= 16
      corpus.map(_.name).distinct.size shouldBe corpus.size
      corpus.map(_.family).toSet shouldBe Set("pipeline", "combined", "patch-set", "dashboard")
    }

    corpus.foreach { e =>
      s"agree between propose and apply: ${e.family}: ${e.name}" in {
        val (v, a, nothingLeft) = e.run(newUser())
        withClue(s"validate=$v apply=$a: ") {
          v.accepted shouldBe e.accept
          a.accepted shouldBe e.accept
          if (!e.accept) {
            v.message should include(e.fragment)
            a.message should include(e.fragment)
            if (!e.rewordedFetch) a.message shouldBe v.message
            nothingLeft shouldBe true
          }
        }
      }
    }
  }

  // ── C12: the patch-set preview of a pipeline create with an inline rest root charges the source-fetch budget ──────

  "patch-set preview of a pipeline create with an inline rest root" should {
    "charge the source-fetch budget, and refuse the (N+1)th preview without fetching" in {
      seen.clear()
      val budget = new SourceFetchBudget(new InMemoryRateLimiter(), 2, 60)
      // Same real service graph as the corpus; only the budget differs.
      val svc = withBudget(budget)
      val owner = newUser()
      def edit(): PatchSet = {
        val root = JsObject("type" -> JsString("rest_api"), "name" -> JsString("R"), "clientId" -> JsString("r0"),
          "restConfig" -> JsObject("url" -> JsString(s"http://localhost:$port/items"), "method" -> JsString("GET")))
        // A patch-set pipeline create fetches an inline rest/sql root whenever the create has steps or Outputs, so the edit carries an Output.
        val out = JsObject("kind" -> JsString("chart"), "name" -> JsString("Out"), "rootClientId" -> JsString("r0"),
          "config" -> JsObject("chartType" -> JsString("bar"), "fieldMapping" -> JsObject("xAxis" -> JsString("id"), "yAxis" -> JsString("id"))))
        val patch = JsObject("name" -> JsString(s"C12-${UUID.randomUUID()}"), "roots" -> JsArray(root), "outputs" -> JsArray(out))
        PatchSet(None, Vector(Edit(EditTarget("pipeline", None), "create", None, None, None, None, None, Some(patch))))
      }
      await(svc.preview(edit(), owner)).isRight shouldBe true
      await(svc.preview(edit(), owner)).isRight shouldBe true
      recorded.size shouldBe 2
      val third = await(svc.preview(edit(), owner))
      third.swap.toOption.get shouldBe a[ServiceError.TooManyRequests]
      third.swap.toOption.get.message should include("Source fetch rate limit exceeded")
      recorded.size shouldBe 2
    }
  }

  private var previewFactory: SourceFetchBudget => PatchSetPreviewService = _
  private def withBudget(b: SourceFetchBudget): PatchSetPreviewService = previewFactory(b)
}
