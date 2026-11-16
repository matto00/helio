package com.helio.api.protocols.workspace

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.api.protocols.pipelines.{PipelineAnalyzeProtocol, SchemaFieldResponse}
import spray.json._

//
// `WorkspaceSearchService.find`/`getResource`'s wire shapes -- deliberately NOT
// reuse of `WorkspaceContext*` for the compact `find` summary (design.md D6):
// those types carry per-type fields this compact contract doesn't need.
// `getResource`'s detail wraps the existing `WorkspaceContext{DataSource,
// Output,Pipeline,Dashboard}` types verbatim (reused, not re-modeled) -- `Output` is the
// live type; the wire discriminator string is still `"dataType"` (see `toDataTypeSummary`).
//
// HEL-904 task 3.2: the Metric branch (`WorkspaceResourceMetric`/
// `WorkspaceResourceDetail.MetricDetail`) is REMOVED outright, not retargeted
// -- metrics are retired (design.md decision 2/11), not a searchable kind
// anymore (see the `workspace-resource-search` OpenSpec delta's "DataTypes
// and Metrics are no longer a searchable kind" scenario).

/** `find`'s compact result shape -- id, resource type (`WorkspaceResourceType.asString`), name, and
 *  a one-line description (synthesized per resource type -- design.md D5). */
final case class WorkspaceResourceSummary(
    id: String,
    resourceType: String,
    name: String,
    description: String
)

/** `getResource`'s full-detail result (design.md D6) -- a closed union over the remaining resource
 *  types, wrapping the existing `WorkspaceContext{DataSource,Output,Pipeline,Dashboard}` types
 *  verbatim (reused, not re-modeled). */
sealed trait WorkspaceResourceDetail

/** HEL-1639 D1: the extra detail only `get_resource` returns. These are NEW types composed around the shared
 *  `WorkspaceContext*` ones (which back `GET /api/workspace/context` and its strict schema and stay untouched). */

/** One pipeline node: the step's id, its place in the lane tree, its config (secret-bearing keys redacted) and the
 *  schema the symbolic analyze projects AFTER it -- so a column can be located at the node that first has it. */
final case class ResourceNode(
    id: String,
    parentStepId: Option[String],
    rootId: Option[String],
    `type`: String,
    config: JsValue,
    disabled: Boolean,
    outputSchema: Vector[SchemaFieldResponse],
    validationError: Option[String]
)

/** One Output of a pipeline: where it hangs (`nodeStepId`, absent = the raw root) and its chart/table shape. */
final case class ResourceOutputRef(id: String, name: String, kind: String, nodeStepId: Option[String], fieldMapping: Option[JsValue])

/** One panel of a dashboard with the Output it is bound to and that Output's pipeline. */
final case class ResourceDashboardPanel(id: String, title: String, `type`: String, outputId: Option[String], outputPipelineId: Option[String])

object WorkspaceResourceDetail {
  final case class DataSourceDetail(value: WorkspaceContextDataSource) extends WorkspaceResourceDetail
  final case class DataTypeDetail(value: WorkspaceContextOutput, pipelineId: Option[String] = None, nodeStepId: Option[String] = None) extends WorkspaceResourceDetail
  final case class PipelineDetail(
      value: WorkspaceContextPipeline,
      nodes: Vector[ResourceNode] = Vector.empty,
      outputs: Vector[ResourceOutputRef] = Vector.empty
  ) extends WorkspaceResourceDetail
  final case class DashboardDetail(value: WorkspaceContextDashboard, panels: Vector[ResourceDashboardPanel] = Vector.empty) extends WorkspaceResourceDetail
}

trait WorkspaceResourceSearchProtocol extends SprayJsonSupport with DefaultJsonProtocol with WorkspaceContextProtocol with PipelineAnalyzeProtocol {
  implicit val workspaceResourceSummaryFormat: RootJsonFormat[WorkspaceResourceSummary] =
    jsonFormat4(WorkspaceResourceSummary.apply)

  implicit val resourceNodeFormat: RootJsonFormat[ResourceNode]                   = jsonFormat8(ResourceNode.apply)
  implicit val resourceOutputRefFormat: RootJsonFormat[ResourceOutputRef]         = jsonFormat5(ResourceOutputRef.apply)
  implicit val resourceDashboardPanelFormat: RootJsonFormat[ResourceDashboardPanel] = jsonFormat5(ResourceDashboardPanel.apply)

  /** Discriminated-union format, mirroring `PipelineStepProtocol.pipelineStepResponseFormat`'s
   *  hand-rolled dispatch pattern: writes/reads a `resourceType` field (the SAME wire values
   *  `WorkspaceResourceType.asString` produces) alongside each wrapped type's own fields, rather than
   *  nesting under a `value` key. */
  implicit object workspaceResourceDetailFormat extends RootJsonFormat[WorkspaceResourceDetail] {
    override def write(d: WorkspaceResourceDetail): JsValue = {
      // Optional extras are appended when present; the list extras are always written.
      def extra(pairs: (String, Option[JsValue])*): Map[String, JsValue] = pairs.collect { case (k, Some(v)) => k -> v }.toMap
      val (resourceType, inner) = d match {
        case WorkspaceResourceDetail.DataSourceDetail(v) => "dataSource" -> workspaceContextDataSourceFormat.write(v).asJsObject
        case WorkspaceResourceDetail.DataTypeDetail(v, pipelineId, nodeStepId) =>
          "dataType" -> JsObject(workspaceContextOutputFormat.write(v).asJsObject.fields ++
            extra("pipelineId" -> pipelineId.map(JsString(_)), "nodeStepId" -> nodeStepId.map(JsString(_))))
        case WorkspaceResourceDetail.PipelineDetail(v, nodes, outputs) =>
          "pipeline" -> JsObject(workspaceContextPipelineFormat.write(v).asJsObject.fields ++
            extra("nodes" -> Some(nodes.toJson), "outputs" -> Some(outputs.toJson)))
        case WorkspaceResourceDetail.DashboardDetail(v, panels) =>
          "dashboard" -> JsObject(workspaceContextDashboardFormat.write(v).asJsObject.fields ++
            extra("panels" -> Some(panels.toJson)))
      }
      JsObject(inner.fields + ("resourceType" -> JsString(resourceType)))
    }

    override def read(json: JsValue): WorkspaceResourceDetail =
      json.asJsObject.fields.get("resourceType") match {
        case Some(JsString("dataSource")) => WorkspaceResourceDetail.DataSourceDetail(workspaceContextDataSourceFormat.read(json))
        case Some(JsString("dataType")) =>
          val f = json.asJsObject.fields
          WorkspaceResourceDetail.DataTypeDetail(workspaceContextOutputFormat.read(json), f.get("pipelineId").map(_.convertTo[String]), f.get("nodeStepId").map(_.convertTo[String]))
        case Some(JsString("pipeline")) =>
          val f = json.asJsObject.fields
          WorkspaceResourceDetail.PipelineDetail(
            workspaceContextPipelineFormat.read(json),
            f.get("nodes").map(_.convertTo[Vector[ResourceNode]]).getOrElse(Vector.empty),
            f.get("outputs").map(_.convertTo[Vector[ResourceOutputRef]]).getOrElse(Vector.empty)
          )
        case Some(JsString("dashboard")) =>
          WorkspaceResourceDetail.DashboardDetail(
            workspaceContextDashboardFormat.read(json),
            json.asJsObject.fields.get("panels").map(_.convertTo[Vector[ResourceDashboardPanel]]).getOrElse(Vector.empty)
          )
        case other                        => deserializationError(s"Unknown or missing WorkspaceResourceDetail resourceType: $other")
      }
  }
}
