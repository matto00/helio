package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.CreatePipelineRequest
import com.helio.domain.model.DataSourceId
import com.helio.services.sources.InlineSourceCleanup
import spray.json.{JsArray, JsObject, JsString, JsValue}

/** Pairs the inline roots of a `pipeline` create request with the source ids the created pipeline reported
 *  (HEL-1469 / HEL-1475 rollback, HEL-1493 journal): `roots` preserves request order, so a request root is matched to
 *  the summary root at the same position, and the match is only trusted when the counts agree. A mismatch pairs
 *  NOTHING, because a mispaired position could delete a source the user already had. An inline root whose summary
 *  entry carries no string `dataSourceId` is left out and counted in `unpaired`. A request root names an inline
 *  source exactly when its `type` is set. */
private[services] object InlineRootPairing {

  sealed trait Result

  /** The request has no inline root: nothing to delete and no count to compare. */
  case object NoInlineRoots extends Result

  /** The request and the created pipeline disagree on the root count, so no position can be trusted. */
  final case class CountMismatch(requestRoots: Int, summaryRoots: Int) extends Result

  /** `sources` pairs each trusted inline source id with whether it made an implicit Connector; `unpaired` counts the
   *  inline roots that could not be matched to an id. */
  final case class Paired(sources: Vector[(DataSourceId, Boolean)], unpaired: Int) extends Result

  def pair(request: CreatePipelineRequest, resultingState: Option[JsValue]): Result = {
    val summaryRoots: Vector[JsValue] = resultingState match {
      case Some(o: JsObject) => o.fields.get("roots").collect { case JsArray(els) => els }.getOrElse(Vector.empty)
      case _                 => Vector.empty
    }
    val inlineRoots = request.roots.zipWithIndex.filter(_._1.`type`.isDefined)
    if (inlineRoots.isEmpty) NoInlineRoots
    else if (summaryRoots.size != request.roots.size) CountMismatch(request.roots.size, summaryRoots.size)
    else {
      val sources = inlineRoots.flatMap { case (root, idx) =>
        summaryRoots(idx) match {
          case JsObject(fields) =>
            fields.get("dataSourceId").collect { case JsString(id) => (DataSourceId(id), InlineSourceCleanup.isImplicitConnectorRoot(root)) }
          case _ => None
        }
      }
      Paired(sources, inlineRoots.size - sources.size)
    }
  }
}
