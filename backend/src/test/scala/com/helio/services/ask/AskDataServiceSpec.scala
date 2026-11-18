package com.helio.services.ask

import com.helio.api.JsonProtocols
import com.helio.api.protocols.ask.AskQuestionResponse
import com.helio.api.protocols.pipelines.CreateOutputRequest
import com.helio.domain.model._
import com.helio.infrastructure.ai._
import com.helio.infrastructure.persistence.pipelines.PipelineRootRepository
import com.helio.services.pipelines.OutputService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.AskScript._
import com.helio.testsupport.{AskApiHarness, ScriptedTransport}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.ExecutionContext

/** HEL-1745: the read-only tool loop, scope re-checks, citations, validation, pin. Scripted fake model only. */
class AskDataServiceSpec extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll with AskApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext
  override protected def apiSystem: ActorSystem[Nothing] = typedSystem

  private var owner, viewer, editor, pipeViewer, stranger: String = _
  private var pid, pid2, pid3: String                             = _
  private var rev, hidden, hist, cost, narrative, other: Output   = _
  private var histPoints: Vector[String]                          = _
  private var payloadPoint: String                                = _
  private var board: String                                       = _
  private val start                                               = Instant.parse("2026-11-01T00:00:00Z")

  override def beforeAll(): Unit = {
    super.beforeAll(); startHarness()
    owner = seedUser("owner"); viewer = seedUser("beta"); editor = seedUser("beta"); pipeViewer = seedUser("beta"); stranger = seedUser("beta")
    pid = seedPipelineWithOutput(owner, "table")._1
    pid2 = seedPipelineWithOutput(owner, "table")._1
    pid3 = seedPipelineWithOutput(owner, "table")._1
    rev = addOutput(pid, owner, "Revenue", OutputKind.Table, regionSchema)
    hidden = addOutput(pid, owner, "Hidden", OutputKind.Table, regionSchema)
    narrative = addOutput(pid, owner, "Narrative", OutputKind.Insight, regionSchema)
    hist = addOutput(pid, owner, "Daily revenue", OutputKind.Metric)
    cost = addOutput(pid, owner, "Daily cost", OutputKind.Metric)
    other = addOutput(pid2, owner, "Other", OutputKind.Table, regionSchema)
    seedRows(pid, Seq(regionRow("east", 10), regionRow("east", 20), regionRow("west", 30)))
    seedRows(pid2, Seq(regionRow("north", 5)))
    histPoints = addDailyPoints(hist.id.value, pid, start, (1 to 20).map(d => if (d == 14) 60.0 else 100.0 + d))
    addDailyPoints(cost.id.value, pid, start, (1 to 20).map(d => 10.0 + d))
    payloadPoint = seedPayloadPoint(cost.id.value, pid, Instant.parse("2026-12-31T00:00:00Z"), """[{"region":"PAYLOAD-ROW","amount":7}]""")
    board = seedBoard(owner)
    Seq(rev, hist, cost, narrative, other).foreach(o => seedBoardPanel(board, owner, o.id.value, s"${o.name} panel"))
    grantBoard(board, viewer, "viewer"); grantBoard(board, editor, "editor"); grantBoard(board, pipeViewer, "viewer")
    grantPipeline(pid, editor, "editor"); grantPipeline(pid, pipeViewer, "viewer")
  }

  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def createService = new OutputService(outputRepo, panelRepo, accessChecker, pipelineRootRepo = new PipelineRootRepository(ctx)(harnessEc))(harnessEc)

  private val Q = "Why did revenue dip on the 14th?"

  private def ask(user: String, steps: Vector[Step], scopeId: String = null, question: String = Q, serverDefault: String = ClaudeModelCatalog.HaikuId) = {
    val transport = new ScriptedTransport(steps)
    val result    = awaitDb(askService(transport, serverDefault).ask(AskScope.DashboardScope(Option(scopeId).getOrElse(board)), question, authUser(user)))
    (result, transport)
  }

  private def askStopping(user: String, steps: Vector[Step], stops: Map[Int, String]) = {
    val transport = new ScriptedTransport(steps, stopReasons = stops)
    (awaitDb(askService(transport).ask(AskScope.DashboardScope(board), Q, authUser(user))), transport)
  }

  private def toolNames(r: ClaudeApiToolRequest): Set[String] = r.tools.collect { case t: ClaudeApiTool => t.name }.toSet
  private def idArg(id: String): JsObject                      = obj("outputId" -> JsString(id))
  private def notAvailable(id: String)                         = s"Output $id is not available to this question"
  private def capture(ref: AtomicReference[Vector[(String, String, Boolean)]], next: Seq[ClaudeApiContentBlock] = Seq(text("Nothing found."))): Step =
    r => { ref.set(lastResults(r)); next }

  "scope enforcement (4.1)" should {
    "give a dashboard-only viewer error results for off-board Outputs and payload rows, and no point ids" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val (res, t) = ask(viewer, Vector(
        _ => Seq(
          toolUse("t1", "get_output_rows", idArg(hidden.id.value)),
          toolUse("t2", "get_output_history", idArg(hidden.id.value)),
          toolUse("t3", "get_history_rows", obj("outputId" -> JsString(cost.id.value), "pointId" -> JsString(payloadPoint))),
          toolUse("t4", "get_output_history", idArg(hist.id.value))
        ),
        capture(seen)
      ))
      res.isRight shouldBe true
      toolNames(t.requests.head) should not contain "get_history_rows"
      val byId = seen.get.map(r => r._1 -> r).toMap
      byId("t1")._3 shouldBe true
      byId("t1")._2 shouldBe notAvailable(hidden.id.value)
      byId("t2")._3 shouldBe true
      byId("t3")._3 shouldBe true
      byId("t3")._2 should not include "PAYLOAD-ROW"
      byId("t4")._3 shouldBe false
      byId("t4")._2.parseJson.asJsObject.fields.keySet should not contain "points"
      histPoints.foreach(p => byId("t4")._2 should not include p)
    }

    "give a pipeline grantee point ids and payload access, and offer the tool" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val (_, t) = ask(editor, Vector(_ => Seq(toolUse("t1", "get_output_history", idArg(hist.id.value))), capture(seen)))
      toolNames(t.requests.head) should contain("get_history_rows")
      val points = seen.get.head._2.parseJson.asJsObject.fields("points").convertTo[Vector[JsObject]]
      points.map(_.fields("pointId").convertTo[String]).toSet should contain(histPoints.head)
    }

    "refuse a dashboard-only viewer's payload read even when row-level security is bypassed" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val transport = new ScriptedTransport(Vector(
        _ => Seq(toolUse("t1", "get_history_rows", obj("outputId" -> JsString(cost.id.value), "pointId" -> JsString(payloadPoint))),
                 toolUse("t2", "get_output_rows", idArg(hidden.id.value))),
        capture(seen)
      ))
      awaitDb(askServiceBypassingRls(transport).ask(AskScope.DashboardScope(board), Q, authUser(viewer))).isRight shouldBe true
      seen.get.foreach(_._3 shouldBe true)
      seen.get.foreach(_._2 should not include "PAYLOAD-ROW")
    }

    "serve a stored payload to a pipeline grantee" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(editor, Vector(_ => Seq(toolUse("t1", "get_history_rows", obj("outputId" -> JsString(cost.id.value), "pointId" -> JsString(payloadPoint)))), capture(seen)))
      seen.get.head._3 shouldBe false
      seen.get.head._2 should include("PAYLOAD-ROW")
    }

    "refuse get_history_rows for an editor when the point belongs to another Output" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(editor, Vector(_ => Seq(toolUse("t1", "get_history_rows", obj("outputId" -> JsString(cost.id.value), "pointId" -> JsString(histPoints.head)))), capture(seen)))
      seen.get.head._3 shouldBe true
    }
  }

  "the per-call re-check (4.1b)" should {
    "turn a call into an error once the binding panel is removed between hops" in {
      val d     = seedBoard(owner)
      val panel = seedBoardPanel(d, owner, rev.id.value)
      val seen  = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val (_, _) = ask(owner, Vector(
        _ => Seq(toolUse("a", "get_output_rows", idArg(rev.id.value))),
        r => { lastResults(r).head._3 shouldBe false; deletePanel(panel); Seq(toolUse("b", "get_output_rows", idArg(rev.id.value))) },
        capture(seen)
      ), scopeId = d)
      seen.get.head._3 shouldBe true
      seen.get.head._2 shouldBe notAvailable(rev.id.value)
    }

    "turn a call into an error once the dashboard grant is revoked between hops" in {
      val d = seedBoard(owner)
      seedBoardPanel(d, owner, rev.id.value)
      grantBoard(d, viewer, "viewer")
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(viewer, Vector(
        _ => Seq(toolUse("a", "get_output_rows", idArg(rev.id.value))),
        r => { lastResults(r).head._3 shouldBe false; revokeBoard(d, viewer); Seq(toolUse("b", "get_output_rows", idArg(rev.id.value))) },
        capture(seen)
      ), scopeId = d)
      seen.get.head._3 shouldBe true
    }
  }

  "the citation ledger across one response (4.1c)" should {
    "give two history calls disjoint ids that resolve to their own Output" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(owner, Vector(
        _ => Seq(toolUse("h", "get_output_history", idArg(hist.id.value)), toolUse("c", "get_output_history", idArg(cost.id.value))),
        capture(seen)
      ))
      val byId = seen.get.map(r => r._1 -> citations(r._2)).toMap
      val h    = byId("h"); val c = byId("c")
      h.map(_.fields("id")).toSet.intersect(c.map(_.fields("id")).toSet) shouldBe empty
      h.foreach(_.fields("outputId") shouldBe JsString(hist.id.value))
      c.foreach(_.fields("outputId") shouldBe JsString(cost.id.value))
    }
  }

  "filters through binding panels (4.1d)" should {
    "serve a filter through the second panel that offers the column, and refuse a column neither offers" in {
      val d = seedBoard(owner)
      seedBoardPanel(d, owner, rev.id.value, "plain")
      seedBoardPanel(d, owner, rev.id.value, "filtered", Some("""[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]"""))
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(owner, Vector(
        _ => Seq(
          toolUse("f", "get_output_rows", obj("outputId" -> JsString(rev.id.value), "filter" -> obj("column" -> JsString("region"), "value" -> JsString("east")))),
          toolUse("g", "get_output_rows", obj("outputId" -> JsString(rev.id.value), "filter" -> obj("column" -> JsString("amount"), "value" -> JsString("10")))),
          toolUse("n", "get_output_rows", idArg(rev.id.value))
        ),
        capture(seen)
      ), scopeId = d)
      val byId = seen.get.map(r => r._1 -> r).toMap
      byId("f")._3 shouldBe false
      byId("f")._2.parseJson.asJsObject.fields("pack").asJsObject.fields("head").asJsObject.fields("rows").convertTo[Vector[JsValue]].size shouldBe 2
      byId("g")._3 shouldBe true
      byId("n")._2.parseJson.asJsObject.fields("pack").asJsObject.fields("head").asJsObject.fields("rows").convertTo[Vector[JsValue]].size shouldBe 3
    }
  }

  "the tool list (4.2, 4.9)" should {
    "hold only read tools, no web search, and no sampling or forced-tool fields for any catalog model" in {
      Seq(ClaudeModelCatalog.HaikuId, ClaudeModelCatalog.SonnetId, ClaudeModelCatalog.OpusId).foreach { m =>
        val (_, t) = ask(owner, Vector(_ => Seq(text("Nothing found."))), serverDefault = m)
        val req    = t.requests.head
        toolNames(req) shouldBe Set("list_board_outputs", "get_output_rows", "get_output_history", "get_history_rows")
        for (n <- toolNames(req); w <- Seq("propose", "apply", "create", "update", "delete", "write", "pin", "web_search")) n should not include w
        req.tools.collect { case _: ClaudeApiToolSpec.WebSearch => 1 } shouldBe empty
        req.model shouldBe m
        req.temperature shouldBe None
        val wire = ClaudeProtocol.claudeApiToolRequestFormat.write(req).compactPrint
        Seq("temperature", "top_p", "top_k", "budget_tokens", "tool_choice", "thinking", "web_search").foreach(k => wire should not include k)
      }
    }
  }

  "the day-14 question (4.3)" should {
    "cite the day-14 point with ids disjoint from an earlier tool result" in {
      val rowIds  = new AtomicReference[Set[String]](Set.empty)
      val (res, _) = ask(owner, Vector(
        _ => Seq(toolUse("r", "get_output_rows", idArg(rev.id.value))),
        r => { rowIds.set(citations(lastResults(r).head._2).map(_.fields("id").convertTo[String]).toSet); Seq(toolUse("h", "get_output_history", idArg(hist.id.value))) },
        r => {
          val result = lastResults(r).head._2
          val cs     = citations(result)
          val histIds = cs.map(_.fields("id").convertTo[String]).toSet
          withClue("rows and history ids must be disjoint: ") { histIds.intersect(rowIds.get) shouldBe empty }
          val t = cs.find(c => c.fields("field") == JsString("recent.t") && c.fields("value").convertTo[String].startsWith("2026-11-14")).get
          val v = cs.find(c => c.fields("field") == JsString("recent.value") && c.fields("capturedAt") == t.fields("value")).get
          Seq(text(s"Revenue dipped to 60 [${v.fields("id").convertTo[String]}] on 2026-11-14 [${t.fields("id").convertTo[String]}]."))
        }
      ))
      val resp = res.toOption.get
      resp.citations.exists(c => c.field == "recent.t" && c.date.exists(_.startsWith("2026-11-14"))) shouldBe true
      resp.citedOutputs.map(_.id) shouldBe Vector(hist.id.value)
      resp.answer should include("2026-11-14")
    }
  }

  "answer validation (4.6)" should {
    "retry once with the reasons, then accept a grounded answer" in {
      val (res, t) = ask(owner, Vector(_ => Seq(text("Revenue fell 99 percent.")), _ => Seq(text("I have no figures to quote."))))
      res.isRight shouldBe true
      t.hopCount shouldBe 2
      t.requests(1).messages.last.content.flatMap(_.text).mkString should include("99")
    }

    "return ASK_UNGROUNDED data after a second failure, without the answer text" in {
      val (res, t) = ask(owner, Vector(_ => Seq(text("Revenue fell 99 percent."))))
      t.hopCount shouldBe 2
      res match {
        case Left(AskError.Ungrounded(reasons)) => reasons.exists(_.contains("99")) shouldBe true
        case other                              => fail(s"unexpected $other")
      }
    }
  }

  "the data budget in a loop (4.11)" should {
    "refuse the 7th data call in one response with the budget message" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      ask(owner, Vector(_ => (1 to 7).map(i => toolUse(s"t$i", "get_output_rows", idArg(rev.id.value))), capture(seen)))
      seen.get.count(!_._3) shouldBe 6
      seen.get.filter(_._3).map(_._2) shouldBe Vector(AskCitationLedger.BudgetMessage)
    }
  }

  "truncation (HEL-1761)" should {
    "map a thinking-only max_tokens hop to Truncated, not a BadGateway" in {
      val (res, t) = askStopping(owner, Vector(_ => Seq(thinking("let me think"))), Map(0 -> "max_tokens"))
      res shouldBe Left(AskError.Truncated)
      t.hopCount shouldBe 1
    }

    "map a partial-text max_tokens hop to Truncated even when the cut-off text would validate" in {
      val (res, _) = askStopping(owner, Vector(_ => Seq(text("There is nothing to report."))), Map(0 -> "max_tokens"))
      res shouldBe Left(AskError.Truncated)
    }

    "map a max_tokens corrective hop to Truncated, thinking-only and partial text alike" in {
      val ungrounded: Step = _ => Seq(text("It fell 99 percent."))
      val (a, _) = askStopping(owner, Vector(ungrounded, _ => Seq(thinking("hmm"))), Map(1 -> "max_tokens"))
      a shouldBe Left(AskError.Truncated)
      val (b, _) = askStopping(owner, Vector(ungrounded, _ => Seq(text("There is nothing to report."))), Map(1 -> "max_tokens"))
      b shouldBe Left(AskError.Truncated)
    }

    "ask for 4096 output tokens on every hop, with no thinking or sampling field on the wire" in {
      AskDataService.MaxAnswerTokens shouldBe 4096
      val (_, t) = ask(owner, Vector(
        _ => Seq(toolUse("r", "get_output_rows", idArg(rev.id.value))),
        _ => Seq(text("It fell 99 percent."))
      ))
      t.requests.size shouldBe 3
      t.requests.map(_.maxTokens).distinct shouldBe Vector(4096)
      t.requests.foreach { r =>
        val wire = ClaudeProtocol.claudeApiToolRequestFormat.write(r).compactPrint
        Seq("thinking", "budget_tokens", "temperature", "tool_choice").foreach(k => wire should not include k)
      }
    }
  }

  "the pin fallback (HEL-1761 D6)" should {
    lazy val pins = new AskPinBuilder(accessChecker)(harnessEc)
    // `rev` is a real stored Output (so the create round trip's reads validate); only its node reference is replaced.
    def output(node: NodeRef) = rev.copy(node = node)

    "use the Output's own root id, not the pipeline id, when it differs" in {
      val pin = awaitDb(pins.build(Q, Vector(output(NodeRef(PipelineId(pid), None, Some(PipelineRootId("distinct-root"))))), authUser(owner))).get
      pin.request.fields("rootId") shouldBe JsString("distinct-root")
    }

    "fall back to the pipeline id as root id (and no node step id) when there is no step and no root id" in {
      val pin = awaitDb(pins.build(Q, Vector(output(NodeRef(PipelineId(pid), None, None))), authUser(owner))).get
      pin.request.fields("rootId") shouldBe JsString(pid)
      pin.request.fields.keySet should not contain "nodeStepId"
      val created = awaitDb(createService.create(PipelineId(pid), pin.request.convertTo[CreateOutputRequest], authUser(owner)))
      created.map(_._1.kind) shouldBe Right(OutputKind.Insight)
    }
  }

  "the pin (4.7)" should {
    def cite(result: String, field: String): (String, JsValue) = {
      val c = citations(result).find(_.fields("field") == JsString(field)).get
      c.fields("id").convertTo[String] -> c.fields("value")
    }
    def answerFromRows(outputIds: Seq[String]): Vector[Step] = Vector(
      _ => outputIds.zipWithIndex.map { case (id, i) => toolUse(s"t$i", "get_output_rows", idArg(id)) },
      r => Seq(text(lastResults(r).map { case (_, res, _) => val (id, v) = cite(res, "amount"); s"An amount is $v [$id]." }.mkString(" ")))
    )

    "give an editor a pin that creates an insight Output through the real create path" in {
      val q        = ("Why is the east amount so high? " * 10).trim
      val (res, _) = ask(editor, answerFromRows(Seq(rev.id.value)), question = q)
      val pin      = res.toOption.get.pin.get
      pin.pipelineId shouldBe pid
      val req = pin.request.fields
      req("kind") shouldBe JsString("insight")
      req("name") shouldBe JsString(q.take(80).trim)
      req("rootId") shouldBe JsString(pid)
      req.keySet should not contain "nodeStepId"
      val cfg = req("config").asJsObject.fields
      cfg("prompt") shouldBe JsString(q)
      cfg("refresh") shouldBe JsString("manual")
      cfg("reads").asJsObject.fields("outputs") shouldBe JsArray(JsString(rev.id.value))
      pin.request.compactPrint should not include res.toOption.get.answer
      val created = awaitDb(createService.create(PipelineId(pid), pin.request.convertTo[CreateOutputRequest], authUser(editor)))
      created.map(_._1.kind) shouldBe Right(OutputKind.Insight)
    }

    "give a pipeline viewer, a dashboard-only viewer and a cross-pipeline answer no pin" in {
      ask(pipeViewer, answerFromRows(Seq(rev.id.value)))._1.toOption.get.pin shouldBe None
      ask(viewer, answerFromRows(Seq(rev.id.value)))._1.toOption.get.pin shouldBe None
      ask(owner, answerFromRows(Seq(rev.id.value, other.id.value)))._1.toOption.get.pin shouldBe None
    }

    "drop a cited insight Output from reads, and give no pin when only it is cited" in {
      val both = ask(owner, answerFromRows(Seq(rev.id.value, narrative.id.value)))._1.toOption.get.pin.get
      both.request.fields("config").asJsObject.fields("reads").asJsObject.fields("outputs") shouldBe JsArray(JsString(rev.id.value))
      ask(owner, answerFromRows(Seq(narrative.id.value)))._1.toOption.get.pin shouldBe None
    }
  }

  "the Output scope" should {
    "answer over one Output and refuse any other id" in {
      val seen = new AtomicReference[Vector[(String, String, Boolean)]](Vector.empty)
      val transport = new ScriptedTransport(Vector(
        _ => Seq(toolUse("a", "get_output_rows", idArg(rev.id.value)), toolUse("b", "get_output_rows", idArg(hist.id.value)), toolUse("c", "list_board_outputs", obj())),
        capture(seen)
      ))
      awaitDb(askService(transport).ask(AskScope.OutputScope(rev.id.value), Q, authUser(editor))).isRight shouldBe true
      val byId = seen.get.map(r => r._1 -> r).toMap
      byId("a")._3 shouldBe false
      byId("b")._3 shouldBe true
      byId("c")._2 should include(rev.id.value)
      byId("c")._2 should not include hist.id.value
    }
  }
}
