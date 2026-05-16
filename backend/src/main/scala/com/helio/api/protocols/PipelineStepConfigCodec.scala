package com.helio.api.protocols

import com.helio.domain.{
  AggregateConfig,
  AggregateStep,
  CastConfig,
  CastStep,
  ComputeConfig,
  ComputeStep,
  FilterConfig,
  FilterStep,
  GroupByConfig,
  GroupByStep,
  JoinConfig,
  JoinStep,
  LimitConfig,
  LimitStep,
  PipelineStep,
  PipelineStepKind,
  RenameConfig,
  RenameStep,
  SelectConfig,
  SelectStep,
  SortConfig,
  SortStep
}
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

  // ── Internal helpers ────────────────────────────────────────────────────

  /** Pull the typed config out of a `PipelineStep` subtype. Each subtype
   *  exposes its config under the same accessor name (`config`); the match
   *  here keeps the lookup explicit and exhaustive at the compiler level
   *  rather than relying on reflection. */
  private def extractConfig(step: PipelineStep): Any = step match {
    case s: RenameStep    => s.config
    case s: FilterStep    => s.config
    case s: JoinStep      => s.config
    case s: ComputeStep   => s.config
    case s: GroupByStep   => s.config
    case s: CastStep      => s.config
    case s: SelectStep    => s.config
    case s: LimitStep     => s.config
    case s: SortStep      => s.config
    case s: AggregateStep => s.config
  }

}
