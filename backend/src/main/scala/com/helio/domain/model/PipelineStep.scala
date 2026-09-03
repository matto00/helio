package com.helio.domain.model

import com.helio.domain.steps._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json.{JsObject, JsValue}

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** PipelineStep ADT (CS2c-3a cycle 3).
 *
 *  Each step kind is a self-contained module under [[com.helio.domain.steps]]
 *  that owns:
 *
 *    - its typed `*Config` case class
 *    - the `*Step` case class implementing the polymorphic `evaluate` method
 *    - the JSON codec for its config (tolerant read + canonical write)
 *    - a [[PipelineStep.Companion]] entry registered with [[PipelineStep.Registry]]
 *
 *  Cycle 1 introduced the typed ADT (sealed-trait) and centralized handlers
 *  + codec. Cycle 3 collapses each kind's data + behavior + codec into one
 *  file so adding an 11th kind means dropping in one step module and adding
 *  one Registry line — no edits in three or four separate central files.
 *
 *  The trait is intentionally NOT `sealed`: Scala 2 constrains sealed-trait
 *  subclasses to the same compilation unit, which would defeat the per-file
 *  refactor. Discipline is enforced via [[PipelineStep.Registry]] — only
 *  kinds registered there round-trip through the codec / protocol / engine.
 *  The four match sites in this codebase (`PipelineStepResponse.fromDomain`,
 *  `PipelineStepConfigCodec.extractConfig`, the protocol writer, the
 *  exhaustiveness test in `PipelineStepSpec`) all enumerate the same 12
 *  subtypes; adding a 13th step kind without updating those is caught by
 *  the kind-set parity test (`PipelineStepKind.All` shouldBe registry.keys).
 *
 *  Wire shape (unchanged): discriminated union on `type` with a typed `config`
 *  payload. DB shape (unchanged): `pipeline_steps.op` is the kind discriminator
 *  column, `pipeline_steps.config` continues to store the typed config as JSON
 *  text. See [[PipelineStepKind]] for the kind-string constants. */
trait PipelineStep {
  def id: PipelineStepId
  def pipelineId: PipelineId
  def position: Int
  def kind: String
  def createdAt: Instant
  def updatedAt: Instant

  /** Persisted disable/enable flag (HEL-412). Defaults `true` on every
   *  subtype's constructor so pre-existing positional call sites (tests,
   *  DemoData, etc.) that predate this field are unaffected. A disabled step
   *  is dropped from execution, analysis, and preview — see
   *  `pipeline-step-lifecycle` spec. */
  def enabled: Boolean

  /** HEL-904 (Outputs remodel, additive step 1.2): the sibling-scoped parent
   *  this step branches from. `None` means "trunk step, parented off the
   *  pipeline's source" — mirrors today's flat `position`-ordered trunk until
   *  the V94 migration backfills this from `position` (tasks.md §2.2) and
   *  `PipelineStepRepository` starts reading tree order instead of flat
   *  position (§1.6). Defaults `None` so every pre-existing positional call
   *  site keeps compiling. */
  def parentStepId: Option[PipelineStepId]

  /** Apply this step to the input rows.
   *
   *  Polymorphic per kind — pure-sync steps wrap their result in
   *  `Future.successful` and ignore `ctx`; async / repo-touching steps
   *  (currently [[steps.JoinStep]] and [[steps.UnionStep]]) consume
   *  `ctx.dataSourceRepo` to load a second source's rows. The uniform
   *  `Future` return shape is the cost of the polymorphic interface and the
   *  trade-off the cycle-3 refactor accepted to land the per-step-file
   *  structure. */
  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]]

  /** This step's own typed `*Config`, type-erased.
   *
   *  HEL-814: the run path needs each step's RAW config text to evaluate the
   *  same required-config declaration the analyze path evaluates (D3's
   *  "single source of truth" — the two surfaces cannot disagree because they
   *  run the same predicate over the same representation). The engine gets
   *  there via `companion.encodeConfig(step.configValue)`, which keeps the
   *  whole check inside `com.helio.domain` rather than reaching up into the
   *  protocol layer for it. Every subtype implements this as `= config`. */
  def configValue: Any
}

/** Resources the engine threads through every step. Kept minimal — add fields
 *  here only when a future step kind actually needs them. */
final case class PipelineExecutionContext(
    dataSourceRepo: DataSourceRepository,
    /** Loader for a [[DataSource]]'s rows. Used by [[steps.JoinStep]] and
     *  [[steps.UnionStep]] (to pull a second source's rows — static / csv).
     *  Lives on the context so the engine can decide the loader implementation without
     *  every step file needing to know about it. */
    loadSource: DataSource => Future[Seq[Map[String, Any]]],
    /** Mutable output sink [[steps.AssertStep]] records its evaluated
     *  [[AssertionResult]]s into (HEL-509 / 419-B, design.md Decision 4).
     *  Defaults to a fresh, unread sink so every existing direct construction
     *  of this context is unaffected. */
    assertionSink: AssertionSink = new AssertionSink,
    /** HEL-911 (design.md Engine contract item 8): resolves a `lane`-kind
     *  `secondaryInput`'s referenced step id to that node's already-evaluated
     *  post-evaluation frame, WITHOUT re-evaluating it -- used by
     *  [[steps.JoinStep]] / [[steps.UnionStep]] / [[steps.LookupStep]]. Defaults to
     *  a function returning `None` so every existing direct construction of this
     *  context (tests, `previewStep` before this ticket) keeps compiling;
     *  `InProcessPipelineEngine.executeTree` supplies the real implementation,
     *  backed by the in-progress `nodeOutcomes` map. */
    resolveLane: String => Option[Seq[Map[String, Any]]] = (_: String) => None
)

object PipelineStep {

  /** Per-kind registry entry. Each step file exports one of these via its
   *  companion object; the [[Registry]] below assembles them. Adding a new
   *  step kind means defining a new step file with a `Companion` and adding
   *  one line to `Registry` — no edits in the codec, protocol, or engine. */
  trait Companion {
    def kind: String

    /** Decode the persisted JSON-text config blob into a typed `*Config`.
     *  Must be tolerant: missing keys yield typed defaults so partial /
     *  legacy rows survive the read path and any required-field violations
     *  surface at execute time (parity with the pre-CS2c-3a engine). */
    def decodeConfig(raw: String): Any

    /** Encode an already-typed config back to JSON text for persistence. */
    def encodeConfig(config: Any): String

    /** Read a JsValue (typed-config payload from the wire) into a
     *  `PipelineStep` subtype, given the row-level metadata. Used by the
     *  protocol layer's discriminated-union read. */
    def readFromWire(json: JsValue): Any

    /** Write a step subtype's config back to JsValue for the wire. */
    def writeToWire(config: Any): JsValue

    /** Strict WRITE-path check of a caller-supplied raw config. `None` means
     *  accept; `Some(message)` rejects the write with a message naming the
     *  offending key and the expected shape. Distinct from `decodeConfig`,
     *  which is contractually tolerant for the READ path (HEL-860) — this
     *  method exists precisely so a mistyped config can be rejected at
     *  create/update time instead of silently decoding to an empty no-op.
     *  Defaults to `None` so existing kinds are unaffected; a step kind opts
     *  into strictness by overriding this in its own file. */
    def validateRawConfig(raw: String): Option[String] = strictDecodeProblem(raw)

    /** HEL-814 D2: the shared wrong-TYPE rejection, derived from this kind's
     *  own strict decoder so the write path can never reject a shape the read
     *  path accepts, or accept one it rejects. `decodeConfig` raises
     *  `StepConfigTypeMismatch` with a message naming the offending key and
     *  the shape that key expects (per-key, never a shared generic string),
     *  which is prefixed here with the step kind.
     *
     *  Any OTHER decode failure — malformed JSON — returns `None`: that is
     *  the pre-existing "invalid config" category the calling surfaces
     *  already report from the decode `Try` itself, and duplicating it here
     *  would give one root cause two different messages. */
    protected final def strictDecodeProblem(raw: String): Option[String] =
      scala.util.Try(decodeConfig(raw)) match {
        case scala.util.Failure(e: StepConfigTypeMismatch) =>
          Some(s"Invalid '$kind' config: ${e.getMessage}")
        case _ => None
      }

    /** HEL-814 D3 — the single per-kind declaration of required configuration,
     *  evaluated against the **raw config string**.
     *
     *  Both the run path (`InProcessPipelineEngine.executeWithStepCounts`,
     *  which obtains the raw text via `encodeConfig(step.configValue)`) and
     *  the analyze path (`PipelineAnalyzeService.validateStepConfig`, which
     *  already holds it) call this one method, so "the two surfaces cannot
     *  disagree" is structural rather than aspirational.
     *
     *  It returns a `Vector[String]` computed from the raw config rather than
     *  a flat list of required field names because requiredness is sometimes
     *  **conditional on another config value** — `stringops.field` is required
     *  by five of the six operations and genuinely unused by `concat` — and
     *  sometimes conditional on a sibling inside a nested array ELEMENT. A
     *  flat required-field list cannot express either, and would be wrong in
     *  one direction or the other for those kinds. See `enumeration.md` for
     *  the per-field table and the spec citation behind every entry.
     *
     *  Scope note: this declaration covers only the fields `enumeration.md`
     *  marks `required`. Values that an existing run/analyze check ALREADY
     *  rejects with a specced message (`window.function`, `fillnull.strategy`,
     *  `datebucket.granularity`, `lookup`/`union` reference ids, ...) are
     *  deliberately not re-declared here — a second, blunter message would
     *  replace a specced one. */
    def requiredConfigProblems(raw: String): Vector[String] = Vector.empty
  }

  /** Registry of every step kind. Single source of truth — `PipelineStepKind`,
   *  the codec facade, and the protocol union all derive from this Map. */
  val Registry: Map[String, Companion] = Map(
    RenameStep.Kind    -> RenameStep.companion,
    FilterStep.Kind    -> FilterStep.companion,
    JoinStep.Kind      -> JoinStep.companion,
    ComputeStep.Kind   -> ComputeStep.companion,
    GroupByStep.Kind   -> GroupByStep.companion,
    CastStep.Kind      -> CastStep.companion,
    SelectStep.Kind    -> SelectStep.companion,
    LimitStep.Kind     -> LimitStep.companion,
    SortStep.Kind      -> SortStep.companion,
    AggregateStep.Kind -> AggregateStep.companion,
    SplitTextStep.Kind -> SplitTextStep.companion,
    ExtractHeadingsStep.Kind -> ExtractHeadingsStep.companion,
    ChunkByTokenCountStep.Kind -> ChunkByTokenCountStep.companion,
    DateBucketStep.Kind -> DateBucketStep.companion,
    PivotStep.Kind -> PivotStep.companion,
    WindowStep.Kind -> WindowStep.companion,
    UnpivotStep.Kind -> UnpivotStep.companion,
    DedupeStep.Kind -> DedupeStep.companion,
    FillNullStep.Kind -> FillNullStep.companion,
    StringOpsStep.Kind -> StringOpsStep.companion,
    UnionStep.Kind -> UnionStep.companion,
    LookupStep.Kind -> LookupStep.companion,
    AssertStep.Kind -> AssertStep.companion
  )

  /** Look up a kind's companion, or `Left` with a descriptive error. */
  def companionFor(kind: String): Either[String, Companion] =
    Registry.get(kind) match {
      case Some(c) => Right(c)
      case None =>
        Left(
          s"Unknown step op: '$kind'. Valid values: ${Registry.keySet.toSeq.sorted.mkString(", ")}"
        )
    }
}

/** Source of truth for the pipeline step discriminator string. Constants here
 *  are exported by each step file (as `<Kind>Step.Kind`); [[All]] is derived
 *  from the registry so the allow-list cannot drift from the actual set of
 *  registered step kinds. */
object PipelineStepKind {
  val Rename: String    = RenameStep.Kind
  val Filter: String    = FilterStep.Kind
  val Join: String      = JoinStep.Kind
  val Compute: String   = ComputeStep.Kind
  val GroupBy: String   = GroupByStep.Kind
  val Cast: String      = CastStep.Kind
  val Select: String    = SelectStep.Kind
  val Limit: String     = LimitStep.Kind
  val Sort: String      = SortStep.Kind
  val Aggregate: String = AggregateStep.Kind
  val SplitText: String = SplitTextStep.Kind
  val ExtractHeadings: String = ExtractHeadingsStep.Kind
  val ChunkByTokenCount: String = ChunkByTokenCountStep.Kind
  val DateBucket: String = DateBucketStep.Kind
  val Pivot: String      = PivotStep.Kind
  val Window: String     = WindowStep.Kind
  val Unpivot: String    = UnpivotStep.Kind
  val Dedupe: String     = DedupeStep.Kind
  val FillNull: String   = FillNullStep.Kind
  val StringOps: String  = StringOpsStep.Kind
  val Union: String      = UnionStep.Kind
  val Lookup: String     = LookupStep.Kind
  val Assert: String     = AssertStep.Kind

  /** Registry-derived allow-list. After cycle 3 no consumer enumerates these
   *  manually — adding a new kind only requires updating
   *  [[PipelineStep.Registry]]. */
  def All: Set[String] = PipelineStep.Registry.keySet

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown step op: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}

