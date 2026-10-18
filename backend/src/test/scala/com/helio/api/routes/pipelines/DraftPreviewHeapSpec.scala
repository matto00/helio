package com.helio.api.routes.pipelines

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.engine.{InProcessPipelineEngine, NodeKey, TreeWalkResult}
import com.helio.domain.model.{AssertionSink, PipelineExecutionContext, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink, WriteBackSink}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.draftpreview.{DraftPreviewConfig, DraftPreviewLimits, DraftPreviewService}
import com.helio.testsupport.DraftPreviewApiFixture
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.lang.management.ManagementFactory
import java.nio.file.{Files, Paths}
import java.nio.charset.StandardCharsets
import java.nio.file.StandardOpenOption
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1630 task 5.10 (design.md D7, owner rulings C6, C7): the memory one in-flight draft preview holds, measured on the worst shapes
 *  the caps allow, so the per-instance in-flight default is a measured number rather than a guess and the per-request bound is
 *  enforced rather than assumed (the draft walk order, the live-cell budget with text priced by length, and the text budget every text-creating step kind emits under), and this spec measures it on the shapes below; it is a measured bound over those
 *  shapes, not a proof over every request the caps allow.
 *
 *  Shapes, each with a body at the 4 MiB cap (one 10,000-row root, a 10,000-row lane, 8 complete 1,000-row sources) and at most 50
 *  enabled steps, every node a 20,000-row frame:
 *   - chain: a lane join at the head, then 49 `compute` steps adding a column each (release keeps about two frames);
 *   - comb: the same join, a 24-step `compute` spine, one `compute` leaf per spine node, the spine child at the HIGHER position so
 *     the old walk order ran the whole spine before any leaf and kept every spine frame (the evaluator's 127 MB shape);
 *   - lane-held: a 20-step `compute` branch (visited first) whose last five frames are each referenced by a late `lookup` lane
 *     step behind a second 20-step branch, so those frames stay alive until the lookups run (the budget refuses a node here: still one
 *     request, still bounded).
 *   - select-held: nineteen chained `select` steps over six columns (each frame is built from scratch, the most heap per cell), each
 *     held for a late `lookup` lane step.
 *   - fresh-chain: the chain with each `compute` step writing a fresh ~300-character string per row (`concat($pad, $i)`): few cells,
 *     much text per cell (evaluation-3's 354 MB shape). The text-weighted budget refuses it from about its 5th step.
 *   - doubling-5 / doubling-6: the join, then `d1 = concat($pad, $pad)` and `dN = concat($d(N-1), $d(N-1))`: about 9 cells per row,
 *     text doubling per step (evaluation-3's 421 MB shape; 6 steps exhaust a 768 MB heap inside ONE node). The node's text budget
 *     stops the step that would pass the request's remaining headroom, while it emits, with the text-limit message.
 *   - split-fan-out / headings-fan-out (owner ruling C8): the fan-out of a 100,000-character text, then `splittext` or `extractheadings`,
 *     which copy the text per row inside one node; their per-segment charge against the node's text budget refuses them with the
 *     text-limit message while they emit (479 KB bodies; "step execution failed" = a swallowed OutOfMemoryError before the fix).
 *   - pivot-fan-out (owner ruling C9): the same fan-out, then `pivot` over the long text, whose per-group column names are fresh copies of
 *     it; their charge against the node's text budget refuses it with the text-limit message ("step execution failed" before the fix).
 *  Method: `System.gc()` x2 then used heap before the request, and again at EVERY node boundary (the `afterNode` hook runs after
 *  the node's frame landed and before the parent is released, so a parent plus its child are both counted), three runs, the
 *  maximum delta over runs and nodes. The assertion is on the maximum over the shapes: it must be at most 96 MB and
 *  `DefaultMaxInFlight` must equal `max(1, min(8, floor(192 MB / maxPeak)))`, where 192 MB is 25 % of the production heap
 *  (about 768 MB: `-XX:MaxRAMPercentage=75.0` in the `Dockerfile` over `--memory=1Gi` in `infra/deploy-backend.sh`).
 *
 *  Setting `HELIO_HEAP_EVIDENCE_PATH` writes the report there, only after every assertion passed; unset (CI) writes nothing. */
class DraftPreviewHeapSpec extends DraftPreviewApiFixture {

  private val memory = ManagementFactory.getMemoryMXBean
  @volatile private var peakInRun: Long                    = 0L
  @volatile private var sampling: Boolean                  = false
  @volatile private var liveCellsOverride: Option[Long]    = None
  private def usedAfterGc(): Long                          = { System.gc(); Thread.sleep(50); System.gc(); memory.getHeapMemoryUsage.getUsed }

  override protected def draftPreviewAfterNode: DraftPreviewService.NodeHook = (_, _) =>
    if (sampling) peakInRun = math.max(peakInRun, usedAfterGc())

  /** The production engine, except that a spec may swap the live-cell budget (the budget-trip and realistic-draft specs). */
  private final class BudgetOverridingEngine(implicit ec: ExecutionContext) extends InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))) {
    override def executeTree(
        rootFrames: Vector[(String, Seq[Row])], steps: Vector[PipelineStep], stepRepo: PipelineStepRepository,
        rootIdOfStep: Map[PipelineStepId, PipelineRootId], dataSourceRepo: DataSourceRepository, assertionSink: AssertionSink,
        truncationSink: TruncationSink, onNodeProgress: (NodeKey, Long) => Unit, writeBackSink: WriteBackSink, ownerUserId: Option[String],
        contextTransform: PipelineExecutionContext => PipelineExecutionContext, externalLanes: Map[String, Seq[Row]],
        onNodeFrame: (NodeKey, Seq[Row]) => Unit, onNodeError: Option[(PipelineStep, Throwable) => Unit], shouldContinue: () => Boolean,
        retainOnly: Option[Set[NodeKey]]
    ): Future[TreeWalkResult] =
      super.executeTree(rootFrames, steps, stepRepo, rootIdOfStep, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink,
        ownerUserId, ctx => { val c = contextTransform(ctx); liveCellsOverride.fold(c)(b => c.copy(maxLiveCells = Some(b))) }, externalLanes, onNodeFrame,
        onNodeError, shouldContinue, retainOnly)
  }

  override protected def draftPreviewEngine(implicit ec: ExecutionContext): Option[InProcessPipelineEngine] = Some(new BudgetOverridingEngine)

  private def padRow(i: Int, key: Int, pad: String): JsObject = jobj("k" -> intCell(key), "i" -> intCell(i), "pad" -> jstr(pad))
  private def compute(id: String, column: String, parent: String, position: Int = 0): JsObject =
    stepJson(id, "compute", jobj("column" -> jstr(column), "expression" -> jstr("i + 1")), Some(parent), position = position)
  private val head = stepJson("s0", "join", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr("lane")), "joinKey" -> jstr("k"), "joinType" -> jstr("inner")))

  private def chainSteps(): Vector[JsObject] = head +: (1 until 50).map(n => compute(s"s$n", s"c$n", s"s${n - 1}")).toVector

  private def combSteps(): Vector[JsObject] = {
    val spine  = (1 to 24).map(n => compute(s"c$n", s"c$n", if (n == 1) "s0" else s"c${n - 1}", position = 1))
    val leaves = (1 to 24).map(n => compute(s"l$n", s"l$n", s"c$n", position = 0))
    head +: (spine ++ leaves).toVector
  }

  private def laneHeldSteps(): Vector[JsObject] = {
    val early   = (1 to 20).map(n => compute(s"e$n", s"e$n", if (n == 1) "s0" else s"e${n - 1}", position = 1))
    val middle  = (1 to 20).map(n => compute(s"m$n", s"m$n", if (n == 1) "s0" else s"m${n - 1}", position = 0))
    val lookups = (16 to 20).map(n => stepJson(s"L$n", "lookup", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr(s"e$n")), "sourceKey" -> jstr("i"),
      "lookupKey" -> jstr("i"), "columns" -> JsArray(jstr(s"e$n"))), Some(if (n == 16) "m20" else s"L${n - 1}")))
    head +: (early ++ middle ++ lookups).toVector
  }

  private def selectHeldSteps(): Vector[JsObject] = {
    val fields  = JsArray(Vector("k", "i", "pad", "side", "a", "b").map(jstr))
    val widen   = Vector(compute("a1", "a", "s0"), compute("a2", "b", "a1"))
    val early   = (1 to 19).map(n => stepJson(s"e$n", "select", jobj("fields" -> fields), Some(if (n == 1) "a2" else s"e${n - 1}"), position = 1))
    val middle  = Vector(compute("m1", "m", "a2"))
    val lookups = (1 to 19).map(n => stepJson(s"L$n", "lookup", jobj("secondaryInput" -> jobj("kind" -> jstr("lane"), "stepId" -> jstr(s"e$n")), "sourceKey" -> jstr("i"),
      "lookupKey" -> jstr("i"), "columns" -> JsArray(jstr("a"))), Some(if (n == 1) "m1" else s"L${n - 1}")))
    (head +: widen) ++ early ++ middle ++ lookups
  }

  private def textCompute(id: String, column: String, expression: String, parent: String): JsObject =
    stepJson(id, "compute", jobj("column" -> jstr(column), "expression" -> jstr(expression)), Some(parent))

  private def freshChainSteps(): Vector[JsObject] = head +: (1 until 50).map(n => textCompute(s"s$n", s"c$n", "concat($pad, $i)", s"s${n - 1}")).toVector

  private def doublingSteps(count: Int): Vector[JsObject] =
    head +: (1 to count).map { n =>
      textCompute(s"d$n", s"d$n", if (n == 1) "concat($pad, $pad)" else s"concat($$d${n - 1}, $$d${n - 1})", if (n == 1) "s0" else s"d${n - 1}")
    }.toVector

  /** One root row carrying a 100,000-character `pad`, a lane of 10,000 rows with the same key: the join fans the row out to 10,000
   *  rows that all SHARE the pad (cheap), and `concat($pad, $pad)` then creates 10,000 distinct 200,000-character texts at once
   *  (4 GB on a heap of any realistic size) inside ONE node, before any post-node check can run. */
  private def fanOutBody(): JsObject = fanOutOf("x" * 100000, textCompute("t1", "t1", "concat($pad, $pad)", "s0"))

  /** The same fan-out of one `text`, then `step` (a kind that copies the text per row: HEL-1630 owner ruling C8, evaluation-4). */
  private def fanOutOf(text: String, step: JsObject): JsObject = {
    val root = rootOf("r", jobj("k" -> intCell(0), "i" -> intCell(0), "pad" -> jstr(text)))
    val lane = jobj("rows" -> JsArray(Vector.tabulate(10000)(i => jobj("k" -> intCell(0), "side" -> intCell(i)))))
    draftBody(Vector(root), Vector(head, step), "lanes" -> jobj("lane" -> lane))
  }

  /** Shape 1 (evaluation-4): `splittext` copies the 100,000-character text (it ends in a space, so `trim` copies) once per row. */
  private def splitTextFanOutBody(): JsObject =
    fanOutOf("x" * 99999 + " ", stepJson("t1", "splittext", jobj("field" -> jstr("pad"), "mode" -> jstr("paragraph")), Some("s0")))

  /** Shape 2 (evaluation-4): `extractheadings` copies the 99,998-character title (a regex group, then `trim`) once per row. */
  private def extractHeadingsFanOutBody(): JsObject =
    fanOutOf("# " + "x" * 99998, stepJson("t1", "extractheadings", jobj("field" -> jstr("pad")), Some("s0")))

  private def bodyOf(steps: Vector[JsObject], padLength: Int): JsObject = {
    val pad     = "x" * padLength
    val root    = rootOf("r", Vector.tabulate(10000)(i => padRow(i, i % 5000, pad)): _*)
    val lane    = jobj("rows" -> JsArray(Vector.tabulate(10000)(i => jobj("k" -> intCell(i % 5000), "side" -> intCell(i)))))
    val sources = JsObject((0 until 8).map(s => s"src$s" -> jobj("rows" -> JsArray(Vector.tabulate(1000)(i => jobj("k" -> intCell(i), "v" -> jstr("secondary-" + i)))), "complete" -> JsTrue)).toMap)
    draftBody(Vector(root), steps, "lanes" -> jobj("lane" -> lane), "sources" -> sources)
  }

  /** The largest pad that keeps the compact body at or under the byte cap. */
  private def bodyAtTheCap(steps: Vector[JsObject]): JsObject = {
    var lo = 0; var hi = 1000
    while (lo < hi) {
      val mid = (lo + hi + 1) / 2
      if (bodyOf(steps, mid).compactPrint.getBytes("UTF-8").length <= DraftPreviewLimits.MaxBodyBytes) lo = mid else hi = mid - 1
    }
    bodyOf(steps, lo)
  }

  private final case class Measured(name: String, deltasMb: Seq[Double], steps: Int, errors: Int, bytes: Int, messages: Vector[String]) {
    def peakMb: Double = deltasMb.max
  }

  private def measure(name: String, steps: Vector[JsObject]): Measured = {
    val body  = bodyAtTheCap(steps)
    val bytes = body.compactPrint.getBytes("UTF-8").length
    bytes should be > (DraftPreviewLimits.MaxBodyBytes * 0.97).toInt
    bytes should be <= DraftPreviewLimits.MaxBodyBytes
    measureBody(name, body)
  }

  private def measureBody(name: String, body: JsObject): Measured = {
    val seed  = seedPipeline()
    val bytes = body.compactPrint.getBytes("UTF-8").length
    val deltas = ArrayBuffer.empty[Double]
    var last   = (0, 0, Vector.empty[String])
    (1 to 3).foreach { _ =>
      peakInRun = 0L
      val before = usedAfterGc()
      sampling = true
      val res = try preview(seed, userA, body) finally sampling = false
      res.status shouldBe StatusCodes.OK
      deltas += (peakInRun - before) / 1048576.0
      last = (res.ofType("step").size, res.ofType("error").size, res.ofType("error").map(_.fields("message").convertTo[String]).distinct)
    }
    Measured(name, deltas.toSeq, last._1, last._2, bytes, last._3)
  }

  /** Shape 3 (evaluation-5, owner ruling C9): `pivot` builds one column name `<values>_<pivot value>` per group, a fresh copy of the
   *  pivot value's text; pivoting on the 100,000-character `pad` over 10,000 `side` groups is 10,000 copies (about 1 GB). */
  private def pivotFanOutBody(): JsObject =
    fanOutOf("x" * 100000, stepJson("t1", "pivot", jobj("index" -> JsArray(Vector(jstr("side"))), "column" -> jstr("pad"), "values" -> jstr("i"), "agg" -> jstr("first")), Some("s0")))

  private def stepIds(res: Preview, t: String) = res.ofType(t).map(_.fields("step").convertTo[String])

  // Measured once, shared by the tests below (each shape is three gc-heavy runs).
  private lazy val shapes: Vector[Measured] = Vector(
    measure("chain", chainSteps()), measure("comb", combSteps()), measure("lane-held", laneHeldSteps()), measure("select-held", selectHeldSteps()),
    measure("fresh-chain", freshChainSteps()), measure("doubling-5", doublingSteps(5)), measure("doubling-6", doublingSteps(6)),
    measureBody("fan-out-text", fanOutBody()), measureBody("split-fan-out", splitTextFanOutBody()),
    measureBody("headings-fan-out", extractHeadingsFanOutBody()), measureBody("pivot-fan-out", pivotFanOutBody())
  )

  "the worst draft-preview shapes" should {
    "stay at or under 96 MB, and fit DefaultMaxInFlight of them in 192 MB" in {
      val maxPeak = shapes.map(_.peakMb).max
      val formula = math.max(1, math.min(8, math.floor(192.0 / maxPeak).toInt))
      val flags   = ManagementFactory.getRuntimeMXBean.getInputArguments.asScala.mkString(" ")
      val report =
        f"""HEL-1630 task 5.10 heap measurement (DraftPreviewHeapSpec)
           |method: System.gc() x2, used heap before the request; again at every node boundary (frame landed, parent not yet released); delta = held - before; three runs per shape
           |live-cell budget (DraftPreviewLimits.MaxLiveCells): ${DraftPreviewLimits.MaxLiveCells}
           |${shapes.map(s => f"shape ${s.name}%-11s body ${s.bytes} bytes, ${s.steps} step lines, ${s.errors} error lines, deltas MB: ${s.deltasMb.map(d => f"$d%.1f").mkString(", ")}; max ${s.peakMb}%.1f${if (s.messages.isEmpty) "" else "; error: " + s.messages.head.take(70)}").mkString("\n")}
           |max over shapes MB: $maxPeak%.1f (bound 96.0)
           |in-flight default = min(8, floor(192 / $maxPeak%.1f)) = ${math.min(8, math.floor(192.0 / maxPeak).toInt)}, floored at 1 = $formula
           |DraftPreviewConfig.DefaultMaxInFlight (production default under test): ${DraftPreviewConfig.DefaultMaxInFlight}
           |JVM flags: $flags
           |maxMemory MB: ${Runtime.getRuntime.maxMemory / 1048576}
           |""".stripMargin
      info(report)
      // The comb evaluates every step: the leaf-first walk order, not the budget, is what keeps it small. The chain's last nodes
      // are 20,000 rows x about 50 columns, so a parent plus child pass the budget from about the 40th step, as a step error and nothing else.
      shapes(0).steps should be >= 30
      shapes(1).steps shouldBe 49
      shapes(1).errors shouldBe 0
      maxPeak should be <= 96.0
      DraftPreviewConfig.DefaultMaxInFlight shouldBe formula
      DraftPreviewConfig.DefaultMaxInFlight shouldBe 2
      sys.env.get("HELIO_HEAP_EVIDENCE_PATH").foreach { path =>
        val target = Paths.get(path)
        Option(target.getParent).foreach(Files.createDirectories(_))
        Files.write(target, report.getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)
      }
    }
  }

  "text priced by length and a node's text budget" should {
    "refuse the fresh-string chain long before its 49th step (cell count alone let it run to its 42nd and hold 354 MB)" in {
      val fresh = shapes(4)
      fresh.steps should be < 20
      fresh.errors shouldBe 1
      fresh.messages.head should (include("Draft preview memory limit") or include("Draft preview text limit"))
      fresh.messages.head should not include "step execution failed"
    }

    "stop the doubling steps inside the node with the text-limit message, not as an exhausted heap or a post-node refusal" in {
      // The doubling shapes keep few cells, so the post-node refusal can also be the one that fires; either is a clean refusal.
      Seq(shapes(5), shapes(6)).foreach { doubling =>
        doubling.errors shouldBe 1
        doubling.messages.head should (include("Draft preview text limit") or include("Draft preview memory limit"))
        doubling.messages.head should not include "step execution failed"
      }
      // One node that would create 10,000 x 200,000 characters (4 GB): only the in-node text budget can refuse it before it allocates.
      val fanOut = shapes(7)
      fanOut.steps shouldBe 1
      fanOut.errors shouldBe 1
      fanOut.messages.head should include("Draft preview text limit")
      fanOut.messages.head should not include "step execution failed"
    }

    "stop splittext and extractheadings over a 10,000-row fan-out of one 100,000-character text inside the node (evaluation-4: 'step execution failed' = OutOfMemoryError in a 768 MB heap)" in {
      Seq(shapes(8), shapes(9)).foreach { copying =>
        copying.steps shouldBe 1
        copying.errors shouldBe 1
        copying.messages.head should include("Draft preview text limit")
        copying.messages.head should not include "step execution failed"
      }
    }

    "stop pivot over a 10,000-group fan-out of one 100,000-character text inside the node (evaluation-5: its column names were uncharged)" in {
      val pivot = shapes(10)
      pivot.steps shouldBe 1
      pivot.errors shouldBe 1
      pivot.messages.head should include("Draft preview text limit")
      pivot.messages.head should not include "step execution failed"
    }
  }

  "the live-cell budget" should {
    "fail a node that would pass it as that step's error line with the memory-limit message, and prune its dependents" in {
      liveCellsOverride = Some(100000L)
      try {
        val res = preview(seedPipeline(), userA, bodyOf(chainSteps().take(4), 10))
        res.status shouldBe StatusCodes.OK
        stepIds(res, "error") shouldBe Vector("s0")
        res.ofType("error").head.fields("message").convertTo[String] should include("Draft preview memory limit")
        stepIds(res, "unavailable") shouldBe Vector("s1", "s2", "s3")
        res.ofType("step") shouldBe empty
      } finally liveCellsOverride = None
    }

    "leave a realistic draft (1,000-row samples, 50 columns, 50 steps) far below it: it runs even at a tenth of the budget" in {
      val cols  = (0 until 50).map(c => s"c$c" -> intCell(c)).toVector
      val root  = rootOf("r", Vector.tabulate(1000)(i => JsObject(cols.toMap + ("c0" -> intCell(i)))): _*)
      val steps = (0 until 50).map(n => limitStep(s"p$n", 1000, if (n == 0) None else Some(s"p${n - 1}"))).toVector
      liveCellsOverride = Some(DraftPreviewLimits.MaxLiveCells / 10)
      try {
        val res = preview(seedPipeline(), userA, draftBody(Vector(root), steps))
        res.status shouldBe StatusCodes.OK
        res.ofType("error") shouldBe empty
        res.ofType("step").size shouldBe 50
      } finally liveCellsOverride = None
    }
  }
}
