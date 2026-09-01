package com.helio.api.protocols.workspace

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// `WorkspaceSearchService.find`/`getResource`'s wire shapes -- deliberately NOT
// reuse of `WorkspaceContext*` for the compact `find` summary (design.md D6):
// those types carry per-type fields this compact contract doesn't need.
// `getResource`'s detail wraps the existing `WorkspaceContext{DataSource,
// DataType,Pipeline,Dashboard}` types verbatim (reused, not re-modeled).
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
 *  types, wrapping the existing `WorkspaceContext{DataSource,DataType,Pipeline,Dashboard}` types
 *  verbatim (reused, not re-modeled). */
sealed trait WorkspaceResourceDetail

object WorkspaceResourceDetail {
  final case class DataSourceDetail(value: WorkspaceContextDataSource) extends WorkspaceResourceDetail
  final case class DataTypeDetail(value: WorkspaceContextOutput) extends WorkspaceResourceDetail
  final case class PipelineDetail(value: WorkspaceContextPipeline) extends WorkspaceResourceDetail
  final case class DashboardDetail(value: WorkspaceContextDashboard) extends WorkspaceResourceDetail
}

trait WorkspaceResourceSearchProtocol extends SprayJsonSupport with DefaultJsonProtocol with WorkspaceContextProtocol {
  implicit val workspaceResourceSummaryFormat: RootJsonFormat[WorkspaceResourceSummary] =
    jsonFormat4(WorkspaceResourceSummary.apply)

  /** Discriminated-union format, mirroring `PipelineStepProtocol.pipelineStepResponseFormat`'s
   *  hand-rolled dispatch pattern: writes/reads a `resourceType` field (the SAME wire values
   *  `WorkspaceResourceType.asString` produces) alongside each wrapped type's own fields, rather than
   *  nesting under a `value` key. */
  implicit object workspaceResourceDetailFormat extends RootJsonFormat[WorkspaceResourceDetail] {
    override def write(d: WorkspaceResourceDetail): JsValue = {
      val (resourceType, inner) = d match {
        case WorkspaceResourceDetail.DataSourceDetail(v) => "dataSource" -> workspaceContextDataSourceFormat.write(v).asJsObject
        case WorkspaceResourceDetail.DataTypeDetail(v)   => "dataType"   -> workspaceContextOutputFormat.write(v).asJsObject
        case WorkspaceResourceDetail.PipelineDetail(v)   => "pipeline"   -> workspaceContextPipelineFormat.write(v).asJsObject
        case WorkspaceResourceDetail.DashboardDetail(v)  => "dashboard"  -> workspaceContextDashboardFormat.write(v).asJsObject
      }
      JsObject(inner.fields + ("resourceType" -> JsString(resourceType)))
    }

    override def read(json: JsValue): WorkspaceResourceDetail =
      json.asJsObject.fields.get("resourceType") match {
        case Some(JsString("dataSource")) => WorkspaceResourceDetail.DataSourceDetail(workspaceContextDataSourceFormat.read(json))
        case Some(JsString("dataType"))   => WorkspaceResourceDetail.DataTypeDetail(workspaceContextOutputFormat.read(json))
        case Some(JsString("pipeline"))   => WorkspaceResourceDetail.PipelineDetail(workspaceContextPipelineFormat.read(json))
        case Some(JsString("dashboard"))  => WorkspaceResourceDetail.DashboardDetail(workspaceContextDashboardFormat.read(json))
        case other                        => deserializationError(s"Unknown or missing WorkspaceResourceDetail resourceType: $other")
      }
  }
}
