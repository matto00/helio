package com.helio.domain

import com.helio.domain.steps._
import com.helio.infrastructure.DataSourceRepository
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

  /** Apply this step to the input rows.
   *
   *  Polymorphic per kind — pure-sync steps wrap their result in
   *  `Future.successful` and ignore `ctx`; async / repo-touching steps
   *  (currently only [[steps.JoinStep]]) consume `ctx.dataSourceRepo` to load
   *  the right-side rows. The uniform `Future` return shape is the cost of
   *  the polymorphic interface and the trade-off the cycle-3 refactor
   *  accepted to land the per-step-file structure. */
  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]]
}

/** Resources the engine threads through every step. Kept minimal — add fields
 *  here only when a future step kind actually needs them. */
final case class PipelineExecutionContext(
    dataSourceRepo: DataSourceRepository,
    /** Loader for a [[DataSource]]'s rows. Today only [[steps.JoinStep]] uses
     *  it (to pull the right-side rows of a static / csv source). Lives on the
     *  context so the engine can decide the loader implementation without
     *  every step file needing to know about it. */
    loadSource: DataSource => Future[Seq[Map[String, Any]]]
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
    ExtractHeadingsStep.Kind -> ExtractHeadingsStep.companion
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

  /** Registry-derived allow-list. After cycle 3 no consumer enumerates these
   *  manually — adding a new kind only requires updating
   *  [[PipelineStep.Registry]]. */
  def All: Set[String] = PipelineStep.Registry.keySet

  def parseKind(s: String): Either[String, String] =
    if (All.contains(s)) Right(s)
    else Left(s"Unknown step op: '$s'. Valid values: ${All.toSeq.sorted.mkString(", ")}")
}

