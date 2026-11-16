package com.helio.eval

import spray.json._

import java.nio.file.{Files, Path, Paths, StandardOpenOption}
import java.time.Instant
import scala.collection.mutable.ListBuffer
import scala.util.Try

/** HEL-1639 D8: the workspace assistant's pipeline-authoring eval. A plain `main` (NOT a ScalaTest suite, so
 *  `sbt testFull` never discovers it) that drives the lane's already-running dev backend over HTTP, one single-message
 *  conversation per case, and records calls, failed calls, proposal/apply outcomes and token cost per case.
 *
 *  It holds no model key and no database connection (HEL-1450): the backend, started by
 *  `scripts/concertino/start-servers.sh` with `CLAUDE_MODEL` and `LOG_FORMAT=json` pinned, does the model calls, and
 *  token usage is read back from that backend's JSON `assistant_tool_loop_outcome` log line by conversation id.
 *
 *  Run (from `backend/`):
 *  {{{
 *    HELIO_ASSISTANT_EVAL=1 HELIO_EVAL_PASSWORD=... sbt "Test/runMain com.helio.eval.AssistantEval <baseUrl> <label> [caseId,...]"
 *  }}}
 *  Environment: `HELIO_EVAL_PASSWORD` (required, never written anywhere), `HELIO_EVAL_EMAIL` (default `matt@helio.dev`),
 *  `HELIO_EVAL_LOG` (the backend log path, required), `HELIO_EVAL_DIR` (where the run record and the spend ledger go),
 *  `HELIO_EVAL_MODEL` (the model id the telemetry must report; default the prod model).
 *
 *  Live spend is capped at [[TotalBudgetUsd]] across ALL runs by the ledger file; the runner stops before a case that
 *  could exceed it. */
object AssistantEval {

  val ExpectedModel: String  = "claude-haiku-4-5-20251001"
  val TotalBudgetUsd: Double = 3.0
  /** Worst-case cost of one case (4 hops of ~25k input + ~3k output at Haiku 4.5 prices is about $0.16; padded). */
  val CaseCostEstimateUsd: Double = 0.30

  final case class EvalCase(id: String, message: String, workspace: String)

  /** The fixed case set (design.md D8, fixed before the baseline). `standings` is the transcript's first request. */
  val Cases: Vector[EvalCase] = Vector(
    EvalCase("standings", "Can you add more charts to my Fantasy Football standings dashboard?", "standings"),
    EvalCase("csv-chart", "Make a bar chart of total revenue by region from my Sales data.", "sales"),
    EvalCase("line-existing", "Add a line chart of revenue by month to my Sales Overview dashboard.", "sales"),
    EvalCase("top-n", "Show me the top 3 regions by total revenue as a bar chart.", "sales"),
    EvalCase("compute-column", "Add a profit column (revenue minus cost) to my Sales data and show the result in a table.", "sales")
  )

  final case class CaseResult(
      id: String,
      conversationId: String,
      stats: TranscriptStats,
      hopBudgetExhausted: Boolean,
      telemetry: Option[Telemetry],
      previewOk: Option[Boolean],
      applied: Option[Boolean],
      detail: String
  ) {
    def standingsPass: Boolean =
      stats.successfulProposes == 1 && previewOk.contains(true) && applied.contains(true) && !hopBudgetExhausted && stats.failedCalls <= 2

    def toJson: JsObject = JsObject(
      "case"               -> JsString(id),
      "conversationId"     -> JsString(conversationId),
      "toolCalls"          -> JsNumber(stats.toolCalls),
      "failedCalls"        -> JsNumber(stats.failedCalls),
      "zeroResultFinds"    -> JsNumber(stats.zeroResultFinds),
      "proposeCalls"       -> JsNumber(stats.proposeCalls),
      "successfulProposes" -> JsNumber(stats.successfulProposes),
      "previewOk"          -> previewOk.fold[JsValue](JsNull)(JsBoolean(_)),
      "applied"            -> applied.fold[JsValue](JsNull)(JsBoolean(_)),
      "hops"               -> JsNumber(stats.hops),
      "hopBudgetExhausted" -> JsBoolean(hopBudgetExhausted),
      "byTool"             -> JsObject(stats.byTool.map { case (k, v) => k -> JsNumber(v) }),
      "finalProposalTool"  -> stats.finalProposal.fold[JsValue](JsNull)(p => JsString(p.toolName)),
      "tokens"             -> telemetry.fold[JsValue](JsNull)(t => JsNumber(t.totalTokens)),
      "inputTokens"        -> telemetry.fold[JsValue](JsNull)(t => JsNumber(t.inputTokens)),
      "outputTokens"       -> telemetry.fold[JsValue](JsNull)(t => JsNumber(t.outputTokens)),
      "costUsd"            -> telemetry.fold[JsValue](JsNull)(t => JsNumber(BigDecimal(t.costUsd).setScale(4, BigDecimal.RoundingMode.HALF_UP))),
      "modelId"            -> telemetry.fold[JsValue](JsNull)(t => JsString(t.modelId)),
      "detail"             -> JsString(detail),
      "assistantFinalText" -> JsString(stats.finalText.take(600))
    )
  }

  def main(args: Array[String]): Unit = {
    if (!sys.env.get("HELIO_ASSISTANT_EVAL").contains("1")) {
      System.err.println("Refusing to run: set HELIO_ASSISTANT_EVAL=1. This runner spends live model money.")
      sys.exit(64)
    }
    if (args.length < 2) {
      System.err.println("usage: AssistantEval <baseUrl> <label> [caseId,caseId,...]")
      sys.exit(64)
    }
    val baseUrl   = args(0)
    val label     = args(1)
    val wanted    = args.drop(2).flatMap(_.split(",")).map(_.trim).filter(_.nonEmpty).toSet
    val cases     = if (wanted.isEmpty) Cases else Cases.filter(c => wanted(c.id))
    val password  = sys.env.getOrElse("HELIO_EVAL_PASSWORD", { System.err.println("HELIO_EVAL_PASSWORD is required"); sys.exit(64) })
    val email     = sys.env.getOrElse("HELIO_EVAL_EMAIL", "matt@helio.dev")
    val logPath   = Paths.get(sys.env.getOrElse("HELIO_EVAL_LOG", { System.err.println("HELIO_EVAL_LOG (the backend log path) is required"); sys.exit(64) }))
    val dir       = Paths.get(sys.env.getOrElse("HELIO_EVAL_DIR", "../openspec/changes/assistant-pipeline-building-fixes/evidence"))
    val model     = sys.env.getOrElse("HELIO_EVAL_MODEL", ExpectedModel)
    Files.createDirectories(dir)

    val http = new EvalHttp(baseUrl)
    val login = http.login(email, password)
    if (!login.ok) { System.err.println(s"BLOCKER: login failed: HTTP ${login.status}"); sys.exit(2) }
    val me = http.get("/api/auth/me")
    val tier = me.jsonOpt.flatMap(EvalJson.str(_, "tier")).getOrElse("unknown")
    println(s"account tier: $tier")
    if (tier != "beta" && tier != "owner") { System.err.println(s"BLOCKER: tier '$tier' may not use chat"); sys.exit(2) }

    val created = new EvalCreated
    val results = ListBuffer.empty[CaseResult]
    var exitCode = 0
    var aborted: Option[String] = None
    try {
      val ledger = new SpendLedger(dir.resolve("eval-spend-ledger.json"))
      val needed = cases.map(_.workspace).toSet
      val standings = if (needed("standings")) Some(EvalWorkspace.seedStandings(http, created)) else None
      val sales     = if (needed("sales")) Some(EvalWorkspace.seedSales(http, created)) else None
      println(s"fixture created: ${created.snapshot.compactPrint}")
      writeRecord(dir, label, baseUrl, results.toVector, created, Vector.empty, aborted)

      val it = cases.iterator
      while (it.hasNext && aborted.isEmpty) {
        val c = it.next()
        if (ledger.total + CaseCostEstimateUsd > TotalBudgetUsd)
          aborted = Some(f"budget guard: spent $$${ledger.total}%.3f of $$$TotalBudgetUsd%.2f; the next case could exceed the cap")
        else {
          val r = runCase(http, c, created, logPath, model)
          results += r
          r.telemetry.foreach(t => ledger.add(label, c.id, t.costUsd))
          println(s"case ${c.id}: calls=${r.stats.toolCalls} failed=${r.stats.failedCalls} proposes=${r.stats.successfulProposes} preview=${r.previewOk} applied=${r.applied} hops=${r.stats.hops} cost=${r.telemetry.map(t => f"$$${t.costUsd}%.4f").getOrElse("?")}")
          if (r.detail.startsWith("ABORT")) aborted = Some(r.detail)
          // Abort guard (D8): the first case must prove the pin and the JSON log before any further model call, and
          // a case with no telemetry line has unmeasured spend, so none is allowed to continue past it.
          if (aborted.isEmpty) {
            if (r.telemetry.isEmpty) aborted = Some(s"abort guard: no assistant_tool_loop_outcome line found for case ${c.id}; its spend is unmeasured")
            else if (results.size == 1 && !r.telemetry.exists(_.modelId == model)) aborted = Some(s"abort guard: backend reports model '${r.telemetry.map(_.modelId).getOrElse("?")}', expected '$model'")
          }
          writeRecord(dir, label, baseUrl, results.toVector, created, Vector.empty, aborted)
        }
      }
      standings.foreach(_ => ())
      sales.foreach(_ => ())
    } catch {
      case e: Throwable =>
        aborted = Some(s"runner error: ${e.getClass.getSimpleName}: ${Option(e.getMessage).getOrElse("").take(300)}")
        exitCode = 1
    } finally {
      val cleanupLines = EvalWorkspace.cleanup(http, created)
      cleanupLines.foreach(println)
      writeRecord(dir, label, baseUrl, results.toVector, created, cleanupLines, aborted)
    }
    aborted.foreach { why => System.err.println(s"STOPPED: $why"); if (exitCode == 0) exitCode = 3 }
    println(s"spent this run: ${f"$$${results.flatMap(_.telemetry).map(_.costUsd).sum}%.4f"}")
    sys.exit(exitCode)
  }

  private def runCase(http: EvalHttp, c: EvalCase, created: EvalCreated, logPath: Path, model: String): CaseResult = {
    val conv = http.post("/api/assistant-conversations", JsObject())
    val conversationId = conv.jsonOpt.flatMap(EvalJson.str(_, "id")).getOrElse("")
    if (!conv.ok || conversationId.isEmpty)
      return CaseResult(c.id, conversationId, emptyStats, hopBudgetExhausted = false, None, None, None, s"ABORT: could not create a conversation (HTTP ${conv.status})")
    // There is no DELETE route for an assistant conversation, so it cannot be cleaned up; its id is recorded instead.
    created.conversations += conversationId
    val reply = http.post(s"/api/assistant-conversations/$conversationId/converse", JsObject("message" -> JsString(c.message)))
    val body  = reply.jsonOpt.getOrElse(JsNull)
    val telemetry = EvalTelemetry.poll(logPath, conversationId)
    if (!reply.ok)
      // A converse ending in a Claude error writes no telemetry line, so its earlier hops' spend is unmeasured (note 4): stop.
      return CaseResult(c.id, conversationId, emptyStats, hopBudgetExhausted = false, telemetry, None, None, s"ABORT: converse failed HTTP ${reply.status}: ${reply.body.take(300)}")
    val stats = EvalTranscript.stats(EvalJson.at(body, "transcript").getOrElse(JsNull))
    val exhausted = EvalJson.at(body, "hopBudgetExhausted").contains(JsBoolean(true))
    val (previewOk, applied, detail) = stats.finalProposal match {
      case None => (None, None, "no successful proposal")
      case Some(p) => applyProposal(http, p, created)
    }
    CaseResult(c.id, conversationId, stats, exhausted, telemetry, previewOk, applied, detail)
  }

  private val emptyStats = TranscriptStats(0, 0, 0, 0, 0, 0, Map.empty, None, "")

  /** Previews (patch sets only: every other proposal kind is validated by the propose call itself) and really applies the
   *  proposal, recording every created id. */
  private def applyProposal(http: EvalHttp, p: ProposalCall, created: EvalCreated): (Option[Boolean], Option[Boolean], String) =
    p.toolName match {
      case "propose_patch_set" =>
        val preview = http.post("/api/patch-sets/preview", p.input)
        if (!preview.ok) (Some(false), None, s"preview HTTP ${preview.status}: ${preview.body.take(300)}")
        else {
          val proposalId = Try(p.resultContent.parseJson).toOption.flatMap(EvalJson.str(_, "proposalId"))
          val withId = (p.input, proposalId) match {
            case (o: JsObject, Some(id)) => JsObject(o.fields + ("proposalId" -> JsString(id)))
            case (other, _)              => other
          }
          val apply = http.post("/api/patch-sets/apply", withId)
          val body  = apply.jsonOpt.getOrElse(JsNull)
          recordPatchSetIds(p.input, body, created)
          val failure = EvalJson.str(body, "failure")
          (Some(true), Some(apply.ok && failure.isEmpty), failure.map(f => s"apply failure: ${f.take(300)}").getOrElse(if (apply.ok) "applied" else s"apply HTTP ${apply.status}: ${apply.body.take(300)}"))
        }
      case "propose_pipeline" =>
        val apply = http.post("/api/pipelines/apply-proposal", p.input)
        val body  = apply.jsonOpt.getOrElse(JsNull)
        recordPipelineIds(body, created)
        (Some(true), Some(apply.ok), if (apply.ok) "applied" else s"apply HTTP ${apply.status}: ${apply.body.take(300)}")
      case "propose_dashboard" =>
        val apply = http.post("/api/dashboards/apply-proposal", p.input)
        val body  = apply.jsonOpt.getOrElse(JsNull)
        EvalJson.str(body, "dashboard", "id").foreach(created.dashboards += _)
        (Some(true), Some(apply.ok), if (apply.ok) "applied" else s"apply HTTP ${apply.status}: ${apply.body.take(300)}")
      case "propose_combined" =>
        val apply = http.post("/api/proposals/apply", p.input)
        val body  = apply.jsonOpt.getOrElse(JsNull)
        EvalJson.at(body, "pipeline").foreach(recordPipelineIds(_, created))
        EvalJson.str(body, "dashboard", "dashboard", "id").foreach(created.dashboards += _)
        (Some(true), Some(apply.ok), if (apply.ok) "applied" else s"apply HTTP ${apply.status}: ${apply.body.take(300)}")
      case other => (None, None, s"unhandled proposal tool $other")
    }

  private def recordPipelineIds(body: JsValue, created: EvalCreated): Unit = {
    EvalJson.str(body, "pipeline", "id").foreach(created.pipelines += _)
    EvalJson.arr(body, "sources").flatMap(EvalJson.str(_, "id")).foreach(created.sources += _)
    EvalJson.arr(body, "outputs").flatMap(EvalJson.str(_, "id")).foreach(created.outputs += _)
  }

  /** Created ids of a patch-set apply, by the kind of the edit at each outcome's index. */
  private def recordPatchSetIds(input: JsValue, applyBody: JsValue, created: EvalCreated): Unit = {
    val edits = EvalJson.arr(input, "edits")
    EvalJson.arr(applyBody, "edits").foreach { outcome =>
      val newId = EvalJson.str(outcome, "newId")
      val idx   = EvalJson.at(outcome, "index").collect { case JsNumber(n) => n.toInt }
      (newId, idx.flatMap(edits.lift)) match {
        case (Some(id), Some(edit)) if EvalJson.str(edit, "op").contains("create") =>
          EvalJson.str(edit, "target", "kind") match {
            case Some("panel")        => created.panels += id
            case Some("output")       => created.outputs += id
            case Some("dashboard")    => created.dashboards += id
            case Some("pipeline")     => created.pipelines += id
            case Some("dataSource")   => created.sources += id
            case _                    => ()
          }
        case _ => ()
      }
    }
  }

  private def writeRecord(dir: Path, label: String, baseUrl: String, results: Vector[CaseResult], created: EvalCreated, cleanup: Vector[String], aborted: Option[String]): Unit = {
    val record = JsObject(
      "label"    -> JsString(label),
      "at"       -> JsString(Instant.now().toString),
      "baseUrl"  -> JsString(baseUrl),
      "aborted"  -> aborted.fold[JsValue](JsNull)(JsString(_)),
      "cases"    -> JsArray(results.map(_.toJson)),
      "created"  -> created.snapshot,
      "cleanup"  -> JsArray(cleanup.map(JsString(_)))
    )
    Files.writeString(dir.resolve(s"eval-run-$label.json"), record.prettyPrint + "\n", StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
  }
}

/** The cumulative live-spend ledger (C1: $3 total across every eval run). Persisted so a later run, or a re-run, sees it. */
final class SpendLedger(file: Path) {
  // C1 depends on this file: one that exists but cannot be read as a ledger STOPS the runner. It is never read as $0 spent.
  private var entries: Vector[JsObject] =
    if (!Files.exists(file)) Vector.empty
    else
      Try(Files.readString(file).parseJson.asJsObject.fields("entries")).toOption.collect { case JsArray(xs) => xs.collect { case o: JsObject => o } }
        .getOrElse(throw new IllegalStateException(s"spend ledger $file exists but is unreadable or corrupt; refusing to run (it cannot be treated as $$0 spent)"))

  def total: Double = entries.flatMap(_.fields.get("usd")).collect { case JsNumber(n) => n.toDouble }.sum

  def add(label: String, caseId: String, usd: Double): Unit = {
    entries = entries :+ JsObject("run" -> JsString(label), "case" -> JsString(caseId), "usd" -> JsNumber(BigDecimal(usd).setScale(4, BigDecimal.RoundingMode.HALF_UP)))
    Files.writeString(file, JsObject("capUsd" -> JsNumber(AssistantEval.TotalBudgetUsd), "totalUsd" -> JsNumber(BigDecimal(total).setScale(4, BigDecimal.RoundingMode.HALF_UP)), "entries" -> JsArray(entries)).prettyPrint + "\n")
  }
}
