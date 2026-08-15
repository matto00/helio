package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.MetricFormat
import spray.json._

// ── Workspace resource search API types (HEL-661) ────────────────────────────
//
// `WorkspaceSearchService.find`/`getResource`'s wire shapes — deliberately NOT
// reuse of `WorkspaceContext*` for the compact `find` summary (design.md D6):
// those types carry per-type fields this compact contract doesn't need.
// `getResource`'s detail wraps the existing `WorkspaceContext{DataSource,
// DataType,Pipeline,Dashboard}` types verbatim for 4 of 5 cases (reused, not
// re-modeled), plus the new `WorkspaceResourceMetric` for the 5th (no
// existing `WorkspaceContext*` analog — `WorkspaceContextService` has never
// modeled metrics).

/** `find`'s compact result shape — id, resource type (`WorkspaceResourceType.asString`), name, and
 *  a one-line description (real for metrics, synthesized for the other 4 types — design.md D5). */
final case class WorkspaceResourceSummary(
    id: String,
    resourceType: String,
    name: String,
    description: String
)

/** Metric's `getResource` detail shape (design.md D6) — built directly from `MetricDefinition`
 *  (`MetricService.findById`'s owner-scoped result); no existing `WorkspaceContext*` converter to
 *  reuse, unlike the other 4 resource types. */
final case class WorkspaceResourceMetric(
    id: String,
    name: String,
    description: Option[String],
    measureField: String,
    aggregation: String,
    allowedDimensions: Vector[String],
    format: MetricFormat,
    deprecated: Boolean
)

/** `getResource`'s full-detail result (design.md D6) — a closed union over the 5 resource types,
 *  wrapping the existing `WorkspaceContext{DataSource,DataType,Pipeline,Dashboard}` types verbatim
 *  (reused, not re-modeled) plus the new `WorkspaceResourceMetric` for the metric case. */
sealed trait WorkspaceResourceDetail

object WorkspaceResourceDetail {
  final case class DataSourceDetail(value: WorkspaceContextDataSource) extends WorkspaceResourceDetail
  final case class DataTypeDetail(value: WorkspaceContextDataType) extends WorkspaceResourceDetail
  final case class PipelineDetail(value: WorkspaceContextPipeline) extends WorkspaceResourceDetail
  final case class DashboardDetail(value: WorkspaceContextDashboard) extends WorkspaceResourceDetail
  final case class MetricDetail(value: WorkspaceResourceMetric) extends WorkspaceResourceDetail
}

trait WorkspaceResourceSearchProtocol extends SprayJsonSupport with DefaultJsonProtocol with WorkspaceContextProtocol with MetricProtocol {
  implicit val workspaceResourceSummaryFormat: RootJsonFormat[WorkspaceResourceSummary] =
    jsonFormat4(WorkspaceResourceSummary.apply)

  implicit val workspaceResourceMetricFormat: RootJsonFormat[WorkspaceResourceMetric] =
    jsonFormat8(WorkspaceResourceMetric.apply)

  /** Discriminated-union format, mirroring `PipelineStepProtocol.pipelineStepResponseFormat`'s
   *  hand-rolled dispatch pattern: writes/reads a `resourceType` field (the SAME wire values
   *  `WorkspaceResourceType.asString` produces) alongside each wrapped type's own fields, rather than
   *  nesting under a `value` key. */
  implicit object workspaceResourceDetailFormat extends RootJsonFormat[WorkspaceResourceDetail] {
    override def write(d: WorkspaceResourceDetail): JsValue = {
      val (resourceType, inner) = d match {
        case WorkspaceResourceDetail.DataSourceDetail(v) => "dataSource" -> workspaceContextDataSourceFormat.write(v).asJsObject
        case WorkspaceResourceDetail.DataTypeDetail(v)   => "dataType"   -> workspaceContextDataTypeFormat.write(v).asJsObject
        case WorkspaceResourceDetail.PipelineDetail(v)   => "pipeline"   -> workspaceContextPipelineFormat.write(v).asJsObject
        case WorkspaceResourceDetail.DashboardDetail(v)  => "dashboard"  -> workspaceContextDashboardFormat.write(v).asJsObject
        case WorkspaceResourceDetail.MetricDetail(v)     => "metric"     -> workspaceResourceMetricFormat.write(v).asJsObject
      }
      JsObject(inner.fields + ("resourceType" -> JsString(resourceType)))
    }

    override def read(json: JsValue): WorkspaceResourceDetail =
      json.asJsObject.fields.get("resourceType") match {
        case Some(JsString("dataSource")) => WorkspaceResourceDetail.DataSourceDetail(workspaceContextDataSourceFormat.read(json))
        case Some(JsString("dataType"))   => WorkspaceResourceDetail.DataTypeDetail(workspaceContextDataTypeFormat.read(json))
        case Some(JsString("pipeline"))   => WorkspaceResourceDetail.PipelineDetail(workspaceContextPipelineFormat.read(json))
        case Some(JsString("dashboard"))  => WorkspaceResourceDetail.DashboardDetail(workspaceContextDashboardFormat.read(json))
        case Some(JsString("metric"))     => WorkspaceResourceDetail.MetricDetail(workspaceResourceMetricFormat.read(json))
        case other                        => deserializationError(s"Unknown or missing WorkspaceResourceDetail resourceType: $other")
      }
  }
}
