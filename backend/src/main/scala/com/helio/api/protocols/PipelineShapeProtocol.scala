package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.DataFieldType
import com.helio.domain.shapes.{OutputContract, OutputFieldContract, RowCountContract, ShapeParamDescriptor, ShapeStepExpansion}
import com.helio.services.PipelineShapeCatalogEntry
import spray.json._

// ── Pipeline shape catalog API types (HEL-391) ───────────────────────────────
//
// `GET /api/pipeline-shapes` wire shape. `ShapeParamDescriptor` (domain,
// com.helio.domain.shapes) is reused directly on the wire — every field is
// already wire-shaped (String/Boolean) — mirroring `*Config` classes' direct
// reuse on the pipeline-step wire. `OutputFieldContract`/`OutputContract` get
// thin response wrappers below because `dataType: DataFieldType` needs the
// same string projection `InferredFieldResponse` already uses
// (`DataTypeProtocol.scala`).

/** Wire shape for one [[OutputFieldContract]] entry — `dataType` is projected to its canonical
 *  wire string via [[DataFieldType.asString]], mirroring `InferredFieldResponse`. */
final case class OutputFieldContractResponse(name: String, dataType: String, nullable: Boolean)

object OutputFieldContractResponse {
  def fromDomain(field: OutputFieldContract): OutputFieldContractResponse =
    OutputFieldContractResponse(
      name     = field.name,
      dataType = DataFieldType.asString(field.dataType),
      nullable = field.nullable
    )
}

/** Wire shape for one [[OutputContract]] — `rowCount` reuses the domain `RowCountContract` type
 *  directly via [[PipelineShapeProtocol.rowCountContractFormat]]'s discriminated-union format. */
final case class OutputContractResponse(
    rowCount: RowCountContract,
    fields: Vector[OutputFieldContractResponse],
    description: String
)

object OutputContractResponse {
  def fromDomain(contract: OutputContract): OutputContractResponse =
    OutputContractResponse(
      rowCount    = contract.rowCount,
      fields      = contract.fields.map(OutputFieldContractResponse.fromDomain),
      description = contract.description
    )
}

/** Wire shape for one [[PipelineShapeCatalogEntry]], as returned by `GET /api/pipeline-shapes`. */
final case class PipelineShapeCatalogEntryResponse(
    id: String,
    label: String,
    description: String,
    paramsSchema: Vector[ShapeParamDescriptor],
    outputContract: OutputContractResponse
)

object PipelineShapeCatalogEntryResponse {
  def fromDomain(entry: PipelineShapeCatalogEntry): PipelineShapeCatalogEntryResponse =
    PipelineShapeCatalogEntryResponse(
      id             = entry.id,
      label          = entry.label,
      description    = entry.description,
      paramsSchema   = entry.paramsSchema,
      outputContract = OutputContractResponse.fromDomain(entry.outputContract)
    )
}

// ── POST /api/pipeline-shapes/:id/expand wire shapes (HEL-402) ──────────────

/** Request body for `POST /api/pipeline-shapes/:id/expand` — the caller-supplied params passed
 *  straight through to [[com.helio.domain.shapes.PipelineShape.expand]] without server-side
 *  reshaping (the shape itself owns all params validation). */
final case class ExpandPipelineShapeRequest(params: JsObject)

/** Wire shape for one [[ShapeStepExpansion]] entry in the `expand` response array — a 1:1 mirror of
 *  `CreatePipelineStepRequest`'s `{type, config}` shape (`kind` here, not `` `type` ``, matching the
 *  domain field name directly since this isn't itself a create request). */
final case class ShapeStepExpansionResponse(kind: String, config: JsObject)

object ShapeStepExpansionResponse {
  def fromDomain(expansion: ShapeStepExpansion): ShapeStepExpansionResponse =
    ShapeStepExpansionResponse(kind = expansion.kind, config = expansion.config)
}

trait PipelineShapeProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  implicit val shapeParamDescriptorFormat: RootJsonFormat[ShapeParamDescriptor] =
    jsonFormat5(ShapeParamDescriptor.apply)

  /** Discriminated-union format for the closed `RowCountContract` set — `{"kind": "exactly-one"}`,
   *  `{"kind": "at-most-param", "paramName": "..."}`, `{"kind": "unbounded"}`. Each branch writes
   *  only the keys its wire shape calls for (no stray `paramName` on the other two cases). */
  implicit val rowCountContractFormat: RootJsonFormat[RowCountContract] = new RootJsonFormat[RowCountContract] {
    def write(rowCount: RowCountContract): JsValue = rowCount match {
      case RowCountContract.ExactlyOne => JsObject("kind" -> JsString("exactly-one"))
      case RowCountContract.AtMostParam(paramName) =>
        JsObject("kind" -> JsString("at-most-param"), "paramName" -> JsString(paramName))
      case RowCountContract.Unbounded => JsObject("kind" -> JsString("unbounded"))
    }

    def read(json: JsValue): RowCountContract =
      json.asJsObject.fields.get("kind") match {
        case Some(JsString("exactly-one")) => RowCountContract.ExactlyOne
        case Some(JsString("at-most-param")) =>
          json.asJsObject.fields.get("paramName") match {
            case Some(JsString(paramName)) => RowCountContract.AtMostParam(paramName)
            case _ => deserializationError("rowCount kind 'at-most-param' requires a string 'paramName'")
          }
        case Some(JsString("unbounded")) => RowCountContract.Unbounded
        case other => deserializationError(s"Unknown rowCount kind: $other")
      }
  }

  implicit val outputFieldContractResponseFormat: RootJsonFormat[OutputFieldContractResponse] =
    jsonFormat3(OutputFieldContractResponse.apply)
  implicit val outputContractResponseFormat: RootJsonFormat[OutputContractResponse] =
    jsonFormat3(OutputContractResponse.apply)
  implicit val pipelineShapeCatalogEntryResponseFormat: RootJsonFormat[PipelineShapeCatalogEntryResponse] =
    jsonFormat5(PipelineShapeCatalogEntryResponse.apply)

  implicit val expandPipelineShapeRequestFormat: RootJsonFormat[ExpandPipelineShapeRequest] =
    jsonFormat1(ExpandPipelineShapeRequest.apply)
  implicit val shapeStepExpansionResponseFormat: RootJsonFormat[ShapeStepExpansionResponse] =
    jsonFormat2(ShapeStepExpansionResponse.apply)
}
