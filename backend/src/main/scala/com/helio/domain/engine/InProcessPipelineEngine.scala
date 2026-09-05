package com.helio.domain.engine

import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver, SqlConnectorDriver}
import com.helio.domain.model.{AssertionSink, CsvSource, DataSource, ImageSource, PdfSource, PipelineExecutionContext, PipelineRootId, PipelineStep, PipelineStepId, RestSource, SqlSource, StaticSource, TextSource, TruncatedRead, TruncationSink}
import com.helio.domain.steps.{JoinStep, LookupStep, SecondaryInput, UnionStep}
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
 *  a class name.
 *
 *  HEL-913 (design.md R5/R11, tasks 6.1/6.3): `lanePath` is the runtime graph path from the
 *  failing step's originating root to itself, R5's format (`root:<rootId> > s1 > s4`), composed
 *  into `getMessage` when non-empty. Defaulted to `""` (omitted from the message entirely) so
 *  every pre-existing construction site (including the flat, test-only `executeWithStepCounts`
 *  oracle, which has no root/graph context to build one from) is unaffected — only
 *  `executeTree`'s real per-node evaluation supplies it. */
final class StepExecutionException(val stepId: String, val stepKind: String, val reason: String, cause: Throwable, val lanePath: String = "")
    extends Exception(
      if (lanePath.nonEmpty) s"Pipeline execution failed at step $stepId ($stepKind) [path: $lanePath]: $reason"
      else s"Pipeline execution failed at step $stepId ($stepKind): $reason",
      cause
    )

object StepExecutionException {

  /** Build a [[StepExecutionException]] from a failed step's throwable,
   *  applying the Decision 3 allowlist. If `cause` is already a
   *  `StepExecutionException` (e.g. a nested engine invocation), it is
   *  returned unchanged rather than double-wrapped. */
  def from(stepId: String, stepKind: String, cause: Throwable, lanePath: String = ""): StepExecutionException = cause match {
    case already: StepExecutionException => already
    case iae: IllegalArgumentException   => new StepExecutionException(stepId, stepKind, iae.getMessage, cause, lanePath)
    case other                           => new StepExecutionException(stepId, stepKind, "step execution failed", other, lanePath)
  }
}

/** Per-read truncation stats (HEL-861, design D5) — `SourceReadStats(false, None)` for every
 *  uncapped kind (static/CSV/text/PDF/image), which is factually correct: those paths apply no
 *  cap. REST and SQL populate it from their `FetchOutcome`. */
final case class SourceReadStats(truncated: Boolean, availableRowCount: Option[Long])

/** HEL-905 (design.md Decision 8): the Phase-1 graph invariant was violated by the given step
 *  tree, identified by the offending node's id string (`"root"` for the virtual pipeline root)
 *  and a curated `message`. Never silently picks a child -- rejects the whole run before any
 *  step evaluates.
 *
 *  HEL-911 (design.md "Engine contract" item 1): the Phase-1 fence this error protected --
 *  "at most one position=0 child" / "no position>=1 child below a tail" -- is deleted at all
 *  three enforcement sites (this engine's own former `validateGraph` pre-flight,
 *  `PipelineStepRepository.executionOrder`'s HEL-930 guard, and `PipelineService`'s mapping
 *  arm). This type is KEPT, not removed, because it is still a live wire/API-error shape a
 *  caller may be matching on; nothing in this codebase raises it any longer. */
final case class InvalidGraph(message: String) extends Exception(message)

/** HEL-911 (design.md Engine contract items 6a/7): a `lane`-kind `secondaryInput` formed a
 *  cycle (referenced the referencing step itself or one of its own ancestors), or named a
 *  step that does not exist or belongs to a DIFFERENT pipeline. Raised defensively at run
 *  time -- `PipelineService` performs the same checks at write time with a 400 naming the
 *  cycle/violation, so this is a backstop for data that reached the table by some other
 *  path, per design.md's "both arms required" rule. */
final case class LaneReferenceError(message: String) extends Exception(message)

/** HEL-913 design.md R4: a node in the pipeline graph is either one of the pipeline's own
 *  roots, or a step. Replaces the pre-multi-root `Option[String]` keying (`None` = "the"
 *  virtual root) -- under multi-root there is no single root to default to, so the sentinel
 *  must name WHICH root. Every node's frame in [[TreeWalkResult.nodeOutcomes]], every lane
 *  reference resolution, and every root-bound Output/snapshot/ref lookup keys on this type. */
sealed trait NodeKey
final case class RootKey(rootId: String) extends NodeKey
final case class StepKey(stepId: String) extends NodeKey

/** HEL-905 (design.md Decision 1/2): the result of a full tree walk -- `rows`/`stepCounts` mirror
 *  the pre-tree-walk engine's return shape exactly (the terminal frame of the lowest-positioned
 *  root's trunk, per R10; per-step counts, trunk + tails); `nodeOutcomes` is the per-node map
 *  (Decision 1), keyed by [[NodeKey]] (HEL-913 R4 -- supersedes the old `Option[String]`/
 *  `None`-means-root keying). */
final case class TreeWalkResult(
    rows: Seq[Row],
    stepCounts: Map[String, Long],
    nodeOutcomes: Map[NodeKey, NodeOutcome]
)

object InProcessPipelineEngine {

  /** The pipeline-run row cap (HEL-861, design D9), defined exactly once here so that both the
   *  engine instance (`maxRunRows`) and `CreateSourceEnvelope.build` — which has no engine
   *  reference and no way to obtain one — read the same value rather than a duplicated literal.
   *  Unchanged in value from before this ticket: 1000. */
  val MaxRunRows: Int = 1000

  /** HEL-911 (design.md Engine contract item 6): the `stepId` a `lane`-kind
   *  `secondaryInput` on `step` names, if any. `None` for every other step kind and for
   *  a `join`/`union`/`lookup` whose secondary input is `source`-kind. Centralizes the
   *  per-op match so both the write-time check (`PipelineService`, via
   *  `PipelineStepConfigCodec.secondaryLaneStepId`), this engine's run-time walk, and
   *  `RuntimeGraphPath` (HEL-914) read the identical mapping. On the companion object (pure,
   *  no instance state) so `RuntimeGraphPath` — which has no engine instance to call through —
   *  can call it too. */
  private[engine] def laneDependencyOf(step: PipelineStep): Option[String] = step match {
    case j: JoinStep   => j.config.secondaryInput match { case SecondaryInput.Lane(id) => Some(id); case _ => None }
    case u: UnionStep  => u.config.secondaryInput match { case SecondaryInput.Lane(id) => Some(id); case _ => None }
    case l: LookupStep => l.config.secondaryInput match { case SecondaryInput.Lane(id) => Some(id); case _ => None }
    case _             => None
  }
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
  /** `pathOf` (HEL-913, design.md R5/R11 tasks 6.1/6.3) computes the failing step's runtime
   *  graph path for [[StepExecutionException]]'s message, evaluated lazily (only on the failure
   *  branch, never on the success path) so it costs nothing when nothing fails. Defaulted to
   *  always returning `""` (omitted from the message) -- the flat, test-only
   *  `executeWithStepCounts` oracle has no root/graph context to build a real one from, and
   *  every pre-existing direct `evalOneStep` caller is unaffected. `executeTree` supplies the
   *  real builder. */
  private def evalOneStep(currentRows: Seq[Row], step: PipelineStep, ctx: PipelineExecutionContext, pathOf: PipelineStep => String = _ => ""): Future[Seq[Row]] = {
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
      // HEL-913 (design.md R11, task 6.3): the single throw site the lane path is composed at.
      Future.failed(StepExecutionException.from(step.id.value, step.kind, ex, pathOf(step)))
    }
  }

  /** HEL-911 (design.md Engine contract items 1-4): the pipeline's DAG evaluation order,
   *  as a stable "structural rank" over parent->child edges ALONE (lane-reference edges
   *  never affect it) -- pure and side-effect-free, no evaluation happens here.
   *
   *  Every node's children are visited in DESCENDING sibling `position` (highest first),
   *  recursively, before returning to the next-lower sibling. This reproduces the P1.2
   *  walk order EXACTLY for a trunk-plus-tails graph: what P1.2 called "evaluate this
   *  node's tails, THEN continue the trunk" is exactly "visit the higher-position
   *  siblings (tails), then the position-0 sibling (trunk continuation), each fully
   *  before the next" -- i.e. this same descending-order preorder DFS, just not
   *  previously named that way. Decision 2's "position ascending is the tiebreak" is the
   *  SORT KEY fed to this traversal (children are compared ascending by position); the
   *  DESCENDING visit order is this traversal's realization of that key, verified against
   *  `InProcessPipelineEngineTreeWalkSpec`'s P1.2 parity fixtures (design.md's required
   *  test) rather than asserted from prose alone. Position 0 is never treated specially
   *  in code -- it is simply the lowest-ranked comparison key, per Engine contract item 2. */
  /** HEL-913 (design.md R3/R4): now ranks EVERY root's tree, in the given `rootIds` order
   *  (the caller's responsibility to have sorted by `position` ascending -- R3's cross-root
   *  tiebreak), each root's own subtree fully before moving to the next root. A pipeline with
   *  exactly one root (today's only real case) produces the byte-identical rank sequence the
   *  pre-multi-root single-argument form did, since there is only one root to visit -- required
   *  for 5.5a's single-root parity. `rootIdOfStep` (from `PipelineStepRepository.rootIdsOf`) is
   *  the side-map that resolves which root each parentless step is attached to, since
   *  `PipelineStep` itself does not carry that field (task 4.4a deferral). */
  private[engine] def structuralRank(
      steps: Vector[PipelineStep],
      rootIds: Vector[String],
      rootIdOfStep: Map[String, String]
  ): Map[NodeKey, Int] = {
    val ranks = scala.collection.mutable.LinkedHashMap.empty[NodeKey, Int]
    var counter = 0
    def childrenOfKey(key: NodeKey): Vector[PipelineStep] = key match {
      case RootKey(rid) => steps.filter(s => s.parentStepId.isEmpty && rootIdOfStep.get(s.id.value).contains(rid))
      case StepKey(sid) => steps.filter(_.parentStepId.exists(_.value == sid))
    }
    def visit(key: NodeKey): Unit = {
      ranks(key) = counter
      counter += 1
      childrenOfKey(key).sortBy(s => -s.position).foreach(c => visit(StepKey(c.id.value)))
    }
    rootIds.foreach(rid => visit(RootKey(rid)))
    ranks.toMap
  }

  /** HEL-911 (design.md Engine contract, replaces P1.2's trunk/tail `executeTree`): a
   *  general topological DAG walk. Any node may have any number of step children
   *  (lanes); a `join`/`union`/`lookup` step whose `secondaryInput` is `lane`-kind adds
   *  an extra dependency edge (referenced-node -> rejoin-step) alongside the ordinary
   *  parent->child edge. A node is evaluated once BOTH its parent's frame is known AND
   *  (if it has one) its lane dependency's frame is known; among nodes simultaneously
   *  ready, the lowest `structuralRank` (Decision 2's position-ascending tiebreak,
   *  realized as this ranking) goes first. This is Kahn's algorithm with `structuralRank`
   *  as the tie-break priority: with no lane edges, dependencies are pure tree edges and
   *  this reduces EXACTLY to `structuralRank`'s own order (the P1.2 parity requirement).
   *
   *  A disabled node (Decision 7, unchanged from P1.2) is transparent: never evaluated,
   *  its incoming frame passes through unchanged, and it gets no `stepCounts` entry. A
   *  lane reference to a disabled node resolves to that pass-through frame automatically,
   *  since `nodeOutcomes` records it under the disabled node's own key regardless.
   *
   *  If no ready node remains while unevaluated nodes do, that is a cycle or a dangling/
   *  foreign lane reference that reached the table by some path other than
   *  `PipelineService`'s write-time check -- rejected defensively with [[LaneReferenceError]]
   *  (Engine contract items 6a/7's run-time arm), never by silently picking a node.
   *
   *  `persist` has no effect here -- this method never writes anything; it exists purely to let
   *  `PipelineRunService` share ONE code path for both a live run and a dry run (Decision 5), the
   *  persistence branch lives entirely in the caller. */
  /** HEL-913 (design.md R4/R10): `rootFrames` replaces the single `rows` argument -- one
   *  `(rootId, initialRows)` pair per pipeline root, ORDERED by `position` ascending (R3's
   *  cross-root tiebreak; the caller's responsibility, mirroring `PipelineRootRepository`'s own
   *  `sortBy(_.position)` reads). `rootIdOfStep` (`PipelineStepRepository.rootIdsOf`) resolves
   *  which root each parentless step belongs to. A single-root pipeline (today's only real case)
   *  passes a one-element `rootFrames` and produces the byte-identical walk the pre-multi-root
   *  single-`rows` signature did (5.5a's required parity). */
  def executeTree(
      rootFrames: Vector[(String, Seq[Row])],
      steps: Vector[PipelineStep],
      stepRepo: PipelineStepRepository,
      rootIdOfStep: Map[PipelineStepId, PipelineRootId],
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink = new AssertionSink,
      truncationSink: TruncationSink = new TruncationSink,
      onNodeProgress: (NodeKey, Long) => Unit = (_, _) => ()
  ): Future[TreeWalkResult] = {
    require(rootFrames.nonEmpty, "executeTree requires at least one root frame (design.md R1: every pipeline has at least one root)")
    val rootIdOfStepStr: Map[String, String] = rootIdOfStep.map { case (sid, rid) => sid.value -> rid.value }
    val rootIds: Vector[String] = rootFrames.map(_._1)
    val ranks   = structuralRank(steps, rootIds, rootIdOfStepStr)
    val laneDep: Map[String, Option[String]] = steps.map(s => s.id.value -> InProcessPipelineEngine.laneDependencyOf(s)).toMap
    val byId: Map[String, PipelineStep] = steps.map(s => s.id.value -> s).toMap

    // HEL-911 (design.md Engine contract items 6a/7, run-time defensive arm): reject a
    // dangling/foreign/self/ancestor lane reference BEFORE any step evaluates, never by
    // silently dropping it or letting a plain Kahn's-cycle check catch it -- referencing
    // one's own ancestor is not a graph-theoretic cycle in the dependency-edge sense (the
    // ancestor is already guaranteed evaluated first via the ordinary parent chain), so it
    // needs its own explicit check rather than relying on `loop`'s "no ready node remains"
    // fallback below (which only catches a reference to one's own DESCENDANT). Same-pipeline
    // membership is automatic here -- `steps` is already scoped to one pipeline by the
    // caller -- so "does not exist" collapses to "not present in `byId`" for this defensive
    // arm; `PipelineService.validateLaneReference` performs the real cross-pipeline check at
    // write time, where a foreign id is actually reachable.
    def ancestorIdsOf(s: PipelineStep): Set[String] = {
      def loop(cur: Option[PipelineStepId], acc: Set[String]): Set[String] = cur match {
        case None => acc
        case Some(pid) =>
          byId.get(pid.value) match {
            case Some(p) => loop(p.parentStepId, acc + p.id.value)
            case None    => acc
          }
      }
      loop(s.parentStepId, Set.empty)
    }
    val laneViolation: Option[LaneReferenceError] = steps.iterator.flatMap { s =>
      laneDep.getOrElse(s.id.value, None).flatMap { dep =>
        if (dep == s.id.value)
          Some(LaneReferenceError(s"Step '${s.id.value}' cannot reference itself as a lane input."))
        else if (!byId.contains(dep))
          Some(LaneReferenceError(s"Step '${s.id.value}' references lane step '$dep', which does not exist in this pipeline."))
        else if (ancestorIdsOf(s).contains(dep))
          Some(LaneReferenceError(s"Step '${s.id.value}' references lane step '$dep', which is its own ancestor (cycle)."))
        else None
      }
    }.nextOption()

    if (laneViolation.isDefined) return Future.failed(laneViolation.get)

    // Mutable per-run state, closed over by `resolveLane` below so a step's lane
    // resolution always reads the CURRENT in-progress nodeOutcomes map (design.md Engine
    // contract item 8) without re-evaluating anything and without threading it through
    // every recursive call's argument list. HEL-913: seeded with ONE entry per root (RootKey),
    // not a single `None` sentinel.
    var nodeOutcomes: Map[NodeKey, NodeOutcome] =
      rootFrames.map { case (rid, rows) => (RootKey(rid): NodeKey) -> NodeOutcome(rows, rows.size.toLong) }.toMap
    var evaluatedIds: Set[NodeKey] = rootIds.map(rid => RootKey(rid): NodeKey).toSet
    var counts: Map[String, Long] = Map.empty

    val ctx = makeContext(dataSourceRepo, assertionSink, truncationSink, stepId => nodeOutcomes.get(StepKey(stepId)).map(_.rows))

    rootFrames.foreach { case (rid, rows) => onNodeProgress(RootKey(rid), rows.size.toLong) }

    // HEL-913 (design.md R5/R11, task 6.2/6.2a), HEL-914 D5: the runtime graph path from a
    // step's originating root to itself, `root:<rootId> > s1 > s4` (R5's format) -- extracted
    // to `RuntimeGraphPath` so this is the ONE implementation (design.md §D5), reused verbatim
    // by concise `analyze_pipeline` and the workspace-context lane tree.
    val graphPath = RuntimeGraphPath.build(steps, rootIds, rootIdOfStepStr)
    def buildLanePath(step: PipelineStep): String = graphPath.pathOf(step)

    // HEL-905 (design.md Decision 7): a disabled node is transparent -- it is never
    // evaluated; its incoming frame passes through unchanged.
    def evalNode(step: PipelineStep, currentRows: Seq[Row]): Future[Seq[Row]] =
      if (step.enabled) evalOneStep(currentRows, step, ctx, buildLanePath) else Future.successful(currentRows)

    // HEL-913 (design.md R4): a parentless step's "parent" is now its OWN root (RootKey), not a
    // single shared `None` sentinel -- resolved via `rootIdOfStepStr`, which is populated for
    // every parentless step (V98's CHECK guarantees this) and empty for every parented one.
    def parentKey(s: PipelineStep): NodeKey = s.parentStepId match {
      case Some(pid) => StepKey(pid.value)
      case None      => RootKey(rootIdOfStepStr.getOrElse(s.id.value, rootIds.head))
    }

    def isReady(s: PipelineStep): Boolean =
      evaluatedIds.contains(parentKey(s)) &&
        laneDep.getOrElse(s.id.value, None).forall(dep => evaluatedIds.contains(StepKey(dep)))

    def loop(remaining: Vector[PipelineStep]): Future[Unit] =
      if (remaining.isEmpty) Future.successful(())
      else {
        val ready = remaining.filter(isReady)
        if (ready.isEmpty)
          Future.failed(LaneReferenceError(
            "Cyclic or unresolved lane reference among pipeline steps: " + remaining.map(_.id.value).mkString(", ")
          ))
        else {
          val next = ready.minBy(s => ranks.getOrElse(StepKey(s.id.value), Int.MaxValue))
          val rest = remaining.filterNot(_.id.value == next.id.value)
          val parentFrame = nodeOutcomes.get(parentKey(next)).map(_.rows).getOrElse(rootFrames.head._2)
          evalNode(next, parentFrame).flatMap { nextFrame =>
            val key: NodeKey = StepKey(next.id.value)
            nodeOutcomes = nodeOutcomes.updated(key, NodeOutcome(nextFrame, nextFrame.size.toLong))
            evaluatedIds = evaluatedIds + key
            if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)
            onNodeProgress(key, nextFrame.size.toLong)
            loop(rest)
          }
        }
      }

    // HEL-911 evaluation-1.md CR1 (cycle 2), extended by HEL-913 R10: `rows` MUST keep meaning
    // the TRUNK TERMINAL's frame, not "whatever was evaluated last in structuralRank order" --
    // and under multi-root, specifically the LOWEST-POSITIONED root's trunk (R10's tiebreak),
    // never an arbitrary root's. Five call sites (PipelineRunService's SSE row count,
    // `pipelines.last_run_row_count`, `pipeline_runs.row_count`, and -- critically --
    // `binaryRefRepo.overwriteForNode` keyed by `trunkOfRoot(...).lastOption`) depend on `rows`
    // being the SAME node that identifies, or binary refs get keyed to one node and extracted
    // from another (R10's explicit agreement requirement). `rootFrames.head` is the
    // lowest-positioned root because the caller sorts by position ascending.
    val lowestRootId = rootFrames.head._1
    val trunkTerminalId: Option[String] =
      stepRepo.trunkOfRoot(steps, rootIdOfStep, PipelineRootId(lowestRootId)).lastOption.map(_.id.value)
    loop(steps).map { _ =>
      val trunkRows = trunkTerminalId
        .flatMap(id => nodeOutcomes.get(StepKey(id)))
        .map(_.rows)
        .getOrElse(nodeOutcomes(RootKey(lowestRootId)).rows)
      TreeWalkResult(trunkRows, counts, nodeOutcomes)
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
  private def makeContext(
      dataSourceRepo: DataSourceRepository,
      assertionSink: AssertionSink,
      truncationSink: TruncationSink,
      resolveLane: String => Option[Seq[Row]] = (_: String) => None
  ): PipelineExecutionContext =
    PipelineExecutionContext(
      dataSourceRepo = dataSourceRepo,
      loadSource = (ds: DataSource) =>
        loadRowsWithStats(ds, dataSourceRepo).map { case (rows, stats) =>
          if (stats.truncated)
            truncationSink.record(TruncatedRead(ds.name, rows.size.toLong, stats.availableRowCount))
          rows
        },
      assertionSink = assertionSink,
      resolveLane = resolveLane
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
