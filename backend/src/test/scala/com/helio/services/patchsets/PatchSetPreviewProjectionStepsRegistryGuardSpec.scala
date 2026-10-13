package com.helio.services.patchsets

import com.helio.domain._
import com.helio.domain.model._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.util.Try

/** HEL-1535 structural guard: every kind in `PipelineStep.Registry` must have an arm in BOTH
 *  `PipelineStepProjectionSupport.withPosition` and `.withDecodedConfig`. `PipelineStep` is an unsealed trait, so the
 *  compiler cannot warn about a missing arm; a patch-set preview of such a kind would 500 (`MatchError`) or 400.
 *  Failures are collected across ALL kinds and name each one (a single run reports every gap).
 *
 *  The `stepOf` factory is test-local (no production kind+config -> step constructor is reachable) and throws for an
 *  unknown kind, so a newly registered kind with no factory entry also turns this spec red, naming the kind. */
class PatchSetPreviewProjectionStepsRegistryGuardSpec extends AnyWordSpec with Matchers {

  private val now = Instant.now()
  private val NewPosition = 7

  private def stepOf(kind: String, config: Any): PipelineStep = {
    val (id, pid) = (PipelineStepId("step-1"), PipelineId("pipe-1"))
    kind match {
      case RenameStep.Kind              => RenameStep(id, pid, 0, config.asInstanceOf[RenameConfig], now, now)
      case FilterStep.Kind              => FilterStep(id, pid, 0, config.asInstanceOf[FilterConfig], now, now)
      case JoinStep.Kind                => JoinStep(id, pid, 0, config.asInstanceOf[JoinConfig], now, now)
      case ComputeStep.Kind             => ComputeStep(id, pid, 0, config.asInstanceOf[ComputeConfig], now, now)
      case GroupByStep.Kind             => GroupByStep(id, pid, 0, config.asInstanceOf[GroupByConfig], now, now)
      case CastStep.Kind                => CastStep(id, pid, 0, config.asInstanceOf[CastConfig], now, now)
      case SelectStep.Kind              => SelectStep(id, pid, 0, config.asInstanceOf[SelectConfig], now, now)
      case LimitStep.Kind               => LimitStep(id, pid, 0, config.asInstanceOf[LimitConfig], now, now)
      case SortStep.Kind                => SortStep(id, pid, 0, config.asInstanceOf[SortConfig], now, now)
      case AggregateStep.Kind           => AggregateStep(id, pid, 0, config.asInstanceOf[AggregateConfig], now, now)
      case SplitTextStep.Kind           => SplitTextStep(id, pid, 0, config.asInstanceOf[SplitTextConfig], now, now)
      case ExtractHeadingsStep.Kind     => ExtractHeadingsStep(id, pid, 0, config.asInstanceOf[ExtractHeadingsConfig], now, now)
      case ChunkByTokenCountStep.Kind   => ChunkByTokenCountStep(id, pid, 0, config.asInstanceOf[ChunkByTokenCountConfig], now, now)
      case DateBucketStep.Kind          => DateBucketStep(id, pid, 0, config.asInstanceOf[DateBucketConfig], now, now)
      case PivotStep.Kind               => PivotStep(id, pid, 0, config.asInstanceOf[PivotConfig], now, now)
      case WindowStep.Kind              => WindowStep(id, pid, 0, config.asInstanceOf[WindowConfig], now, now)
      case UnpivotStep.Kind             => UnpivotStep(id, pid, 0, config.asInstanceOf[UnpivotConfig], now, now)
      case DedupeStep.Kind              => DedupeStep(id, pid, 0, config.asInstanceOf[DedupeConfig], now, now)
      case FillNullStep.Kind            => FillNullStep(id, pid, 0, config.asInstanceOf[FillNullConfig], now, now)
      case StringOpsStep.Kind           => StringOpsStep(id, pid, 0, config.asInstanceOf[StringOpsConfig], now, now)
      case UnionStep.Kind               => UnionStep(id, pid, 0, config.asInstanceOf[UnionConfig], now, now)
      case LookupStep.Kind              => LookupStep(id, pid, 0, config.asInstanceOf[LookupConfig], now, now)
      case AssertStep.Kind              => AssertStep(id, pid, 0, config.asInstanceOf[AssertConfig], now, now)
      case UpsertSourceStep.Kind        => UpsertSourceStep(id, pid, 0, config.asInstanceOf[UpsertSourceConfig], now, now)
      case ConvertFormatStep.Kind       => ConvertFormatStep(id, pid, 0, config.asInstanceOf[ConvertFormatConfig], now, now)
      case AnalyzeWithAiStep.Kind       => AnalyzeWithAiStep(id, pid, 0, config.asInstanceOf[AnalyzeWithAiConfig], now, now)
      case GenerateTextStep.Kind        => GenerateTextStep(id, pid, 0, config.asInstanceOf[GenerateTextConfig], now, now)
      case other                         => throw new IllegalStateException(s"no test factory for registered step kind '$other'; add one to stepOf")
    }
  }

  /** Empty when `kind` is fully covered, else one line per problem naming it. */
  private def problemsFor(kind: String): Vector[String] = {
    val companion = PipelineStep.Registry(kind)
    val built     = Try(stepOf(kind, companion.decodeConfig("{}")))
    built.fold(
      e => Vector(s"$kind: cannot build a step (${e.getClass.getSimpleName}: ${e.getMessage})"),
      step => {
        val position = Try(PipelineStepProjectionSupport.withPosition(step, NewPosition)).fold(
          e => Vector(s"$kind: withPosition threw ${e.getClass.getSimpleName}"),
          moved =>
            if (moved.kind == kind && moved.position == NewPosition) Vector.empty
            else Vector(s"$kind: withPosition returned kind=${moved.kind} position=${moved.position}")
        )
        val config = Try(PipelineStepProjectionSupport.withDecodedConfig(step, step.configValue)).fold(
          e => Vector(s"$kind: withDecodedConfig threw ${e.getClass.getSimpleName}"),
          {
            case Right(s) if s.kind == kind => Vector.empty
            case Right(s)                   => Vector(s"$kind: withDecodedConfig returned kind=${s.kind}")
            case Left(msg)                  => Vector(s"$kind: withDecodedConfig returned Left($msg)")
          }
        )
        position ++ config
      }
    )
  }

  "PipelineStepProjectionSupport" should {
    "not pass vacuously: the registry holds every known kind" in {
      PipelineStep.Registry.keySet.size should be >= 27
      PipelineStep.Registry.keySet should contain allOf (ConvertFormatStep.Kind, AnalyzeWithAiStep.Kind, GenerateTextStep.Kind)
    }

    "have a withPosition and withDecodedConfig arm for EVERY registered step kind" in {
      val problems = PipelineStep.Registry.keys.toVector.sorted.flatMap(problemsFor)
      withClue(s"registered step kinds missing a preview projection arm:\n${problems.mkString("\n")}\n") {
        problems shouldBe empty
      }
    }
  }
}
