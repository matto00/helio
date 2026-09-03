package com.helio.api.protocols.pipelines

import com.helio.domain.model.{PipelineStep, PipelineStepKind}
import com.helio.domain.steps.SecondaryInput
import com.helio.domain.{AggregateConfig, AggregateStep, AssertConfig, AssertStep, CastConfig, CastStep, ChunkByTokenCountConfig, ChunkByTokenCountStep, ComputeConfig, ComputeStep, DateBucketConfig, DedupeConfig, DedupeStep, DateBucketStep, ExtractHeadingsConfig, ExtractHeadingsStep, FillNullConfig, FillNullStep, FilterConfig, FilterStep, GroupByConfig, GroupByStep, JoinConfig, JoinStep, LimitConfig, LimitStep, LookupConfig, LookupStep, PivotConfig, PivotStep, RenameConfig, RenameStep, SelectConfig, SelectStep, SortConfig, SortStep, SplitTextConfig, SplitTextStep, StringOpsConfig, StringOpsStep, UnionConfig, UnionStep, UnpivotConfig, UnpivotStep, WindowConfig, WindowStep}
import spray.json._

import scala.util.Try

/** Thin facade over the per-step companions registered in
 *  [[PipelineStep.Registry]].
 *
 *  Cycle 1 introduced this codec as a 170-line central dispatcher; cycle 2
 *  extended it with read-path tolerance for all 10 kinds (growing it to
 *  264L); cycle 3 distributes the tolerance + encode logic into per-step
 *  files and reduces this object to a registry lookup. The four public
 *  methods (`decode`, `encode`, `encodeConfig`, `encodeJsObject`) preserve
 *  their cycle-2 signatures so service / repository call sites are
 *  unchanged. */
object PipelineStepConfigCodec {

  /** Decode the JSON-text config stored on `pipeline_steps.config` into the
   *  typed `*Config` for `kind`. The returned `Try[Any]` mirrors the
   *  cycle-1/2 signature — the caller's `case Success(cfg: FilterConfig)`
   *  match (in [[PipelineStep]]-aware code like the repository / service)
   *  drives the type narrowing.
   *
   *  Tolerance lives on each step's `*Config.decode(raw)` — partial / legacy
   *  rows decode to a default-valued typed config rather than raising. */
  def decode(kind: String, raw: String): Try[Any] = Try {
    PipelineStep.companionFor(kind) match {
      case Right(c) => c.decodeConfig(raw)
      case Left(msg) => throw new IllegalArgumentException(msg)
    }
  }

  /** Encode the typed config carried by a PipelineStep subtype back to JSON
   *  text for persistence. Used by the analyze path's "re-encode for the
   *  stringly-typed analyze layer" round trip. */
  def encode(step: PipelineStep): String =
    PipelineStep.companionFor(step.kind) match {
      case Right(c) => c.encodeConfig(extractConfig(step))
      case Left(msg) => throw new IllegalStateException(msg)
    }

  /** Encode an already-decoded typed config back to JSON text. The explicit
   *  type match keeps the encode path exhaustive at the compiler boundary —
   *  adding an 11th config class without an arm here is a compile error
   *  (sealed-trait dispatch only over `PipelineStep` itself, so the config
   *  types stay loose; the match is intentional). */
  def encodeConfig(config: Any): String = config match {
    case c: RenameConfig    => PipelineStep.Registry(PipelineStepKind.Rename).encodeConfig(c)
    case c: FilterConfig    => PipelineStep.Registry(PipelineStepKind.Filter).encodeConfig(c)
    case c: JoinConfig      => PipelineStep.Registry(PipelineStepKind.Join).encodeConfig(c)
    case c: ComputeConfig   => PipelineStep.Registry(PipelineStepKind.Compute).encodeConfig(c)
    case c: GroupByConfig   => PipelineStep.Registry(PipelineStepKind.GroupBy).encodeConfig(c)
    case c: CastConfig      => PipelineStep.Registry(PipelineStepKind.Cast).encodeConfig(c)
    case c: SelectConfig    => PipelineStep.Registry(PipelineStepKind.Select).encodeConfig(c)
    case c: LimitConfig     => PipelineStep.Registry(PipelineStepKind.Limit).encodeConfig(c)
    case c: SortConfig      => PipelineStep.Registry(PipelineStepKind.Sort).encodeConfig(c)
    case c: AggregateConfig => PipelineStep.Registry(PipelineStepKind.Aggregate).encodeConfig(c)
    case c: SplitTextConfig => PipelineStep.Registry(PipelineStepKind.SplitText).encodeConfig(c)
    case c: ExtractHeadingsConfig => PipelineStep.Registry(PipelineStepKind.ExtractHeadings).encodeConfig(c)
    case c: ChunkByTokenCountConfig => PipelineStep.Registry(PipelineStepKind.ChunkByTokenCount).encodeConfig(c)
    case c: DateBucketConfig => PipelineStep.Registry(PipelineStepKind.DateBucket).encodeConfig(c)
    case c: PivotConfig      => PipelineStep.Registry(PipelineStepKind.Pivot).encodeConfig(c)
    case c: WindowConfig     => PipelineStep.Registry(PipelineStepKind.Window).encodeConfig(c)
    case c: UnpivotConfig    => PipelineStep.Registry(PipelineStepKind.Unpivot).encodeConfig(c)
    case c: DedupeConfig     => PipelineStep.Registry(PipelineStepKind.Dedupe).encodeConfig(c)
    case c: FillNullConfig   => PipelineStep.Registry(PipelineStepKind.FillNull).encodeConfig(c)
    case c: StringOpsConfig  => PipelineStep.Registry(PipelineStepKind.StringOps).encodeConfig(c)
    case c: UnionConfig      => PipelineStep.Registry(PipelineStepKind.Union).encodeConfig(c)
    case c: LookupConfig     => PipelineStep.Registry(PipelineStepKind.Lookup).encodeConfig(c)
    case c: AssertConfig     => PipelineStep.Registry(PipelineStepKind.Assert).encodeConfig(c)
    case other =>
      throw new IllegalArgumentException(
        s"PipelineStepConfigCodec.encodeConfig: unexpected config type ${other.getClass.getName}"
      )
  }

  /** Validate a JsObject config payload against `kind` and return the
   *  canonical JSON text representation. Used by the repository for
   *  insert/update flows: decoding raises if the shape is wrong; on success
   *  the original JsObject is canonicalised through `compactPrint`. */
  def encodeJsObject(kind: String, configJson: JsObject): Try[String] =
    decode(kind, configJson.compactPrint).map(_ => configJson.compactPrint)

  /** The second, separately-owned DataSource a decoded step config references, if it
   *  references one at all. Returns `None` for a config kind with no second source AND
   *  for a config whose second-source id is empty -- the pipeline op picker's own seed
   *  value (`defaultConfigFor`), an incomplete draft rather than a reference to an
   *  inaccessible resource. HEL-386/HEL-620/HEL-950.
   *
   *  Takes `Any` because `decode` above returns `Try[Any]`: the 23 `*Config` case classes
   *  share no sealed parent (`PipelineStepConfig` is a frontend TypeScript type, not a
   *  Scala one). `PipelineStep.Registry`-driven structural guard tests (see
   *  `PipelineStepSecondSourceGuardSpec`) substitute for the compile-time exhaustiveness
   *  this therefore cannot have -- a future op adding a second-source id and forgetting to
   *  extend this match is caught at test time, not by the compiler.
   *
   *  `.nonEmpty` on the raw string, deliberately never `.trim.nonEmpty`: the picker's seed
   *  is exactly `""`, and a whitespace-only id is not a state the picker can produce. */
  def secondaryDataSourceId(config: Any): Option[String] = config match {
    case jc: JoinConfig   => sourceIdOf(jc.secondaryInput)
    case uc: UnionConfig  => sourceIdOf(uc.secondaryInput)
    case lc: LookupConfig => sourceIdOf(lc.secondaryInput)
    case _                => None
  }

  private def sourceIdOf(si: SecondaryInput): Option[String] = si match {
    case SecondaryInput.Source(id) if id.nonEmpty => Some(id)
    case _                                        => None
  }

  /** HEL-911 (design.md Engine contract item 6a): the `lane`-kind secondary input's
   *  referenced `stepId`, if the decoded config carries one. Used by
   *  `PipelineService` to validate same-pipeline membership and reject cycles at
   *  write time -- the security-boundary counterpart to [[secondaryDataSourceId]]'s
   *  ACL pre-flight. Mirrors that method's per-config match rather than sharing it,
   *  since exactly one of the two ever applies to a given decoded config. */
  def secondaryLaneStepId(config: Any): Option[String] = config match {
    case jc: JoinConfig   => laneIdOf(jc.secondaryInput)
    case uc: UnionConfig  => laneIdOf(uc.secondaryInput)
    case lc: LookupConfig => laneIdOf(lc.secondaryInput)
    case _                => None
  }

  private def laneIdOf(si: SecondaryInput): Option[String] = si match {
    case SecondaryInput.Lane(id) => Some(id)
    case _                       => None
  }

  /** Pull the typed config out of a `PipelineStep` subtype.
   *
   *  HEL-814: this is now `PipelineStep.configValue`, an abstract member every
   *  subtype implements as `= config`. The previous 24-arm match here was a
   *  second, drift-prone copy of the same mapping; the run path needs the
   *  same lookup from inside `com.helio.domain`, and two copies of it could
   *  disagree. The compiler still enforces exhaustiveness — a new subtype
   *  cannot compile without implementing the member. */
  private def extractConfig(step: PipelineStep): Any = step.configValue


}
