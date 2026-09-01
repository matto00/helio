package com.helio.domain.engine

import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver, SqlConnectorDriver}
import com.helio.domain.model.{AssertionSink, CsvSource, DataSource, ImageSource, PdfSource, PipelineExecutionContext, PipelineStep, PipelineStepId, RestSource, SqlSource, StaticSource, TextSource, TruncatedRead, TruncationSink}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import com.helio.services.sources.{ImageSourceSupport, PdfTextSupport}
import PipelineRowJson.{Row, parseStaticRows}

import java.nio.charset.StandardCharsets
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** HEL-859 (design.md Decisions 1-3): wraps a step-execution failure with the
 *  failing step's id and kind, plus a curated `reason`. `reason` is derived by
 *  an allowlist — the underlying exception's `getMessage` when and only when
 *  it is an `IllegalArgumentException` (the type every step's own hand-written
 *  config validation throws), else a fixed non-descriptive string. `cause` is
 *  retained so server-side logging still sees the full throwable. `message`
 *  is what `PipelineRunService` forwards to the client, so it deliberately
 *  contains no more than the curated `reason` — never `cause.toString`, never
 *  a class name. */
final class StepExecutionException(val stepId: String, val stepKind: String, val reason: String, cause: Throwable)
    extends Exception(s"Pipeline execution failed at step $stepId ($stepKind): $reason", cause)

object StepExecutionException {

  /** Build a [[StepExecutionException]] from a failed step's throwable,
   *  applying the Decision 3 allowlist. If `cause` is already a
   *  `StepExecutionException` (e.g. a nested engine invocation), it is
   *  returned unchanged rather than double-wrapped. */
  def from(stepId: String, stepKind: String, cause: Throwable): StepExecutionException = cause match {
    case already: StepExecutionException => already
    case iae: IllegalArgumentException   => new StepExecutionException(stepId, stepKind, iae.getMessage, cause)
    case other                           => new StepExecutionException(stepId, stepKind, "step execution failed", other)
  }
}

/** Per-read truncation stats (HEL-861, design D5) — `SourceReadStats(false, None)` for every
 *  uncapped kind (static/CSV/text/PDF/image), which is factually correct: those paths apply no
 *  cap. REST and SQL populate it from their `FetchOutcome`. */
final case class SourceReadStats(truncated: Boolean, availableRowCount: Option[Long])

/** HEL-905 (design.md Decision 8): the Phase-1 graph invariant was violated by the given step
 *  tree, identified by the offending node's id string (`"root"` for the virtual pipeline root)
 *  and a curated `message`. Never silently picks a child -- rejects the whole run before any
 *  step evaluates. */
final case class InvalidGraph(message: String) extends Exception(message)

/** HEL-905 (design.md Decision 1/2): the result of a full tree walk -- `rows`/`stepCounts` mirror
 *  the pre-tree-walk engine's return shape exactly (trunk's terminal frame; per-step counts,
 *  trunk + tails); `nodeOutcomes` is the new per-node map (Decision 1), keyed by step id string,
 *  `None` = pipeline root. */
final case class TreeWalkResult(
    rows: Seq[Row],
    stepCounts: Map[String, Long],
    nodeOutcomes: Map[Option[String], NodeOutcome]
)

object InProcessPipelineEngine {

  /** The pipeline-run row cap (HEL-861, design D9), defined exactly once here so that both the
   *  engine instance (`maxRunRows`) and `CreateSourceEnvelope.build` — which has no engine
   *  reference and no way to obtain one — read the same value rather than a duplicated literal.
   *  Unchanged in value from before this ticket: 1000. */
  val MaxRunRows: Int = 1000
}

/** In-process pipeline executor.
 *
 *  Cycle 3 reduces this to a thin orchestration shell — `applyStep` becomes
 *  `step.evaluate(rows, ctx)` and per-kind logic lives in
 *  [[com.helio.domain.steps]] modules. The engine's remaining responsibility
 *  is row-source loading (static / csv / rest_api / sql / text / pdf / image)
 *  and assembling the [[PipelineExecutionContext]] every step receives.
 *
 *  `connector` (design.md D3, HEL-758) is a nullable-default `RestApiConnectorDriver`
 *  — mirrors this file's own `binaryRefRepo`/`alertEvaluationService`
 *  `= null` convention elsewhere in the codebase. `RestApiConnectorDriver` requires
 *  an implicit `ActorSystem` to construct, so it's threaded in rather than
 *  constructed here; `SqlConnectorDriver` is a stateless `object` and needs no DI.
 *  A `null` connector attempting a `RestSource` load fails fast with a clear
 *  `IllegalArgumentException` rather than a confusing `NullPointerException`.
 *
 *  `csvUrlFetch` (HEL-862, design.md Decision 3) is the injectable seam for
 *  re-fetching a URL-backed CSV source on a scheduled/manual run. Defaults to
 *  a function that always returns `Left("not configured")` so tests that omit
 *  it keep compiling and fail loudly (not silently) if they exercise a
 *  URL-backed CSV run without wiring the seam. `PipelineRunService` supplies
 *  the real implementation — a thin closure over `CsvUrlFetch.fetch` that
 *  closes over its `ActorSystem` LAZILY (never dereferenced at construction),
 *  because `InProcessPipelineEngine` is built as an eagerly-initialised field
 *  and `system` is `null` in every fixture that omits it. */
class InProcessPipelineEngine(
    fileSystem: FileSystem,
    connector:  RestApiConnectorDriver = null,
    csvUrlFetch: String => Future[Either[String, Array[Byte]]] =
      (_: String) => Future.successful(Left("URL-backed CSV fetch is not configured"))
)(implicit ec: ExecutionContext) {

  /** Row bound for a real `rest_api`/`sql` run (design.md D2) — distinct from
   *  `previewStep`'s pre-existing 10-row preview cap (unchanged; preview
   *  truncates via `.take(10)` after `loadRows`/`executeWithStepCounts`, so
   *  this doesn't need a smaller preview-specific bound). Neither connector's
   *  `fetch` streams, so this bounds how much a single run materializes in
   *  memory — larger than `DataSourceService.staticMaxRows` (500) /
   *  `SqlConnectorDriver.inferSchema`'s 100-row sample because a real run is the
   *  one place a REST/SQL pipeline actually produces its panel-bindable
   *  data. */
  private val maxRunRows: Int = InProcessPipelineEngine.MaxRunRows

  def execute(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository
  ): Future[Seq[Row]] =
    executeWithStepCounts(rows, steps, dataSourceRepo).map(_._1)

  /** Run the pipeline, returning both the final rows and the per-step output
   *  row counts (keyed by step id).
   *
   *  `assertionSink` (HEL-509 / 419-B, design.md Decision 4) is an optional
   *  caller-supplied output parameter every `assert` step's evaluated
   *  [[AssertionResult]]s are recorded into. Defaults to a fresh, discarded
   *  sink so existing callers (`previewStep`, `execute`) are unaffected —
   *  assert steps still evaluate their rules during a preview, the same
   *  computation as before, just unread.
   *
   *  HEL-905 (design.md Decision 9): **test-only as of P1.2.** No production code path calls
   *  this method (or [[execute]], which delegates to it) any longer -- `InProcessExecutionBackend`
   *  (the only production caller of the engine) calls [[executeTree]] exclusively. This flat fold
   *  is deliberately KEPT UNCHANGED and unremoved so it can serve as the tree walk's own parity
   *  oracle (`InProcessPipelineEngineTreeWalkSpec`'s "AC1" cases assert `executeTree` on a
   *  tail-free pipeline is byte-identical to this method's output). Do not delete this as
   *  apparent dead code -- doing so silently destroys the parity proof it backs. If it is ever
   *  genuinely retired, the parity tests must be ported to frozen on-disk fixtures first (see
   *  tasks.md section 1's original red-first-fixture design, superseded by this live comparison
   *  for cycle 1/2 but still the documented fallback). */
  def executeWithStepCounts(
      rows: Seq[Row],
      steps: Seq[PipelineStep],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink = new AssertionSink,
      truncationSink: TruncationSink = new TruncationSink
  ): Future[(Seq[Row], Map[String, Long])] = {
    val ctx = makeContext(dataSourceRepo, assertionSink, truncationSink)
    val initial: Future[(Seq[Row], Map[String, Long])] =
      Future.successful((rows, Map.empty[String, Long]))
    steps.foldLeft(initial) { (acc, step) =>
      acc.flatMap { case (currentRows, counts) =>
        evalOneStep(currentRows, step, ctx).map { nextRows =>
          (nextRows, counts.updated(step.id.value, nextRows.size.toLong))
        }
      }
    }
  }

  /** HEL-905 (design.md Decision 9): the exact per-step evaluation body the pre-tree-walk
   *  `executeWithStepCounts` foldLeft used inline -- extracted verbatim (no behavior change) so
   *  both the flat fold above and the tree walk below (`executeTree`'s trunk/tail evaluation)
   *  share the identical config-validate-then-evaluate-then-attribute shape. This is what makes
   *  the tail-free tree walk byte-identical to today's engine (AC1's parity requirement). */
  private def evalOneStep(currentRows: Seq[Row], step: PipelineStep, ctx: PipelineExecutionContext): Future[Seq[Row]] = {
    // HEL-859 (design.md Decision 1): many step `evaluate` implementations
    // (e.g. `Future.successful(StringOpsStep.apply(rows, config))`)
    // evaluate eagerly — a config-validation throw happens BEFORE any
    // `Future` is returned, synchronously, which would otherwise bypass
    // `.recoverWith` below entirely (the chain is never attached).
    // Catching here guarantees every step failure — sync or async — is
    // observed and attributed.
    val stepResult: Future[Seq[Row]] =
      try {
        // HEL-814 D3: "legitimate to save" is not "legitimate to run".
        // A draft whose required configuration is still empty is savable
        // (D2 deliberately accepts it — that is the editor's
        // add-then-configure flow, running in production today), but it
        // must not silently produce degraded output: a `compute` with an
        // empty `column` writes a field named "" into the output DataType.
        // The predicate is the step kind's own `requiredConfigProblems`,
        // evaluated against the RAW config text — the same method, over
        // the same representation, that the analyze surface evaluates, so
        // the two cannot disagree. Thrown as an IllegalArgumentException
        // so HEL-859's `StepExecutionException.from` allowlist surfaces
        // the reason verbatim, attributed to this step's id and kind.
        requiredConfigProblems(step) match {
          case problems if problems.nonEmpty =>
            Future.failed(new IllegalArgumentException(problems.mkString("; ")))
          case _ => step.evaluate(currentRows, ctx)
        }
      } catch { case ex: Throwable => Future.failed(ex) }
    stepResult.recoverWith { case ex =>
      // HEL-859 (design.md Decision 1): attribute the failure to this
      // step, here in the fold, so every step kind is covered uniformly
      // rather than each step self-describing its own failures.
      Future.failed(StepExecutionException.from(step.id.value, step.kind, ex))
    }
  }

  /** HEL-905 (design.md Decision 8): validate the Phase-1 graph invariant over the WHOLE tree
   *  before any step evaluates -- (1) every node (including the virtual root) has at most one
   *  `position == 0` child; (2) a "tail node" (any node reached via a `position >= 1` edge, and
   *  everything below it) has no `position >= 1` children of its own. Returns the first violation
   *  found, never silently picking a child.
   *
   *  **This is the ONLY layer that enforces this invariant** (HEL-930, design.md Decision 8
   *  "Known gap"). `PipelineStepRepository.executionOrder`/`walk` does NOT -- it silently drops a
   *  second position-0 sibling instead of raising `InvalidGraph`. Currently unreachable via any
   *  live write path, but do not assume the repository layer rejects this shape; it does not. */
  private[engine] def validateGraph(steps: Vector[PipelineStep], stepRepo: PipelineStepRepository): Either[InvalidGraph, Unit] = {
    val byId = steps.map(s => s.id.value -> s).toMap

    // A node is a "tail node" if it (or any ancestor on the path back to the trunk) was reached
    // via a position >= 1 edge. The virtual root and every trunk step are never tail nodes.
    def isTailNode(step: PipelineStep): Boolean =
      if (step.position >= 1) true
      else step.parentStepId.flatMap(p => byId.get(p.value)).exists(isTailNode)

    val allNodeIds: Vector[Option[PipelineStepId]] = None +: steps.map(s => Some(s.id))

    val trunkViolation = allNodeIds.iterator.map { nodeId =>
      val children      = stepRepo.childrenOf(steps, nodeId)
      val trunkChildren = children.count(_.position == 0)
      if (trunkChildren > 1)
        Some(InvalidGraph(s"InvalidGraph: node ${nodeId.map(_.value).getOrElse("root")} has $trunkChildren children at position 0"))
      else None
    }.collectFirst { case Some(v) => v }

    trunkViolation match {
      case Some(v) => Left(v)
      case None    =>
        steps.iterator.filter(isTailNode).map { tailStep =>
          val childrenAtNonZero = stepRepo.childrenOf(steps, Some(tailStep.id)).count(_.position >= 1)
          if (childrenAtNonZero > 0)
            Some(InvalidGraph(s"InvalidGraph: node ${tailStep.id.value} is a tail with $childrenAtNonZero children at position >= 1"))
          else None
        }.collectFirst { case Some(v) => v } match {
          case Some(v) => Left(v)
          case None    => Right(())
        }
    }
  }

  /** HEL-905 (design.md Decisions 2, 3, 5, 8, 9): tree-walk execution -- the real per-node engine
   *  P1.2 introduces. Walks the pipeline's root node's own tails from the source frame, then the
   *  trunk in order, evaluating every tail root at each trunk node (including the root) from that
   *  node's own current frame before advancing. A disabled node (Decision 7) is skipped in place:
   *  its incoming frame passes through unchanged to its own trunk child and tail roots.
   *
   *  `persist` has no effect here -- this method never writes anything; it exists purely to let
   *  `PipelineRunService` share ONE code path for both a live run and a dry run (Decision 5), the
   *  persistence branch lives entirely in the caller. */
  def executeTree(
      rows: Seq[Row],
      steps: Vector[PipelineStep],
      stepRepo: PipelineStepRepository,
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink = new AssertionSink,
      truncationSink: TruncationSink = new TruncationSink,
      onNodeProgress: (Option[String], Long) => Unit = (_, _) => ()
  ): Future[TreeWalkResult] =
    validateGraph(steps, stepRepo) match {
      case Left(invalid) => Future.failed(invalid)
      case Right(())     =>
        val ctx = makeContext(dataSourceRepo, assertionSink, truncationSink)

        // Follows position-0 children from `root` -- the straight chain that is a tail, per the
        // Phase-1 invariant (validated above: a tail node has no position >= 1 children).
        def expandChain(root: PipelineStep): Vector[PipelineStep] = {
          def loop(current: PipelineStep, acc: Vector[PipelineStep]): Vector[PipelineStep] =
            stepRepo.childrenOf(steps, Some(current.id)).find(_.position == 0) match {
              case Some(next) => loop(next, acc :+ next)
              case None       => acc
            }
          loop(root, Vector(root))
        }

        // Evaluate every tail root at `nodeId`, seeded from `frame` -- each tail is its OWN
        // independent short fold, never threaded into the trunk's continuation, and independent
        // of any sibling tail (Decision 2 step 4).
        //
        // HEL-905 (evaluation-1.md CR2): a NodeOutcome (and an onNodeProgress firing) is recorded
        // for EVERY node in the chain, not just its terminal node -- an Output attached to a
        // mid-tail node needs its own frame available for materialization/alert evaluation.
        def evalTails(
            nodeId: Option[PipelineStepId],
            frame: Seq[Row],
            counts: Map[String, Long],
            nodeOutcomes: Map[Option[String], NodeOutcome]
        ): Future[(Map[String, Long], Map[Option[String], NodeOutcome])] = {
          val tailRoots = stepRepo.childrenOf(steps, nodeId).filter(_.position >= 1)
          tailRoots.foldLeft(Future.successful((counts, nodeOutcomes))) { (accF, tailRoot) =>
            accF.flatMap { case (accCounts, accOutcomes) =>
              val chain = expandChain(tailRoot)
              foldChain(chain, frame, accCounts, accOutcomes)
            }
          }
        }

        // HEL-905 (evaluation-1.md CR2/CR5): folds `chain` from `seed`, recording a NodeOutcome +
        // firing onNodeProgress for EVERY step in the chain (not merely the last), and updating
        // `stepCounts` only for an ENABLED step -- a disabled node passes its frame through but
        // never gets a stepCounts entry, preserving the pre-tree-walk wire shape
        // (`RunResultResponse.stepRowCounts`) exactly.
        def foldChain(
            chain: Vector[PipelineStep],
            seed: Seq[Row],
            counts: Map[String, Long],
            nodeOutcomes: Map[Option[String], NodeOutcome]
        ): Future[(Map[String, Long], Map[Option[String], NodeOutcome])] =
          chain.foldLeft(Future.successful((seed, counts, nodeOutcomes))) { (accF, step) =>
            accF.flatMap { case (currentRows, accCounts, accOutcomes) =>
              evalNode(step, currentRows).map { nextRows =>
                val updatedCounts = if (step.enabled) accCounts.updated(step.id.value, nextRows.size.toLong) else accCounts
                val key = Some(step.id.value)
                onNodeProgress(key, nextRows.size.toLong)
                (nextRows, updatedCounts, accOutcomes.updated(key, NodeOutcome(nextRows, nextRows.size.toLong)))
              }
            }
          }.map { case (_, finalCounts, finalOutcomes) => (finalCounts, finalOutcomes) }

        // HEL-905 (design.md Decision 7): a disabled node is transparent -- it is never
        // evaluated; its incoming frame passes through unchanged.
        def evalNode(step: PipelineStep, currentRows: Seq[Row]): Future[Seq[Row]] =
          if (step.enabled) evalOneStep(currentRows, step, ctx) else Future.successful(currentRows)

        // Walk the trunk from `nodeId`/`frame`, evaluating this node's own tails before
        // advancing to its trunk child (Decision 2 steps 3-4).
        def walkTrunk(
            nodeId: Option[PipelineStepId],
            frame: Seq[Row],
            counts: Map[String, Long],
            nodeOutcomes: Map[Option[String], NodeOutcome]
        ): Future[(Seq[Row], Map[String, Long], Map[Option[String], NodeOutcome])] =
          evalTails(nodeId, frame, counts, nodeOutcomes).flatMap { case (countsAfterTails, outcomesAfterTails) =>
            val keyStr = nodeId.map(_.value)
            onNodeProgress(keyStr, frame.size.toLong)
            val outcomesWithSelf = outcomesAfterTails.updated(keyStr, NodeOutcome(frame, frame.size.toLong))
            stepRepo.childrenOf(steps, nodeId).find(_.position == 0) match {
              case None => Future.successful((frame, countsAfterTails, outcomesWithSelf))
              case Some(trunkChild) =>
                evalNode(trunkChild, frame).flatMap { nextFrame =>
                  // HEL-905 (evaluation-1.md CR5): a disabled trunk child gets no stepCounts
                  // entry -- restores the pre-tree-walk wire shape (RunResultResponse
                  // .stepRowCounts never had an entry for a filtered-out disabled step).
                  val countsWithChild =
                    if (trunkChild.enabled) countsAfterTails.updated(trunkChild.id.value, nextFrame.size.toLong)
                    else countsAfterTails
                  walkTrunk(Some(trunkChild.id), nextFrame, countsWithChild, outcomesWithSelf)
                }
            }
          }

        walkTrunk(None, rows, Map.empty, Map.empty).map { case (finalRows, counts, nodeOutcomes) =>
          TreeWalkResult(finalRows, counts, nodeOutcomes)
        }
    }

  /** HEL-814 D3: the step kind's required-config problems, derived from the
   *  step's own typed config re-encoded to raw text via its companion. Going
   *  through `encodeConfig(step.configValue)` rather than reaching for the
   *  protocol layer's codec keeps the check inside `com.helio.domain`, and
   *  guarantees the run path evaluates the predicate against exactly the
   *  representation `validateStepConfig(kind, rawConfig)` uses on the analyze
   *  side. An unknown kind yields no problems — that case is already reported
   *  as "Unknown op" by analyze and cannot be persisted. */
  private def requiredConfigProblems(step: PipelineStep): Vector[String] =
    PipelineStep.companionFor(step.kind) match {
      case Right(c) => c.requiredConfigProblems(c.encodeConfig(step.configValue))
      case Left(_)  => Vector.empty
    }

  /** Load the initial rows for a pipeline's source data source, discarding the read stats.
   *  Kept with an unchanged signature (design D5) — ~20 test call sites and one internal
   *  re-entry rely on it. */
  def loadRows(ds: DataSource, dataSourceRepo: DataSourceRepository): Future[Seq[Row]] =
    loadRowsWithStats(ds, dataSourceRepo).map(_._1)

  /** Load the initial rows for a pipeline's source data source, plus whether the read was
   *  truncated by `maxRunRows` and the true total when known (HEL-861, design D5). Static /
   *  CSV / text / PDF / image are uncapped and always report `SourceReadStats(false, None)`. */
  def loadRowsWithStats(ds: DataSource, dataSourceRepo: DataSourceRepository): Future[(Seq[Row], SourceReadStats)] = ds match {
    case s: StaticSource =>
      dataSourceRepo.readRawConfig(s.id).map {
        case None      => (Seq.empty, SourceReadStats(truncated = false, availableRowCount = None))
        case Some(raw) => (parseStaticRows(raw), SourceReadStats(truncated = false, availableRowCount = None))
      }
    case c: CsvSource =>
      c.config.sourceUrl match {
        case Some(url) =>
          // HEL-862 design.md Decision 4: the load-bearing branch for AC3 — a
          // scheduled run never calls DataSourceService.refreshCsv, so this
          // engine-level re-fetch is the only thing that keeps a scheduled
          // run from serving the original snapshot forever.
          csvUrlFetch(url).flatMap {
            case Left(err) =>
              Future.failed(
                new IllegalArgumentException(
                  "CSV data source '" + c.name + "' (id=" + c.id.value + "): " + err
                )
              )
            case Right(bytes) =>
              Future.successful((loadCsvRowsFromBytes(bytes), SourceReadStats(truncated = false, availableRowCount = None)))
          }
        case None =>
          if (c.config.path.isEmpty)
            Future.failed(
              new IllegalArgumentException(
                "CSV data source '" + c.name + "' (id=" + c.id.value +
                  ") is missing required config key 'path'"
              )
            )
          else fileSystem.read(c.config.path).map(bytes => (loadCsvRowsFromBytes(bytes), SourceReadStats(truncated = false, availableRowCount = None)))
      }
    case t: TextSource =>
      if (t.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "Text data source '" + t.name + "' (id=" + t.id.value +
              ") is missing required config key 'path'"
          )
        )
      else fileSystem.read(t.config.path).map(bytes => (loadTextRowFromBytes(t.config.path, bytes), SourceReadStats(truncated = false, availableRowCount = None)))
    case p: PdfSource =>
      if (p.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "PDF data source '" + p.name + "' (id=" + p.id.value +
              ") is missing required config key 'path'"
          )
        )
      else fileSystem.read(p.config.path).flatMap(loadPdfRowsFromBytes(p, _)).map(rows => (rows, SourceReadStats(truncated = false, availableRowCount = None)))
    case i: ImageSource =>
      if (i.config.path.isEmpty)
        Future.failed(
          new IllegalArgumentException(
            "Image data source '" + i.name + "' (id=" + i.id.value +
              ") is missing required config key 'path'"
          )
        )
      else
        fileSystem.read(i.config.path).flatMap { bytes =>
          loadImageRowFromBytes(i.config.path, bytes) match {
            case Right(row) => Future.successful((row, SourceReadStats(truncated = false, availableRowCount = None)))
            case Left(msg)  => Future.failed(new IllegalArgumentException(msg))
          }
        }
    case r: RestSource =>
      if (connector == null)
        Future.failed(
          new IllegalArgumentException(
            "REST data source '" + r.name + "' (id=" + r.id.value +
              ") cannot be executed: no RestApiConnectorDriver was configured for this pipeline engine"
          )
        )
      else
        connector.fetch(r.config, maxRunRows, ConnectorResolveContext.Internal).flatMap {
          case Left(err)      => Future.failed(new IllegalArgumentException(err))
          case Right(outcome) =>
            Future.successful(
              (outcome.rows.map(PipelineRowJson.jsRowToRow), SourceReadStats(outcome.truncated, outcome.availableRowCount))
            )
        }
    case s: SqlSource =>
      SqlConnectorDriver.fetch(s.config, maxRunRows, ConnectorResolveContext.Internal).flatMap {
        case Left(err)      => Future.failed(new IllegalArgumentException(err))
        case Right(outcome) =>
          Future.successful(
            (outcome.rows.map(PipelineRowJson.jsRowToRow), SourceReadStats(outcome.truncated, outcome.availableRowCount))
          )
      }
    case other =>
      Future.failed(
        new IllegalArgumentException(
          "Unsupported source type for in-process pipeline engine: " +
            other.kind + ". Only static, csv, text, pdf, image, rest_api, and sql are supported."
        )
      )
  }

  /** Build the execution context handed to every step. `loadSource` closes over
   *  [[loadRowsWithStats]] so each step can re-enter the same source-loading dispatch without
   *  needing the engine reference itself; a truncated secondary-source read (design D8 — `join`,
   *  `union`, `lookup` all re-enter through this one choke point) is appended to `truncationSink`
   *  so the run never asserts completeness it cannot support. */
  private def makeContext(dataSourceRepo: DataSourceRepository, assertionSink: AssertionSink, truncationSink: TruncationSink): PipelineExecutionContext =
    PipelineExecutionContext(
      dataSourceRepo = dataSourceRepo,
      loadSource = (ds: DataSource) =>
        loadRowsWithStats(ds, dataSourceRepo).map { case (rows, stats) =>
          if (stats.truncated)
            truncationSink.record(TruncatedRead(ds.name, rows.size.toLong, stats.availableRowCount))
          rows
        },
      assertionSink = assertionSink
    )

  // ── Text loader (HEL-215): single-row loader, deliberately not shared with
  // CSV's multi-row loader — HEL-214 (PDF) and HEL-216 (Image, below) each add
  // their own `loadRows` case with its own extraction logic rather than
  // generalizing this over multiple data points. ───────────────────────────

  private def loadTextRowFromBytes(path: String, bytes: Array[Byte]): Seq[Row] = {
    val content  = new String(bytes, StandardCharsets.UTF_8)
    val filename = java.nio.file.Paths.get(path).getFileName.toString
    Seq(Map("content" -> content, "filename" -> filename, "sizeBytes" -> bytes.length.toLong))
  }

  // ── PDF loader (HEL-214): multi-row loader (one row per page) — the first
  // content connector whose `loadRows` case produces more than one row.
  // Extraction is deferred to this pipeline-run-time call, per the
  // pipeline-only-bindings invariant; ingest time only validates the file is
  // a well-formed, non-encrypted PDF (see `PdfTextSupport.validate`). ───────

  private def loadPdfRowsFromBytes(source: PdfSource, bytes: Array[Byte]): Future[Seq[Row]] =
    PdfTextSupport.extractPages(bytes) match {
      case Success(pages) =>
        val filename  = java.nio.file.Paths.get(source.config.path).getFileName.toString
        val pageCount = pages.size
        Future.successful(pages.zipWithIndex.map { case (text, idx) =>
          Map(
            "content"        -> text,
            "filename"       -> filename,
            "sizeBytes"      -> bytes.length.toLong,
            "pageNumber"     -> (idx + 1),
            "pageCount"      -> pageCount,
            "characterCount" -> text.length
          )
        })
      case Failure(e) =>
        Future.failed(
          new IllegalArgumentException(
            "PDF data source '" + source.name + "' (id=" + source.id.value +
              ") could not be parsed: " + e.getMessage
          )
        )
    }

  // ── Image loader (HEL-216): own case, deliberately not shared with
  // TextSource's loader, per HEL-215's design note that this dispatch is
  // per-connector rather than generalized. `content` carries the nested
  // `binary-ref` map (`storageKey`, `mimeType`, `filename`, `sizeBytes`);
  // width/height/mimeType are also surfaced as top-level fields. ───────────

  private def loadImageRowFromBytes(path: String, bytes: Array[Byte]): Either[String, Seq[Row]] = {
    val filename = java.nio.file.Paths.get(path).getFileName.toString
    ImageSourceSupport.dimensionsAndMime(bytes, filename).map { case (width, height, mimeType) =>
      val content: Map[String, Any] = Map(
        "storageKey" -> path,
        "mimeType"   -> mimeType,
        "filename"   -> filename,
        "sizeBytes"  -> bytes.length.toLong
      )
      Seq(
        Map(
          "content"   -> content,
          "filename"  -> filename,
          "sizeBytes" -> bytes.length.toLong,
          "mimeType"  -> mimeType,
          "width"     -> width,
          "height"    -> height
        )
      )
    }
  }

  // ── CSV loader (inline minimal parser to avoid an extra dep) ─────────────

  private def loadCsvRowsFromBytes(bytes: Array[Byte]): Seq[Row] = {
    val content = new String(bytes, StandardCharsets.UTF_8)
    val lines   = content.linesIterator.toVector
    if (lines.isEmpty) return Seq.empty
    val headers = parseCsvLine(lines.head)
    lines.tail.map { line =>
      val values = parseCsvLine(line)
      val padded = values.padTo(headers.size, "")
      headers.zip(padded).map { case (h, v) => h -> v.asInstanceOf[Any] }.toMap
    }
  }

  private def parseCsvLine(line: String): Vector[String] = {
    val buf     = scala.collection.mutable.ArrayBuffer.empty[String]
    val sb      = new StringBuilder
    var inQuote = false
    var i       = 0
    while (i < line.length) {
      val c = line(i)
      if (inQuote) {
        if (c == '"') {
          if (i + 1 < line.length && line(i + 1) == '"') {
            sb += '"'; i += 2
          } else {
            inQuote = false; i += 1
          }
        } else {
          sb += c; i += 1
        }
      } else {
        if (c == '"') {
          inQuote = true; i += 1
        } else if (c == ',') {
          buf += sb.toString; sb.clear(); i += 1
        } else {
          sb += c; i += 1
        }
      }
    }
    buf += sb.toString
    buf.toVector
  }
}
