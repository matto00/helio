package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.{DataFieldType, Output, OutputKind}
import spray.json._

/** HEL-906 (P1.3 of the Pipelines & Outputs remodel) — wire shapes for
 *  `GET/POST /api/pipelines/:id/outputs` and `GET/PATCH/DELETE
 *  /api/outputs/:id`. `config`/`schema` are carried as raw `JsValue` (like
 *  `PanelResponse.config` / `AlertRuleProtocol.condition`) — an Output's
 *  `config` shape varies by `kind` (chart legend/tooltip/seriesColors/
 *  axisLabels for `chart`; `format` for `metric`/`collection`, HEL-876) and
 *  has no single case class this protocol could bind to. */
final case class OutputSchemaFieldResponse(name: String, `type`: String)

final case class OutputResponse(
    id: String,
    pipelineId: String,
    nodeStepId: Option[String],
    ownerId: String,
    name: String,
    kind: String,
    config: JsValue,
    schema: Vector[OutputSchemaFieldResponse],
    createdAt: String,
    updatedAt: String
)

final case class OutputsResponse(items: Vector[OutputResponse])

final case class CreateOutputRequest(
    nodeStepId: Option[String],
    kind: String,
    name: String,
    config: Option[JsObject]
)

/** `name`/`config` absent (`None`) means "leave unchanged" — there is no
 *  null-clearing variant for either field (an Output always has a name and a
 *  config object), so a plain `Option` captures the full absent-vs-present
 *  idiom with no need for the `Option[Option[T]]` wrapper HEL-362/HEL-623
 *  reach for when a field can also be explicitly nulled. `config`, when
 *  present, is merged into the stored config one level deep for
 *  `legend`/`tooltip`/`seriesColors`/`axisLabels` (HEL-877) rather than
 *  replacing `config` wholesale — see `OutputService.mergeConfig`. */
final case class UpdateOutputRequest(name: Option[String], config: Option[JsObject])

final case class OutputPanelPlacementResponse(panelId: String, dashboardId: String)

final case class DeleteOutputResponse(removedPanelIds: Vector[String])

trait OutputProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val outputSchemaFieldResponseFormat: RootJsonFormat[OutputSchemaFieldResponse] = jsonFormat2(OutputSchemaFieldResponse)
  implicit val outputResponseFormat: RootJsonFormat[OutputResponse]                       = jsonFormat10(OutputResponse)
  implicit val outputsResponseFormat: RootJsonFormat[OutputsResponse]                     = jsonFormat1(OutputsResponse)
  implicit val createOutputRequestFormat: RootJsonFormat[CreateOutputRequest]             = jsonFormat4(CreateOutputRequest)
  implicit val outputPanelPlacementResponseFormat: RootJsonFormat[OutputPanelPlacementResponse] = jsonFormat2(OutputPanelPlacementResponse)
  implicit val deleteOutputResponseFormat: RootJsonFormat[DeleteOutputResponse]           = jsonFormat1(DeleteOutputResponse)

  implicit val updateOutputRequestFormat: RootJsonFormat[UpdateOutputRequest] = jsonFormat2(UpdateOutputRequest)

  def outputResponseFrom(output: Output): OutputResponse = outputResponseFrom(output, JsObject.empty)

  def outputResponseFrom(output: Output, config: JsObject): OutputResponse =
    OutputResponse(
      id         = output.id.value,
      pipelineId = output.node.pipelineId.value,
      nodeStepId = output.node.stepId.map(_.value),
      ownerId    = output.ownerId.value,
      name       = output.name,
      kind       = OutputKind.asString(output.kind),
      config     = config,
      schema     = output.schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => OutputSchemaFieldResponse(sf.name, DataFieldType.asString(t)))),
      createdAt  = output.createdAt.toString,
      updatedAt  = output.updatedAt.toString
    )
}
