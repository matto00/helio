package com.helio.services.pipelines

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, JsonTextLength, NodeKey, RunLimits, TreeWalkResult}
import com.helio.domain.model._
import com.helio.domain.steps._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodePayloadHistoryRepository, NodeSnapshotRepository, OutputHistoryRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.RunServiceHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.dbio.DBIO
import spray.json.{JsBoolean, JsObject}

import java.lang.management.ManagementFactory
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths, StandardOpenOption}
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1660 task 3.3 (owner ruling 3, design.md D6): the heap one run holds, measured END TO END through the service run path
 *  (`PipelineRunService` -> `PipelineRunExecutor` -> `PipelineRunSucceededWrites`) with real snapshot and history repositories, on the
 *  worst shapes the limits allow, so [[RunLimits.MaxLiveCells]] is a measured number and not a guess.
 *
 *  Method: `System.gc()` x2 then the used heap before the run, and again (a) at every node boundary (the node's frame has landed and its
 *  parent is not yet released: the engine's peak) and (b) right before each node's snapshot write, when the retained frames, the
 *  run's `jsRows` and that node's `nodeJsRows` all coexist: the post-walk peak. The reading is the maximum over those samples minus the
 *  "before" reading, in MB. Every shape runs as a real run and as a dry run, one shape at a time. A shape the limits refuse is measured
 *  too: the refusal must come BEFORE the heap does.
 *
 *  The two "just under budget" shapes are sized from [[RunLimits.MaxLiveCells]] so the walk's held cells end just below it, text-light
 *  (many cells: the worst case for the per-cell JSON copies) and text-heavy in BOTH storage widths: Latin-1 (`just-under-heavy`, one byte a character) and UTF-16 (`heavy-utf16`, `heavy-utf16-2out`, two bytes a character, which is what `CellWeight` prices; a Latin-1-only shape halves the real cost). The assertion is on the maximum over all shapes:
 *  at most 25% of the 768 MB production heap, 192 MB. Setting `HELIO_HEAP_EVIDENCE_PATH` writes the report there after the assertions pass. */
class RunPathHeapSpec extends AnyWordSpec with Matchers with RunServiceHarness {

  private val memory = ManagementFactory.getMemoryMXBean
  @volatile private var sampling = false
  @volatile private var peak     = 0L
  private def usedAfterGc(): Long = { System.gc(); Thread.sleep(40); System.gc(); memory.getHeapMemoryUsage.getUsed }
  private val sampleLock          = new Object
  private def sample(): Unit      = if (sampling) sampleLock.synchronized { peak = math.max(peak, usedAfterGc()) }

  private final class SamplingEngine(fs: LocalFileSystem) extends InProcessPipelineEngine(fs) {
    override def executeTree(
        rootFrames: Vector[(String, Seq[Row])], steps: Vector[PipelineStep], stepRepo: PipelineStepRepository,
        rootIdOfStep: Map[PipelineStepId, PipelineRootId], dataSourceRepo: DataSourceRepository, assertionSink: AssertionSink,
        truncationSink: TruncationSink, onNodeProgress: (NodeKey, Long) => Unit, writeBackSink: WriteBackSink, ownerUserId: Option[String],
        contextTransform: PipelineExecutionContext => PipelineExecutionContext, externalLanes: Map[String, Seq[Row]],
        onNodeFrame: (NodeKey, Seq[Row]) => Unit, onNodeError: Option[(PipelineStep, Throwable) => Unit], shouldContinue: () => Boolean,
        retainOnly: Option[Set[NodeKey]], leafFirst: Boolean, runRetention: Boolean
    ): Future[TreeWalkResult] =
      super.executeTree(rootFrames, steps, stepRepo, rootIdOfStep, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink,
        ownerUserId, contextTransform, externalLanes, (k, rows) => { onNodeFrame(k, rows); sample() }, onNodeError, shouldContinue, retainOnly, leafFirst, runRetention)
  }

  private final class SamplingSnapshotRepo(ctx: DbContext) extends NodeSnapshotRepository(ctx) {
    override def overwriteRows(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String], guard: Option[DBIO[Unit]]): Future[Unit] = {
      sample(); super.overwriteRows(pipelineId, nodeStepId, rows, explicitRootId, guard)
    }
    override def overwriteRowsWith(pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String], andThen: DBIO[Unit], guard: Option[DBIO[Unit]]): Future[Unit] = {
      sample(); super.overwriteRowsWith(pipelineId, nodeStepId, rows, explicitRootId, andThen, guard)
    }
  }

  override protected def engineOver(fileSystem: LocalFileSystem): InProcessPipelineEngine = new SamplingEngine(fileSystem)
  override protected def snapshotRepoOver(ctx: DbContext): NodeSnapshotRepository         = new SamplingSnapshotRepo(ctx)

  private final case class Measured(name: String, mode: String, deltaMb: Double, outcome: String)
  private val results = ArrayBuffer.empty[Measured]

  /** `HELIO_RUN_HEAP_REPEATS` repeats every measurement (the peak swings by tens of MB between runs of the same shape);
   *  `HELIO_RUN_HEAP_ONLY` is a comma list of shape-name prefixes to run. */
  private val repeats = sys.env.get("HELIO_RUN_HEAP_REPEATS").map(_.toInt).getOrElse(1)
  private val only    = sys.env.get("HELIO_RUN_HEAP_ONLY").map(_.split(",").toSeq.map(_.trim)).getOrElse(Seq.empty)

  private def measure(name: String, build: => (PipelineId, Vector[PipelineStep]), real: Boolean = true, runner: => PipelineRunService = service): Unit =
    if (only.isEmpty || only.exists(name.startsWith)) (1 to repeats).foreach(_ => measureOnce(name, build, real, runner))

  /** The same service as the harness's, plus the history-payload repository (HEL-1276), for the opted-in payload shape (HEL-1679 D4). */
  private lazy val payloadService: PipelineRunService = {
    val ctx = new DbContext(db, db)
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      executionBackend = new InProcessExecutionBackend(engineOver(new LocalFileSystem(Paths.get("/"))), stepRepo), outputRepo = outputRepo,
      nodeSnapshotRepo = snapshotRepoOver(ctx), outputHistoryRepo = new OutputHistoryRepository(ctx), nodePayloadRepo = new NodePayloadHistoryRepository(ctx)
    )
  }

  private def measureOnce(name: String, build: => (PipelineId, Vector[PipelineStep]), real: Boolean, runner: => PipelineRunService): Unit =
    Seq(true, false).filter(isReal => real || !isReal).foreach { isReal =>
      val (pid, _) = build
      peak = 0L
      val before = usedAfterGc()
      sampling = true
      // A background sampler covers what the hooks cannot see: the database write of a node's snapshot, which builds its own
      // per-row text while the retained frames and both JSON copies are still held.
      val sampler = new Thread(() => while (sampling) { sample(); Thread.sleep(150) }, "heap-sampler")
      sampler.setDaemon(true); sampler.start()
      val outcome =
        try awaitDb(runner.submit(pid, isDry = !isReal, owner)) match {
          case Right(r) => s"succeeded, ${r.rowCount} rows"
          case Left(e)  => "refused: " + e.message.take(110)
        } finally { sampling = false; sampler.join() }
      results += Measured(name, if (isReal) "real" else "dry", (math.max(peak, before) - before) / 1048576.0, outcome)
    }

  private def chain(pid: PipelineId, from: Option[PipelineStep], count: Int, expression: String, prefix: String = "c"): Vector[PipelineStep] =
    (1 to count).foldLeft(Vector.empty[PipelineStep]) { (acc, n) =>
      acc :+ addStep(pid, ComputeStep.Kind, ComputeConfig(s"$prefix$n", expression, None), acc.lastOption.orElse(from))
    }

  private def terminalOutput(pid: PipelineId, steps: Vector[PipelineStep]): (PipelineId, Vector[PipelineStep]) = {
    addOutput(pid, steps.last, "terminal"); (pid, steps)
  }

  private def sixColumns(rows: Int): String = seedCsvSource(rows, 6, (r, c) => s"${('a' + c).toChar}$r")

  /** Held cells at the last step of an n-step chain over the 50,000 x 6 CSV: root (300,000, pinned) + parent + child frames. */
  private def textLightSteps(budget: Long): Int = {
    val cellsPerColumn = 50000L
    (((budget - 300000L) / cellsPerColumn - 11) / 2).toInt
  }

  /** Steps of a text-heavy chain (7,000 rows, two 1,000-character columns, each step a fresh 2,000-character text) that hold just under `budget`. */
  private def textHeavySteps(budget: Long): Int = ((budget - 650000L) / 630000L).toInt

  private def textHeavy(steps: Int): (PipelineId, Vector[PipelineStep]) = {
    val pid = seedPipeline(seedCsvSource(7000, 2, (r, c) => ("t" * 998) + f"$c%d$r%03d".takeRight(2)))
    terminalOutput(pid, chain(pid, None, steps, "concat($a, $b)"))
  }

  /** The same text-heavy chain with one Cyrillic character per step, so the new text is UTF-16 (two bytes a character, what `CellWeight`
   *  prices) instead of Latin-1 (one): the case a Latin-1-only measurement misses. `parentOutput` adds an Output on the terminal's parent. */
  private def textHeavyUtf16(steps: Int, parentOutput: Boolean): (PipelineId, Vector[PipelineStep]) = {
    val pid = seedPipeline(seedCsvSource(7000, 2, (r, c) => ("t" * 998) + f"$c%d$r%03d".takeRight(2)))
    val c   = chain(pid, None, steps, "concat($a, $b, \"ж\")")
    if (parentOutput) addOutput(pid, c(steps - 2), "parent")
    terminalOutput(pid, c)
  }

  /** HEL-1679: `rows` x 2 CSV of `cellChars`-character text (the same total text however it is split across rows), then 3 UTF-16 concat steps and an
   *  Output on the terminal: the shapes whose snapshot write is bounded by row WIDTH, not by row count. `fewrows-utf16-200` is skeptic-final-3's. */
  private def fewRowsUtf16(rows: Int, cellChars: Int): (PipelineId, Vector[PipelineStep]) = {
    val pid = seedPipeline(seedCsvSource(rows, 2, (r, c) => ("t" * (cellChars - 2)) + f"$c%d$r%03d".takeRight(2)))
    terminalOutput(pid, chain(pid, None, textHeavySteps(RunLimits.MaxLiveCells), "concat($a, $b, \"ж\")"))
  }

  /** `fewrows-utf16-200` with a history payload opted in on the terminal Output and the owner on the `owner` tier (HEL-1276): the node's payload is far over
   *  `PAYLOAD_HISTORY_MAX_BYTES`, so it is measured and not stored; before HEL-1679 it was rendered whole first. */
  private def fewRowsPayload(rows: Int, cellChars: Int): (PipelineId, Vector[PipelineStep]) = {
    import slick.jdbc.PostgresProfile.api._
    awaitDb(db.run(sqlu"UPDATE users SET tier = 'owner' WHERE id = $ownerId::uuid"))
    val pid   = seedPipeline(seedCsvSource(rows, 2, (r, c) => ("t" * (cellChars - 2)) + f"$c%d$r%03d".takeRight(2)))
    val steps = chain(pid, None, textHeavySteps(RunLimits.MaxLiveCells), "concat($a, $b, \"ж\")")
    awaitDb(outputRepo.insertInternal(pid, Some(steps.last.id), UserId(ownerId), "payload", OutputKind.Table, JsObject("historyPayloads" -> JsBoolean(true)), explicitRootId = None))
    (pid, steps)
  }

  /** HEL-1679 (design.md D3): `post-wide-4@3.9M`'s retained state (a 7-step chain over a 50,000 x 6 CSV, Outputs on the terminal and its parent: HEL-1660's
   *  heaviest, 164.4 MB) plus ONE wide row. The row is row 0 of the source, its column `b` (a column the chain never touches) holding `wideChars` three-byte
   *  UTF-8 characters (`中`, so the driver's UTF-8 encode cost is measured; CSV cells are not capped by `MaxStringChars`). `rowChars` is the terminal row's
   *  exact rendered JSON length; `None` builds the BASELINE (the same shape with a one-character cell in `b`). */
  private val RowWidthSteps = 7
  private def wideRowOverhead: Long = {
    val values = Seq("a" -> "a0", "b" -> "", "c" -> "c0", "d" -> "d0", "e" -> "e0", "f" -> "f0") ++ (1 to RowWidthSteps).map(n => s"c$n" -> "a0f0")
    JsonTextLength.ofRow(values.toMap)
  }
  private def wideRowPipeline(rowChars: Option[Long]): (PipelineId, Vector[PipelineStep]) = {
    val width = rowChars.fold(1L)(_ - wideRowOverhead)
    require(width >= 1, s"row width $rowChars is below the row's own overhead")
    val wide  = "中" * width.toInt
    val pid   = seedPipeline(seedCsvSource(50000, 6, (r, c) => if (r == 0 && c == 1) wide else s"${('a' + c).toChar}$r"))
    val c     = chain(pid, None, RowWidthSteps, "concat($a, $f)")
    addOutput(pid, c(RowWidthSteps - 2), "parent")
    terminalOutput(pid, c)
  }

  /** One root row carrying `text` in `pad`, joined to a 10,000-row lane: 10,000 rows that all SHARE the text (cheap), then `last`. */
  private def fanOutPipeline(text: String, last: PipelineId => Option[PipelineStep] => PipelineStep): (PipelineId, Vector[PipelineStep]) = {
    val root = seedDatasetSource(Vector("k", "i", "pad"), Vector(Vector("x", "0", text)))
    val lane = seedCsvSource(10000, 2, (r, c) => if (c == 0) "x" else r.toString, header = Some(Vector("k", "side")))
    val pid  = seedPipeline(root)
    val join = addStep(pid, JoinStep.Kind, JoinConfig(SecondaryInput.Source(lane), "k", "inner"))
    val tail = last(pid)(Some(join))
    (pid, Vector(join, tail))
  }

  /** The budgets the just-under shapes are sized for. The walk's own budget is [[RunLimits.MaxLiveCells]]; a shape sized below it is
   *  never refused, so its peak is what that budget would allow. The largest budget whose worst peak fits 192 MB sets the constant. */
  private val sweep: Seq[Long] =
    sys.env.get("HELIO_RUN_HEAP_SWEEP").map(_.split(",").toSeq.map(_.trim.toLong)).getOrElse(Seq(RunLimits.MaxLiveCells))

  private val postSweep: Seq[Long] =
    sys.env.get("HELIO_RUN_POST_SWEEP").map(_.split(",").toSeq.map(_.trim.toLong)).getOrElse(Seq(RunLimits.MaxPostWalkCells))

  private lazy val measured: Seq[Measured] = {
    // HEL-1679: long-text shapes of few rows (the same ~14M characters of source text split 200, 20 and 1 ways).
    measure("fewrows-utf16-200", fewRowsUtf16(200, 35000))
    measure("fewrows-utf16-20", fewRowsUtf16(20, 350000))
    measure("fewrows-utf16-1", fewRowsUtf16(1, 7000000))
    measure("fewrows-utf16-1w", fewRowsUtf16(1, 500000))
    measure("fewrows-payload-200", fewRowsPayload(200, 35000), runner = payloadService)
    measure("ac6-ordinary", { val pid = seedPipeline(sixColumns(50000)); val c = chain(pid, None, 10, "concat($a, $f)"); addOutput(pid, c(4), "middle"); terminalOutput(pid, c) })
    measure("join-fan-out", {
      val pid = seedPipeline(seedCsvSource(300, 6, (r, c) => if (c == 0) "k" else s"l$r"))
      val j   = addStep(pid, JoinStep.Kind, JoinConfig(SecondaryInput.Source(seedCsvSource(300, 6, (r, c) => if (c == 0) "k" else s"r$r")), "a", "inner"))
      terminalOutput(pid, Vector(j))
    })
    measure("unpivot", { val pid = seedPipeline(sixColumns(50000)); terminalOutput(pid, Vector(addStep(pid, UnpivotStep.Kind, UnpivotConfig(Vector("a"), Vector("b", "c"), "var", "val")))) })
    measure("splittext", {
      val pid = seedPipeline(seedDatasetSource(Vector("a"), Vector.fill(400)(Vector(Vector.fill(250)("para").mkString("\n\n")))))
      terminalOutput(pid, Vector(addStep(pid, SplitTextStep.Kind, SplitTextConfig("a", "paragraph"))))
    })
    measure("chunkbytokencount", {
      val pid = seedPipeline(seedCsvSource(400, 1, (_, _) => Vector.fill(250)("word").mkString(" ")))
      terminalOutput(pid, Vector(addStep(pid, ChunkByTokenCountStep.Kind, ChunkByTokenCountConfig("a", targetTokenCount = 1))))
    })
    measure("extractheadings", {
      val pid = seedPipeline(seedDatasetSource(Vector("a"), Vector.fill(400)(Vector(Vector.tabulate(250)(h => s"# heading $h").mkString("\n")))))
      terminalOutput(pid, Vector(addStep(pid, ExtractHeadingsStep.Kind, ExtractHeadingsConfig("a"))))
    })
    measure("doubling-concat", {
      val pid = seedPipeline(seedCsvSource(1, 1, (_, _) => "x" * 1000))
      val d1  = addStep(pid, ComputeStep.Kind, ComputeConfig("d1", "concat($a, $a)", None))
      val ds  = (2 to 12).foldLeft(Vector(d1))((acc, n) => acc :+ addStep(pid, ComputeStep.Kind, ComputeConfig(s"d$n", s"concat($$d${n - 1}, $$d${n - 1})", None), acc.lastOption))
      terminalOutput(pid, ds)
    })
    measure("text-copying-fan-out", fanOutPipeline("x" * 100000, pid => p => addStep(pid, ComputeStep.Kind, ComputeConfig("t1", "concat($pad, $pad)", None), p)))
    measure("splittext-fan-out", fanOutPipeline("x" * 99999 + " ", pid => p => addStep(pid, SplitTextStep.Kind, SplitTextConfig("pad", "paragraph"), p)))
    measure("extractheadings-fan-out", fanOutPipeline("# " + "x" * 99998, pid => p => addStep(pid, ExtractHeadingsStep.Kind, ExtractHeadingsConfig("pad"), p)))
    measure("pivot-fan-out", fanOutPipeline("x" * 100000, pid => p => addStep(pid, PivotStep.Kind, PivotConfig(Vector("side"), "pad", "i", "first"), p)))
    measure("fresh-string-chain", { val pid = seedPipeline(sixColumns(50000)); terminalOutput(pid, chain(pid, None, 49, "concat($a, $b, $c, $d, $e, $f)")) })
    measure("csv-root-then-fan-out", {
      val pid = seedPipeline(sixColumns(50000))
      val u   = addStep(pid, UnpivotStep.Kind, UnpivotConfig(Vector("a"), Vector("b", "c"), "var", "val"))
      terminalOutput(pid, u +: chain(pid, Some(u), 5, "concat($a, $val)"))
    })
    measure("upsertsource-then-steps", {
      val pid = seedPipeline(sixColumns(50000))
      val up  = addStep(pid, UpsertSourceStep.Kind, UpsertSourceConfig(UpsertTarget.NewSource("heap-probe"), UpsertMode.Append))
      terminalOutput(pid, up +: chain(pid, Some(up), 6, "concat($a, $b)"))
    })
    // The post-walk shapes (HEL-1660 cycle 3): a run holds its retained frames AND their JSON copies, which the walk's tally cannot see.
    // Each is sized to cost just under `limit` in `RunLimits.postWalkCells` units: `copies` = frames held + JSON copies (2 = terminal Output
    // only, 4 = plus the terminal's parent, 5 = plus two parents), over a 50,000 x 6 CSV or, for "tall", 100,000 rows from an unpivot.
    postSweep.foreach { limit =>
      Seq(2, 4, 5).foreach { copies =>
        measure(s"post-wide-$copies@$limit", {
          val steps = math.max(1, (limit / (copies * 50000L)).toInt - 12)
          val pid = seedPipeline(sixColumns(50000)); val c = chain(pid, None, steps, "concat($a, $f)")
          c.takeRight((if (copies == 2) 0 else copies - 3) + 1).dropRight(1).foreach(n => addOutput(pid, n, s"parent-${n.id.value}"))
          terminalOutput(pid, c)
        })
      }
      measure(s"post-tall-2@$limit", {
        val steps = math.max(1, (limit / (2 * 100000L)).toInt - 9)
        val pid = seedPipeline(sixColumns(50000)); val u = addStep(pid, UnpivotStep.Kind, UnpivotConfig(Vector("a"), Vector("b", "c"), "var", "val"))
        terminalOutput(pid, u +: chain(pid, Some(u), steps, "concat($a, $val)"))
      })
    }
    // HEL-1679 D3: the joint worst. `rowwidth-base` has no wide cell; `rowwidth-at-limit` has one row of exactly the limit (HELIO_RUN_ROW_CHARS
    // overrides it for a sweep); `rowwidth-over` is one character past it and must be refused with the run-limit step error.
    Seq(sys.env.get("HELIO_RUN_ROW_CHARS").map(_.toLong).getOrElse(RunLimits.MaxRowRenderChars)).foreach { limit =>
      measure("rowwidth-base", wideRowPipeline(None))
      measure("rowwidth-at-limit", wideRowPipeline(Some(limit)))
      measure("rowwidth-over", wideRowPipeline(Some(limit + 1)))
    }
    sweep.foreach { budget =>
      measure(s"just-under-light@$budget", { val pid = seedPipeline(sixColumns(50000)); terminalOutput(pid, chain(pid, None, textLightSteps(budget), "concat($a, $f)")) })
      measure(s"just-under-heavy@$budget", textHeavy(textHeavySteps(budget)))
      measure(s"heavy-utf16@$budget", textHeavyUtf16(textHeavySteps(budget), parentOutput = false))
      measure(s"heavy-utf16-2out@$budget", textHeavyUtf16(textHeavySteps(budget), parentOutput = true))
    }
    results.toSeq
  }

  private def swing(all: Seq[Measured]): Double =
    all.groupBy(m => (m.name, m.mode)).values.map(ms => ms.map(_.deltaMb).max - ms.map(_.deltaMb).min).maxOption.getOrElse(0.0)

  "the worst run shapes, end to end through the service" should {
    "stay at or under 192 MB (25% of the 768 MB production heap), real and dry" in {
      assume(sys.env.get("HELIO_MEASURE").contains("1"), "opt-in measurement: set HELIO_MEASURE=1 and run under HELIO_TEST_JVM_XMX=768m; the deterministic CI guard is RunLimitsGuardSpec")
      val all     = measured
      val maxPeak = all.map(_.deltaMb).max
      val flags   = ManagementFactory.getRuntimeMXBean.getInputArguments.asScala.mkString(" ")
      // HEL-1679: the per-row width check's own cost on the largest shape (50,000 rows x 13 columns, the `post-wide-4` terminal's size).
      val scanRows = Vector.tabulate(50000)(r => (0 until 13).map(c => s"c$c" -> (s"v$c-$r": Any)).toMap)
      val scanNs   = (1 to 5).map { _ => val t0 = System.nanoTime(); RunLimits.widestRowChars(scanRows); System.nanoTime() - t0 }.min
      val report =
        f"""HEL-1660 task 3.3 heap measurement (RunPathHeapSpec)
           |method: System.gc() x2, used heap before the run; again at every node boundary and before every node snapshot write; delta = max sample - before
           |live-cell budget (RunLimits.MaxLiveCells): ${RunLimits.MaxLiveCells}; just-under budgets swept: ${sweep.mkString(", ")}
           |${all.map(m => f"shape ${m.name}%-26s ${m.mode}%-4s delta MB ${m.deltaMb}%7.1f  ${m.outcome}").mkString("\n")}
           |max over shapes MB: $maxPeak%.1f (bound 192.0); largest swing between repeats of one shape: ${swing(all)}%.1f MB (repeats: $repeats)
           |${all.groupBy(m => (m.name, m.mode)).toSeq.sortBy(_._1).map { case ((n, md), ms) => f"repeats $n%-26s $md%-4s MB ${ms.map(m => f"${m.deltaMb}%.1f").mkString(", ")}" }.mkString("\n")}
           |HEL-1679 row-width scan (RunLimits.widestRowChars over 50,000 rows x 13 columns, best of 5): ${scanNs / 1000000.0}%.1f ms
           |JVM flags: $flags
           |maxMemory MB: ${Runtime.getRuntime.maxMemory / 1048576}
           |""".stripMargin
      info(report)
      maxPeak should be <= 192.0
      all.find(m => m.name == "ac6-ordinary" && m.mode == "real").foreach(_.outcome should startWith("succeeded"))
      all.filter(_.name.startsWith("just-under")).foreach(m => withClue(s"${m.name} ${m.mode}: ")(m.outcome should startWith("succeeded")))
      // UTF-16 text shapes are either accepted or refused by a limit, never by an exhausted heap.
      all.filter(_.name.startsWith("heavy-utf16")).foreach(m => withClue(s"${m.name} ${m.mode}: ")(m.outcome should not include "step execution failed"))
      // A post-walk shape sized to the limit may be refused (by the walk's budget or the post-walk check), but never by an exhausted heap.
      all.filter(_.name.startsWith("post-")).foreach(m => withClue(s"${m.name} ${m.mode}: ")(m.outcome should not include "step execution failed"))
      sys.env.get("HELIO_HEAP_EVIDENCE_PATH").foreach { path =>
        val target = Paths.get(path)
        Option(target.getParent).foreach(Files.createDirectories(_))
        Files.write(target, report.getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)
      }
    }
  }
}
