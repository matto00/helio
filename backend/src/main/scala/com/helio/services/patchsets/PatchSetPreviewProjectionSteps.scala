package com.helio.services.patchsets

import com.helio.domain._
import com.helio.domain.model._

/** Pure per-step-kind `.copy` composition for `pipelineStep` update
 *  previews (HEL-408 design.md D3, tasks.md 2.2's "pipelineStep via
 *  `PipelineStepConfigCodec.decode` ... + a `.copy(...)`") -- mirrors
 *  `PipelineStepRepository.rowToDomain`'s / `PipelineStepResponse.
 *  fromDomain`'s own established per-kind-arm enumeration (same 22 step
 *  kinds, same style) rather than inventing a new dispatch mechanism.
 *  Extracted to its own file to keep `PatchSetPreviewProjection.scala`
 *  within a manageable size. */
private[services] object PipelineStepProjectionSupport {

  /** `.copy(position = ...)` across all 22 registered step kinds -- the
   *  PURE in-memory analogue of `PipelineStepRepository.updateInternal`'s
   *  position-only branch. */
  def withPosition(step: PipelineStep, position: Int): PipelineStep = step match {
    case s: RenameStep             => s.copy(position = position)
    case s: FilterStep             => s.copy(position = position)
    case s: JoinStep                => s.copy(position = position)
    case s: ComputeStep            => s.copy(position = position)
    case s: GroupByStep            => s.copy(position = position)
    case s: CastStep                => s.copy(position = position)
    case s: SelectStep              => s.copy(position = position)
    case s: LimitStep                => s.copy(position = position)
    case s: SortStep                 => s.copy(position = position)
    case s: AggregateStep           => s.copy(position = position)
    case s: SplitTextStep           => s.copy(position = position)
    case s: ExtractHeadingsStep     => s.copy(position = position)
    case s: ChunkByTokenCountStep   => s.copy(position = position)
    case s: DateBucketStep          => s.copy(position = position)
    case s: PivotStep                => s.copy(position = position)
    case s: WindowStep               => s.copy(position = position)
    case s: UnpivotStep              => s.copy(position = position)
    case s: DedupeStep               => s.copy(position = position)
    case s: FillNullStep             => s.copy(position = position)
    case s: StringOpsStep            => s.copy(position = position)
    case s: UnionStep                => s.copy(position = position)
    case s: LookupStep               => s.copy(position = position)
    case s: AssertStep               => s.copy(position = position)
  }

  /** `.copy(config = ...)` across all 22 registered step kinds, given the
   *  `Any`-typed value `PipelineStepConfigCodec.decode` returns (its own
   *  documented cycle-1/2 signature) -- the PURE in-memory analogue of
   *  `PipelineStepRepository.updateInternal`'s config-replace branch. A
   *  decoded config whose type doesn't match the step's own kind (should
   *  never happen -- `decode` is keyed by `step.kind` itself) is a
   *  defensive `Left`, mirroring `PipelineStepConfigCodec.encodeConfig`'s
   *  own "unexpected config type" guard. */
  def withDecodedConfig(step: PipelineStep, config: Any): Either[String, PipelineStep] = (step, config) match {
    case (s: RenameStep, c: RenameConfig)                       => Right(s.copy(config = c))
    case (s: FilterStep, c: FilterConfig)                       => Right(s.copy(config = c))
    case (s: JoinStep, c: JoinConfig)                            => Right(s.copy(config = c))
    case (s: ComputeStep, c: ComputeConfig)                     => Right(s.copy(config = c))
    case (s: GroupByStep, c: GroupByConfig)                     => Right(s.copy(config = c))
    case (s: CastStep, c: CastConfig)                            => Right(s.copy(config = c))
    case (s: SelectStep, c: SelectConfig)                        => Right(s.copy(config = c))
    case (s: LimitStep, c: LimitConfig)                          => Right(s.copy(config = c))
    case (s: SortStep, c: SortConfig)                            => Right(s.copy(config = c))
    case (s: AggregateStep, c: AggregateConfig)                 => Right(s.copy(config = c))
    case (s: SplitTextStep, c: SplitTextConfig)                 => Right(s.copy(config = c))
    case (s: ExtractHeadingsStep, c: ExtractHeadingsConfig)     => Right(s.copy(config = c))
    case (s: ChunkByTokenCountStep, c: ChunkByTokenCountConfig) => Right(s.copy(config = c))
    case (s: DateBucketStep, c: DateBucketConfig)               => Right(s.copy(config = c))
    case (s: PivotStep, c: PivotConfig)                          => Right(s.copy(config = c))
    case (s: WindowStep, c: WindowConfig)                        => Right(s.copy(config = c))
    case (s: UnpivotStep, c: UnpivotConfig)                      => Right(s.copy(config = c))
    case (s: DedupeStep, c: DedupeConfig)                        => Right(s.copy(config = c))
    case (s: FillNullStep, c: FillNullConfig)                    => Right(s.copy(config = c))
    case (s: StringOpsStep, c: StringOpsConfig)                  => Right(s.copy(config = c))
    case (s: UnionStep, c: UnionConfig)                          => Right(s.copy(config = c))
    case (s: LookupStep, c: LookupConfig)                        => Right(s.copy(config = c))
    case (s: AssertStep, c: AssertConfig)                        => Right(s.copy(config = c))
    case _ => Left(s"config decode produced a type mismatched with step kind '${step.kind}'")
  }
}
