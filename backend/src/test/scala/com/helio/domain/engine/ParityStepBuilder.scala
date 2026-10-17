package com.helio.domain.engine

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.steps._

import java.time.Instant
import scala.util.{Failure, Success}

/** HEL-1581: the config text of a corpus step could not be decoded into a typed config (a wrong-typed key). The
 *  production repository cannot load such a step either, so the oracle reports it as an error outcome. */
final case class ParityConfigDecodeFailure(kind: String, cause: Throwable) extends Exception(s"$kind: ${cause.getMessage}", cause)

/** HEL-1581: builds the domain step for a corpus (kind, raw config) pair. Mirrors `PipelineStepRepository.rowToDomain`
 *  and, like it, matches every registered kind: a kind with no arm fails loudly rather than silently skipping. */
object ParityStepBuilder {

  private val now        = Instant.parse("2026-01-01T00:00:00Z")
  private val pipelineId = PipelineId("parity-pipeline")

  def build(kind: String, id: String, position: Int, parent: Option[String], enabled: Boolean, rawConfig: String): PipelineStep = {
    val stepId = PipelineStepId(id)
    val p      = parent.map(PipelineStepId(_))
    PipelineStepConfigCodec.decode(kind, rawConfig) match {
      case Failure(e) => throw ParityConfigDecodeFailure(kind, e)
      case Success(cfg) =>
        cfg match {
          case c: RenameConfig               => RenameStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: FilterConfig               => FilterStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: JoinConfig                 => JoinStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: ComputeConfig              => ComputeStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: GroupByConfig              => GroupByStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: CastConfig                 => CastStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: SelectConfig               => SelectStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: LimitConfig                => LimitStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: SortConfig                 => SortStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: AggregateConfig            => AggregateStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: SplitTextConfig            => SplitTextStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: ExtractHeadingsConfig      => ExtractHeadingsStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: ChunkByTokenCountConfig    => ChunkByTokenCountStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: DateBucketConfig           => DateBucketStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: PivotConfig                => PivotStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: WindowConfig               => WindowStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: UnpivotConfig              => UnpivotStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: DedupeConfig               => DedupeStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: FillNullConfig             => FillNullStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: StringOpsConfig            => StringOpsStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: UnionConfig                => UnionStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: LookupConfig               => LookupStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: AssertConfig               => AssertStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: UpsertSourceConfig         => UpsertSourceStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: ConvertFormatConfig        => ConvertFormatStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: AnalyzeWithAiConfig        => AnalyzeWithAiStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case c: GenerateTextConfig         => GenerateTextStep(stepId, pipelineId, position, c, now, now, p, enabled)
          case other =>
            throw new IllegalStateException(s"ParityStepBuilder has no arm for kind '$kind' (config ${other.getClass.getName})")
        }
    }
  }
}
