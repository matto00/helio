package com.helio.testsupport

import com.helio.api.ApiRoutes
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, NodeSnapshotRepository, OutputHistoryRepository, OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.{OutputHistoryService, OutputService, PipelineService}
import com.helio.infrastructure.persistence.auth.{UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ask.{AskAccess, AskDataService, AskReads}
import com.helio.services.assistant.AssistantModelPolicy
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import org.apache.pekko.NotUsed
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.HttpRequest
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.scaladsl.Source
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.Paths
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** One scripted model hop: reads the request the model "sees" and returns its content blocks. */
object AskScript {
  type Step = ClaudeApiToolRequest => Seq[ClaudeApiContentBlock]

  def text(s: String): ClaudeApiContentBlock = ClaudeApiContentBlock(blockType = "text", text = Some(s))

  /** A thinking block (no visible text), as a model emits before or instead of an answer. */
  def thinking(s: String): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "thinking", text = None, thinking = Some(s), signature = Some("sig"))

  def toolUse(id: String, name: String, input: JsObject): ClaudeApiContentBlock =
    ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some(id), name = Some(name), input = Some(input))

  /** The tool results of the LAST user turn the model is being shown: (tool_use id, text, isError). */
  def lastResults(request: ClaudeApiToolRequest): Vector[(String, String, Boolean)] =
    request.messages.lastOption.toVector.flatMap(_.content).collect {
      case b if b.blockType == "tool_result" => (b.toolUseId.getOrElse(""), b.text.getOrElse(""), b.isError.getOrElse(false))
    }

  /** Every `citations` array element anywhere in a tool result's JSON. */
  def citations(result: String): Vector[JsObject] = {
    def walk(v: JsValue): Vector[JsObject] = v match {
      case JsObject(fs) =>
        fs.get("citations").collect { case JsArray(es) => es.collect { case o: JsObject => o } }.getOrElse(Vector.empty) ++ fs.values.toVector.flatMap(walk)
      case JsArray(es) => es.flatMap(walk)
      case _           => Vector.empty
    }
    walk(result.parseJson)
  }

  def citeId(result: String, field: String): String =
    citations(result).find(_.fields("field") == JsString(field)).map(_.fields("id").convertTo[String]).getOrElse(sys.error(s"no citation for $field in $result"))

  def obj(fields: (String, JsValue)*): JsObject = JsObject(fields.toMap)
}

/** A scripted transport: hop N runs `steps(min(N, last))` and answers `tool_use` when that step has one, else `end_turn`;
 *  `stopReasons(N)` overrides that derived `stop_reason` for hop N (HEL-1761: `max_tokens`).
 *  Records every request. Echoes the requested model id as the response model. */
final class ScriptedTransport(steps: Vector[AskScript.Step], delayMs: Long = 0L, stopReasons: Map[Int, String] = Map.empty) extends ClaudeTransport {
  private val recorded = new CopyOnWriteArrayList[ClaudeApiToolRequest]()
  private val hops     = new AtomicInteger(0)
  def requests: Vector[ClaudeApiToolRequest] = recorded.asScala.toVector
  def hopCount: Int                          = hops.get()

  override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = Future.failed(new UnsupportedOperationException)
  override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = throw new UnsupportedOperationException
  override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
    recorded.add(request)
    val i      = hops.getAndIncrement()
    val blocks = steps(math.min(i, steps.size - 1))(request)
    val stop   = stopReasons.getOrElse(i, if (blocks.exists(_.blockType == "tool_use")) "tool_use" else "end_turn")
    Future.successful(
      ClaudeApiResponse(id = s"msg$i", content = blocks, stopReason = Some(stop), usage = ClaudeApiUsage(10, 5), model = Some(request.model))
    )
  }
}

/** Swappable transport so one `ApiRoutes` can serve every test of a spec. */
final class SwitchTransport extends ClaudeTransport {
  @volatile var current: ClaudeTransport = new ScriptedTransport(Vector(_ => Seq(AskScript.text("No data."))))
  override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse]            = current.send(request)
  override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = current.stream(request)
  override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]    = current.sendTool(request)
}

/** HEL-1745: DB + wiring harness for the ask specs. The app pool runs as a non-bypass role (see the parent), so every
 *  explicit-SQL gate is proven against real row-level security as well. */
trait AskApiHarness extends OutputInsightApiHarness {

  protected def askEc: ExecutionContext = harnessEc

  protected var askApiTokens: Map[String, String] = Map.empty
  protected val switch: SwitchTransport             = new SwitchTransport

  protected val fakeUserId: String = UUID.randomUUID().toString

  // ----- service-level wiring (no HTTP) -------------------------------------------------------

  protected def askAccess(): AskAccess = {
    implicit val ec: ExecutionContext = askEc
    new AskAccess(accessChecker, outputRepo, new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo), panelRepo)
  }

  protected def askReads(): AskReads = {
    implicit val ec: ExecutionContext = askEc
    new AskReads(outputRepo, panelRepo, snapshotRepo, outputService, historyService)
  }

  /** The same service over repositories that BYPASS row-level security (superuser on both pools: the dev and CI shape),
   *  so a passing test proves the explicit-SQL gates, not RLS. */
  protected def askServiceBypassingRls(transport: ClaudeTransport): AskDataService = {
    implicit val ec: ExecutionContext = askEc
    val superCtx = new DbContext(db, db)
    val ds       = new DataSourceRepository(superCtx)
    val outs     = new OutputRepository(superCtx)
    val panels   = new PanelRepository(superCtx)
    val snaps    = new NodeSnapshotRepository(superCtx)
    val access   = new AskAccess(accessChecker, outs, new PipelineService(new PipelineRepository(superCtx, ds), stepRepo, ds, outputRepo = outs), panels)
    val histSvc  = new OutputHistoryService(outs, new OutputHistoryRepository(superCtx), new NodePayloadHistoryRepository(superCtx))
    val reads    = new AskReads(outs, panels, snaps, new OutputService(outs, panels, accessChecker, nodeSnapshotRepo = snaps), histSvc)
    val client   = new ClaudeClient(ClaudeConfig("sk-ant-test-unused", ClaudeModelCatalog.HaikuId, 1.0, 4096, 100000), transport)
    new AskDataService(client, policyFor(ClaudeModelCatalog.HaikuId), access, reads)
  }

  protected def policyFor(serverDefault: String): AssistantModelPolicy = new AssistantModelPolicy(ClaudeModelCatalog.all, serverDefault)

  protected def askService(transport: ClaudeTransport, serverDefault: String = ClaudeModelCatalog.HaikuId): AskDataService = {
    implicit val ec: ExecutionContext = askEc
    val client = new ClaudeClient(ClaudeConfig("sk-ant-test-unused", serverDefault, 1.0, 4096, 100000), transport)
    new AskDataService(client, policyFor(serverDefault), askAccess(), askReads())
  }

  // ----- HTTP wiring through ApiRoutes ---------------------------------------------------------

  /** The real `ApiRoutes` with every Claude call going to `switch`; `model` is the server default (`CLAUDE_MODEL`). */
  protected def buildAskApi(model: String, configured: Boolean = true): Route = {
    implicit val system: ActorSystem[Nothing] = apiSystem
    implicit val ec: ExecutionContext         = harnessEc
    val sessions = new UserSessionRepository {
      override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
        Future.successful(askApiTokens.get(t).map(uid => AuthenticatedUser(UserId(uid))))
    }
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, new LocalFileSystem(Paths.get("/")),
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(harnessEc), sessions, new UserPreferenceRepository(db)(harnessEc), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(harnessEc),
      dbContext = ctx,
      claudeConfigProvider   = () => if (configured) Right(ClaudeConfig("sk-ant-test-unused", model, 1.0, 4096, 100000)) else Left("no key"),
      claudeTransportFactory = Some(_ => switch)
    ).routes
  }

  protected def askAuthed(req: HttpRequest, userId: String): HttpRequest = {
    val token = s"ask-token-$userId"
    askApiTokens = askApiTokens + (token -> userId)
    req.addHeader(Cookie(SessionCookies.Name -> token)).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
  }

  // ----- seeding -------------------------------------------------------------------------------

  protected def authUser(id: String): AuthenticatedUser = AuthenticatedUser(UserId(id))

  protected def seedBoard(ownerId: String): String = {
    val id = UUID.randomUUID().toString
    awaitDb(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Board', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    id
  }

  protected def seedBoardPanel(dashId: String, ownerId: String, outputId: String, title: String = "Panel", controlsJson: Option[String] = None): String = {
    val panelId = UUID.randomUUID().toString
    val controls = controlsJson.orNull
    awaitDb(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, $title, $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', $outputId, $controls::jsonb, ${ownerId}::uuid)"""
    ))
    panelId
  }

  protected def deletePanel(panelId: String): Unit =
    awaitDb(db.run(sqlu"DELETE FROM panels WHERE id = $panelId"))

  protected def grantBoard(dashId: String, granteeId: String, role: String): Unit =
    awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('dashboard', $dashId, $granteeId::uuid, $role, now())"""))

  protected def revokeBoard(dashId: String, granteeId: String): Unit =
    awaitDb(db.run(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'dashboard' AND resource_id = $dashId AND grantee_id = $granteeId::uuid"))

  protected def publicBoard(dashId: String): Unit =
    awaitDb(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                          VALUES ('dashboard', $dashId, NULL, 'viewer', now())"""))

  /** A root-bound Output with a typed schema on an existing pipeline. */
  protected def addOutput(pipelineId: String, ownerId: String, name: String, kind: OutputKind = OutputKind.Table, schema: Vector[SchemaField] = Vector.empty, config: JsObject = JsObject.empty): Output =
    awaitDb(outputRepo.insertInternal(PipelineId(pipelineId), None, UserId(ownerId), name, kind, config, schema, explicitRootId = Some(PipelineRootId(pipelineId)), actor = AuthenticatedUser(UserId(ownerId))))

  /** Replaces the root-bound node snapshot of the pipeline with `rows` (seed through raw SQL). */
  protected def seedRows(pipelineId: String, rows: Seq[JsObject]): Unit = {
    awaitDb(db.run(sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId"))
    rows.zipWithIndex.foreach { case (row, i) =>
      val body = row.compactPrint
      awaitDb(db.run(sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id) VALUES ($pipelineId, NULL, $i, $body::jsonb, $pipelineId)"""))
    }
  }

  protected def regionRow(region: String, amount: Int, extra: (String, JsValue)*): JsObject =
    JsObject((Seq("region" -> JsString(region), "amount" -> JsNumber(amount)) ++ extra).toMap)

  protected val regionSchema: Vector[SchemaField] = Vector(SchemaField("region", "string"), SchemaField("amount", "integer"))

  /** One summary point per day carrying a metric headline; returns the point ids oldest first. */
  protected def addDailyPoints(outputId: String, pipelineId: String, start: Instant, values: Seq[Double]): Vector[String] = {
    values.zipWithIndex.foreach { case (v, i) => addPoint(outputId, pipelineId, start.plusSeconds(86400L * i), Some(v)) }
    awaitDb(db.run(sql"SELECT id::text FROM output_snapshot_history WHERE output_id = $outputId ORDER BY captured_at".as[String])).toVector
  }

  /** A history point linked to a stored row payload; returns the point id. */
  protected def seedPayloadPoint(outputId: String, pipelineId: String, at: Instant, rowsJson: String): String = {
    val payload = UUID.randomUUID().toString
    val point   = UUID.randomUUID().toString
    val ts      = Timestamp.from(at)
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, byte_size, rows)
             VALUES ($payload::uuid, $pipelineId, NULL, $pipelineId, 'seed', 'manual', $ts, 1, ${rowsJson.length}, $rowsJson::jsonb)""",
      sqlu"""INSERT INTO output_snapshot_history (id, output_id, pipeline_id, node_step_id, root_id, run_id, trigger_source, captured_at, row_count, summary, payload_id)
             VALUES ($point::uuid, $outputId, $pipelineId, NULL, $pipelineId, 'seed', 'manual', $ts, 1, '{"v":1}'::jsonb, $payload::uuid)"""
    )))
    point
  }

  protected def usageToday(userId: String): Int =
    awaitDb(db.run(sql"SELECT COALESCE(SUM(message_count), 0) FROM assistant_daily_usage WHERE user_id = ${userId}::uuid".as[Int].head))
}
