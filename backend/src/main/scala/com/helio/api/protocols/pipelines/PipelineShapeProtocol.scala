package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.shapes.{OutputContract, RowCountContract, ShapeParamDescriptor, ShapeStepExpansion}
import com.helio.services.pipelines.PipelineShapeCatalogEntry
import spray.json._

//
// `GET /api/pipeline-shapes` wire shape. `ShapeParamDescriptor` (domain,
// com.helio.domain.shapes) is reused directly on the wire — every field is
// already wire-shaped (String/Boolean) — mirroring `*Config` classes' direct
// reuse on the pipeline-step wire.

/** Wire shape for one [[OutputContract]] — `rowCount` reuses the domain `RowCountContract` type
 *  directly via [[PipelineShapeProtocol.rowCountContractFormat]]'s discriminated-union format. */
final case class OutputContractResponse(
    rowCount: RowCountContract,
    description: String
)

object OutputContractResponse {
  def fromDomain(contract: OutputContract): OutputContractResponse =
    OutputContractResponse(
      rowCount    = contract.rowCount,
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


/** Request body for `POST /api/pipeline-shapes/:id/expand` — the caller-supplied params passed
 *  straight through to [[com.helio.domain.shapes.PipelineShape.expand]] without server-side
 *  reshaping (the shape itself owns all params validation). */
final case class ExpandPipelineShapeRequest(params: JsObject)

/** Wire shape for one [[ShapeStepExpansion]] entry, one element of `ExpandPipelineShapeResponse`'s
 *  `steps` array (HEL-906 cycle 7, task 3.8: BREAKING envelope change from a bare array to
 *  `{steps, outputs?}`). `clientId`/`parentStepId` mirror `CreatePipelineTransactionalStepRequest`'s
 *  own chaining convention EXACTLY -- `clientId` is a synthetic per-response id (`"step-0"`,
 *  `"step-1"`, ...) assigned in expansion order, and `parentStepId` references the PRIOR entry's
 *  `clientId` (`None` for the first) -- so a caller can pass this array's `steps` DIRECTLY as
 *  `POST /api/pipelines`'s (or a future `POST /api/pipelines/:id/steps` batch endpoint's)
 *  `steps[]` without re-deriving the chain itself. Every `PipelineShape.expand` today produces a
 *  pure linear chain (no shape branches into multiple tails), so this is always a straight line;
 *  `parentStepId` still names the mechanism explicitly rather than leaving chain order implicit,
 *  so a future branching shape has a wire shape ready for it. */
final case class ShapeStepExpansionResponse(clientId: String, kind: String, config: JsObject, parentStepId: Option[String])

object ShapeStepExpansionResponse {
  /** Assigns synthetic `clientId`s (`"step-0"`, `"step-1"`, ...) in order and chains each entry's
   *  `parentStepId` to the PRIOR entry's `clientId` -- the whole `Vector` must be converted
   *  together (not per-element) since each entry needs to know its own index. */
  def fromDomain(expansions: Vector[ShapeStepExpansion]): Vector[ShapeStepExpansionResponse] =
    expansions.zipWithIndex.map { case (expansion, idx) =>
      ShapeStepExpansionResponse(
        clientId     = s"step-$idx",
        kind         = expansion.kind,
        config       = expansion.config,
        parentStepId = if (idx == 0) None else Some(s"step-${idx - 1}")
      )
    }
}

/** `POST /api/pipeline-shapes/:id/expand` response envelope (HEL-906 cycle 7, task 3.8,
 *  BREAKING -- was a bare `Vector[ShapeStepExpansionResponse]` array). `outputs` is `None` for
 *  EVERY shape today -- `PipelineShape.expand`'s domain contract has no output-declaration
 *  concept yet, so this is forward-compatible wire shape for a future shape that DOES declare
 *  one, not a currently-populated field. */
final case class ExpandPipelineShapeResponse(steps: Vector[ShapeStepExpansionResponse], outputs: Option[JsArray] = None)

object ExpandPipelineShapeResponse {
  def fromDomain(expansions: Vector[ShapeStepExpansion]): ExpandPipelineShapeResponse =
    ExpandPipelineShapeResponse(steps = ShapeStepExpansionResponse.fromDomain(expansions), outputs = None)
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

  implicit val outputContractResponseFormat: RootJsonFormat[OutputContractResponse] =
    jsonFormat2(OutputContractResponse.apply)
  implicit val pipelineShapeCatalogEntryResponseFormat: RootJsonFormat[PipelineShapeCatalogEntryResponse] =
    jsonFormat5(PipelineShapeCatalogEntryResponse.apply)

  implicit val expandPipelineShapeRequestFormat: RootJsonFormat[ExpandPipelineShapeRequest] =
    jsonFormat1(ExpandPipelineShapeRequest.apply)
  implicit val shapeStepExpansionResponseFormat: RootJsonFormat[ShapeStepExpansionResponse] =
    jsonFormat4(ShapeStepExpansionResponse.apply)
  implicit val expandPipelineShapeResponseFormat: RootJsonFormat[ExpandPipelineShapeResponse] =
    jsonFormat2(ExpandPipelineShapeResponse.apply)
}
