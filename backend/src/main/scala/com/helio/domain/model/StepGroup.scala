package com.helio.domain.model

/** HEL-1136: the backend-owned display category for a [[PipelineStep.Companion]] (owner ruling 1
 *  — "the step group is backend-owned ... expose it through the API", ticket.md). Declared here as
 *  a sealed ADT (not a bare string) so [[Registry]]'s ids/labels/order are a single, exhaustive,
 *  compile-checked source — a companion can only reference a group that actually exists, and a
 *  typo can't silently mint a new, undeclared category the palette would never show a header for.
 *
 *  Not every step declares a group (`PipelineStep.Companion.group: Option[StepGroup]`, defaulted
 *  `None`) — owner ruling 2 makes an ungrouped step a first-class, permanent option, not an error.
 *  `assert` is deliberately left ungrouped (see its own companion) so the ungrouped path is
 *  exercised by a real, shipped step rather than only by a fixture. */
sealed trait StepGroup {
  def id: String
  def label: String
}

object StepGroup {
  case object FilterShape extends StepGroup {
    val id    = "filter-shape"
    val label = "Filter & shape"
  }
  case object Aggregate extends StepGroup {
    val id    = "aggregate"
    val label = "Aggregate"
  }
  case object Combine extends StepGroup {
    val id    = "combine"
    val label = "Combine"
  }
  case object ComputeCast extends StepGroup {
    val id    = "compute-cast"
    val label = "Compute & cast"
  }
  case object ContentFiles extends StepGroup {
    val id    = "content-files"
    val label = "Content & files"
  }
  case object Ai extends StepGroup {
    val id    = "ai"
    val label = "AI"
  }
  case object WriteBack extends StepGroup {
    val id    = "write-back"
    val label = "Write-back"
  }

  /** The declared display order — a client conveys groups by walking this `Vector`, never by
   *  sorting on `id`/`label` itself (design.md Decision 3: order-bearing data must be an array,
   *  never derived from `JsObject` keys, which spray-json sorts). Adding a group means adding one
   *  line here; nothing else in this object needs to change. */
  val All: Vector[StepGroup] =
    Vector(FilterShape, Aggregate, Combine, ComputeCast, ContentFiles, Ai, WriteBack)
}
