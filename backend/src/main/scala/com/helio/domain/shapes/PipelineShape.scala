package com.helio.domain.shapes

import spray.json.JsObject

/** A named, parameterized pipeline template — the HEL-337 "smart pipeline shape" foundation
 *  abstraction (HEL-391). A shape expands into ordinary [[com.helio.domain.PipelineStep]] create
 *  payloads given its params (shapes are authoring sugar over the existing step engine, not a new
 *  execution path) and declares the output row-shape it guarantees via [[outputContract]].
 *
 *  Not `sealed` (mirrors [[com.helio.domain.PipelineStep]]'s own non-`sealed` trait + companion
 *  `Registry` pattern): discipline is enforced via [[PipelineShape.Registry]] — only shapes
 *  registered there are reachable through the catalog endpoint or `shapeFor`. */
trait PipelineShape {

  /** Stable identifier, e.g. `"passthrough"` — the [[PipelineShape.Registry]] key. */
  def id: String

  /** Human-readable label, e.g. `"Passthrough"`. */
  def label: String

  /** Human-readable explanation of what the shape does. */
  def description: String

  /** Descriptive metadata for every param `expand` accepts. */
  def paramsSchema: Vector[ShapeParamDescriptor]

  /** The output row-shape this shape guarantees, declared once for the shape (not computed per
   *  `expand` call — HEL-391 design.md Decision 2). */
  def outputContract: OutputContract

  /** Expand `params` into an ordered list of standard step create-payloads. Pure — no repository,
   *  network, or `ActorSystem` access. Returns `Left(message)` when `params` is missing a required
   *  field or fails to decode into this shape's typed params model, rather than throwing. */
  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]
}

object PipelineShape {

  /** Registry of every shape kind, keyed by [[PipelineShape.id]]. Single source of truth for both
   *  `shapeFor` lookup and the `GET /api/pipeline-shapes` catalog. Adding a new shape means adding
   *  one line here (mirrors [[com.helio.domain.PipelineStep.Registry]]'s per-kind-line pattern). */
  val Registry: Map[String, PipelineShape] = Map(
    PassthroughShape.id -> PassthroughShape,
    SingleRowShape.id   -> SingleRowShape,
    TopNShape.id        -> TopNShape,
    TimeSeriesShape.id  -> TimeSeriesShape,
    PivotMatrixShape.id -> PivotMatrixShape
  )

  /** Look up a shape by id, or `Left` with a message listing the registered ids. */
  def shapeFor(id: String): Either[String, PipelineShape] =
    Registry.get(id) match {
      case Some(shape) => Right(shape)
      case None =>
        Left(
          s"Unknown pipeline shape: '$id'. Valid values: ${Registry.keySet.toSeq.sorted.mkString(", ")}"
        )
    }
}
