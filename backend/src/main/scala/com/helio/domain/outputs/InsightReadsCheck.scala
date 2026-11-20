package com.helio.domain.outputs

import com.helio.domain.model.{OutputId, OutputKind}
import spray.json.{JsNull, JsObject}

/** HEL-1740 D4: the scoping half of an insight's `reads.outputs`, which needs the pipeline's Outputs and so cannot live
 *  in the pure key/value validator. Pure; callers supply `pipelineOutputs` (the Output ids, with their kinds, as the write
 *  will leave the pipeline). Judged only when the write introduces or changes `reads` (the tolerance rule), so an
 *  unrelated PATCH of an insight whose reads dangle after a sibling's deletion still succeeds. Callers skip it entirely for
 *  restore paths (rollback, draft undo, patch-set undo): restoring stored state is never refused. */
object InsightReadsCheck {

  /** The message prefix every `reads.outputs` scoping refusal carries (also used by the patch-set same-set-delete pass). */
  val NamesOtherOutputsMessage: String =
    "reads.outputs must name other non-insight Outputs of this pipeline (not another insight, or an unknown Output)"

  def check(
      kind:            OutputKind,
      insightId:       Option[OutputId],
      written:         JsObject,
      stored:          JsObject,
      pipelineOutputs: Map[OutputId, OutputKind],
      isSelectableModel: String => Boolean
  ): Either[String, Unit] =
    if (kind != OutputKind.Insight || !readsChanged(written, stored)) Right(())
    else
      InsightConfig.parse(JsObject(stored.fields ++ written.fields), isSelectableModel).flatMap { cfg =>
        val ids = cfg.reads.outputs.getOrElse(Vector.empty)
        if (ids.exists(id => insightId.contains(id))) Left("reads.outputs must not name the insight itself")
        else {
          val offending = ids.filter(id => !pipelineOutputs.get(id).exists(_ != OutputKind.Insight))
          if (offending.isEmpty) Right(())
          else
            Left(
              s"$NamesOtherOutputsMessage: ${offending.map(_.value).mkString(", ")}"
            )
        }
      }

  private def readsChanged(written: JsObject, stored: JsObject): Boolean =
    written.fields.get("reads").exists(v => !stored.fields.get("reads").contains(v)) &&
      written.fields.get("reads").exists(_ != JsNull)
}
