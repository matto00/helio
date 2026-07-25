package com.helio.services

import com.helio.domain.shapes.{OutputContract, PipelineShape, ShapeParamDescriptor, ShapeStepExpansion}
import spray.json.JsObject

import scala.concurrent.Future

/** One [[PipelineShape]] projected for catalog display — id/label/description/paramsSchema/
 *  outputContract, dropping the shape's `expand` behavior. Kept distinct from [[PipelineShape]]
 *  itself so a later ticket's caller (e.g. HEL-400's MCP tool) can consume plain catalog data
 *  without holding a reference to the shape's executable `expand` function. */
final case class PipelineShapeCatalogEntry(
    id: String,
    label: String,
    description: String,
    paramsSchema: Vector[ShapeParamDescriptor],
    outputContract: OutputContract
)

object PipelineShapeCatalogEntry {
  def fromShape(shape: PipelineShape): PipelineShapeCatalogEntry =
    PipelineShapeCatalogEntry(
      id             = shape.id,
      label          = shape.label,
      description    = shape.description,
      paramsSchema   = shape.paramsSchema,
      outputContract = shape.outputContract
    )
}

/** Business logic for `GET /api/pipeline-shapes` (HEL-391 design.md Decision 5 — a real, if thin,
 *  service per the ticket's explicit "logic in a service" instruction, unlike `ConnectorRoutes`
 *  which predates that instruction). No repository or `ActorSystem` dependency: `PipelineShape.Registry`
 *  is a static, code-level registry, like `ConnectorRegistry`. */
final class PipelineShapeService {

  /** Every registered shape, projected to catalog entries and sorted by `id` for a stable,
   *  deterministic response ordering. */
  def catalog(): Vector[PipelineShapeCatalogEntry] =
    PipelineShape.Registry.values.toVector
      .sortBy(_.id)
      .map(PipelineShapeCatalogEntry.fromShape)

  /** Backing logic for `POST /api/pipeline-shapes/:id/expand` (HEL-402 design.md Decision 4) — the
   *  first HTTP caller of [[PipelineShape.expand]]. `expand` itself is pure/synchronous; the result
   *  is wrapped in `Future.successful` purely to match [[ServiceResponse.run]]'s
   *  `Future[Either[ServiceError, A]]` call shape, the same as every other route in this tree. An
   *  unknown shape id maps to `ServiceError.NotFound`; a params-validation failure from the shape's
   *  own `expand` maps to `ServiceError.UnprocessableEntity` with the shape's message verbatim. */
  def expand(id: String, params: JsObject): Future[Either[ServiceError, Vector[ShapeStepExpansion]]] =
    Future.successful {
      for {
        shape      <- PipelineShape.shapeFor(id).left.map(ServiceError.NotFound(_))
        expansions <- shape.expand(params).left.map(ServiceError.UnprocessableEntity(_))
      } yield expansions
    }
}
