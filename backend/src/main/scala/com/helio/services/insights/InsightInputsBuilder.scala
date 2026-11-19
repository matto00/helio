package com.helio.services.insights

import scala.annotation.tailrec
import com.helio.domain.history.OutputCompare
import com.helio.domain.insights._
import com.helio.domain.model.{Output, OutputKind, Pipeline, PipelineStep, PipelineStepId}
import com.helio.domain.outputs.InsightConfig
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineStepRepository}
import com.helio.services.pipelines.{OutputHistoryService, RowColumnOrder}
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** What one render reads: the inputs the grounding pack is built from, and the preset after `auto` inference. */
final case class InsightRenderInputs(inputs: InsightInputs, preset: InsightPreset)

/** HEL-1743 D2: the first production caller of `InsightInputs`. Every read is internal (no user): the render service already
 *  authorized the Output, and a scheduler or run path has no request user. */
class InsightInputsBuilder(
    outputRepo: OutputRepository,
    stepRepo: PipelineStepRepository,
    snapshotRepo: NodeSnapshotRepository,
    historyService: OutputHistoryService
)(implicit ec: ExecutionContext) {

  def build(insight: Output, cfg: InsightConfig, pipeline: Pipeline, now: Instant, limits: InsightLimits): Future[InsightRenderInputs] =
    for {
      outputs <- outputRepo.listByPipelineInternal(insight.node.pipelineId)
      configs <- outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))
      steps   <- stepRepo.listByPipelineInternal(insight.node.pipelineId)
      readSet  = readSetOf(insight, cfg, outputs)
      head    <- headOf(insight, pipeline, now, limits)
      resolved <- Future.traverse(readSet)(o => historyService.forOutput(o, configs.getOrElse(o.id.value, JsObject.empty), 30, None).map(o -> _))
      windows <- Future.traverse(for (w <- cfg.reads.windows; o <- readSet) yield (w, o))(windowOf(_, configs, now))
    } yield {
      val compares = resolved.flatMap { case (o, res) => InsightInputAdapters.fromResolution(o, res).compare }.toVector
      val signals = InsightNodeSignals(
        outputs     = outputs.filter(o => o.node == insight.node && o.kind != OutputKind.Insight).map(o => o.kind -> configs.getOrElse(o.id.value, JsObject.empty)),
        columnTypes = insight.schema.map(f => f.name -> f.`type`).toMap,
        stepOps     = InsightNodeSignalsBuilder.parentChainOps(steps, insight.node.stepId)
      )
      InsightRenderInputs(InsightInputs(head, compares, windows.flatten.toVector), InsightPresetInference.infer(cfg.preset, signals))
    }

  /** `reads.outputs` when present (ids that are gone or of kind `insight` are dropped, never a failure); otherwise every
   *  other non-insight Output on the insight's own node. */
  private def readSetOf(insight: Output, cfg: InsightConfig, outputs: Vector[Output]): Vector[Output] =
    cfg.reads.outputs match {
      case Some(ids) => ids.flatMap(id => outputs.find(_.id == id)).filter(o => o.kind != OutputKind.Insight && o.id != insight.id)
      case None      => outputs.filter(o => o.node == insight.node && o.kind != OutputKind.Insight && o.id != insight.id)
    }

  private def headOf(insight: Output, pipeline: Pipeline, now: Instant, limits: InsightLimits): Future[Option[InsightHead]] =
    snapshotRepo
      .listRows(insight.node.pipelineId.value, insight.node.stepId.map(_.value), Some(limits.maxHeadRows), Set.empty, insight.node.rootId.map(_.value))
      .map { rows =>
        Option.when(rows.nonEmpty) {
          val (ordered, columns) = RowColumnOrder.order(insight.schema.map(_.name), rows)
          InsightHead(insight.id.value, pipeline.lastRunAt.getOrElse(now), columns, ordered)
        }
      }

  /** One window of one read Output: the history points inside `now - w`, relabelled with the window token. */
  private def windowOf(wo: (String, Output), configs: Map[String, JsObject], now: Instant): Future[Option[InsightWindow]] = {
    val (token, o) = wo
    OutputCompare.parse(token) match {
      case Right(OutputCompare.Window(by)) =>
        historyService.forOutput(o, configs.getOrElse(o.id.value, JsObject.empty), 100, Some(now.minus(by))).map { res =>
          InsightInputAdapters.fromResolution(o, res).window.map(_.copy(label = token))
        }
      case _ => Future.successful(None)
    }
  }
}

/** HEL-1743 D2: the step ops an insight's preset inference reads. */
object InsightNodeSignalsBuilder {

  /** Op names of the ENABLED steps on the node's primary `parentStepId` chain, root first. Lane/secondary inputs are not on
   *  the chain, so they are never read; a disabled step is skipped but the walk continues through it. */
  def parentChainOps(steps: Vector[PipelineStep], node: Option[PipelineStepId]): Vector[String] = {
    val byId = steps.map(s => s.id -> s).toMap
    @tailrec
    def walk(at: Option[PipelineStepId], acc: Vector[PipelineStep], seen: Set[PipelineStepId]): Vector[PipelineStep] =
      at.flatMap(byId.get) match {
        case Some(s) if !seen.contains(s.id) => walk(s.parentStepId, s +: acc, seen + s.id)
        case _                                => acc
      }
    walk(node, Vector.empty, Set.empty).filter(_.enabled).map(_.kind)
  }
}
