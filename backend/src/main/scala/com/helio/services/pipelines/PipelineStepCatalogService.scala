package com.helio.services.pipelines

import com.helio.domain.model.{PipelineStep, StepGroup}

/** One [[PipelineStep.Registry]] entry projected for catalog display — HEL-1136 (design.md
 *  Decision 1). Kept distinct from [[PipelineStep.Companion]] itself so a caller can consume plain
 *  catalog data without holding a reference to the companion's codec/validation behavior, mirroring
 *  [[PipelineShapeCatalogEntry]]'s relationship to `PipelineShape`. */
final case class PipelineStepCatalogEntry(
    kind: String,
    label: String,
    description: String,
    group: Option[StepGroup],
    authorable: Boolean
)

/** The full catalog response shape: groups in their declared display order, plus one entry per
 *  registered step kind (design.md Decision 3 — both are ORDERED sequences, never conveyed via
 *  object-key order). */
final case class PipelineStepCatalog(
    groups: Vector[StepGroup],
    steps: Vector[PipelineStepCatalogEntry]
)

/** Business logic for `GET /api/pipeline-step-catalog` (design.md Decision 2). No repository or
 *  `ActorSystem` dependency: `PipelineStep.Registry` is a static, code-level registry, exactly like
 *  `PipelineShapeService`'s relationship to `PipelineShape.Registry`. */
final class PipelineStepCatalogService {

  /** Every registered step kind, projected to a catalog entry. A human-readable `label` is derived
   *  from `kind` (title-cased) rather than duplicated as a separate companion field — the ticket's
   *  ACs require label/description/group/authorability on the wire, and `catalogDescription`
   *  already carries the field that genuinely needs per-kind authorial text; a second free-text
   *  `label` field per companion would be redundant with the deterministic kind string. */
  def catalog(): PipelineStepCatalog = {
    val entries = PipelineStep.Registry.toVector
      .sortBy(_._1)
      .map { case (kind, companion) =>
        PipelineStepCatalogEntry(
          kind        = kind,
          label       = PipelineStepCatalogService.labelFor(kind),
          description = companion.catalogDescription,
          group       = companion.group,
          authorable  = companion.authorable
        )
      }
    PipelineStepCatalog(groups = StepGroup.All, steps = entries)
  }
}

object PipelineStepCatalogService {

  /** `"chunkbytokencount"` -> `"Chunk by token count"`. Every registered kind is a single lowercase
   *  word (no separators on the wire discriminator — see `PipelineStepKind`), so there is no
   *  reliable word-boundary to split on generically; each kind gets an explicit, readable label
   *  here instead of a naive titleization that would render "Chunkbytokencount". */
  private val Labels: Map[String, String] = Map(
    "select"             -> "Select fields",
    "rename"              -> "Rename column",
    "filter"              -> "Filter rows",
    "compute"             -> "Compute column",
    "aggregate"           -> "Group & aggregate",
    "cast"                -> "Cast type",
    "limit"               -> "Limit rows",
    "sort"                -> "Sort rows",
    "splittext"           -> "Split text",
    "extractheadings"     -> "Extract headings",
    "chunkbytokencount"   -> "Chunk by token count",
    "datebucket"          -> "Date bucket",
    "pivot"               -> "Pivot (long → wide)",
    "window"              -> "Window (rank / running total)",
    "unpivot"             -> "Unpivot (wide → long)",
    "dedupe"              -> "Dedupe rows",
    "fillnull"            -> "Fill null / impute",
    "stringops"           -> "String operation",
    "union"               -> "Union / append rows",
    "lookup"              -> "Lookup / enrich",
    "assert"              -> "Assert / validate",
    "upsertsource"        -> "Write to source",
    "convertformat"       -> "Convert format",
    "analyzewithai"       -> "Analyze with AI",
    "generatetext"        -> "Generate text",
    "join"                -> "Join tables",
    "groupby"             -> "Group by (legacy)"
  )

  /** Falls back to a bare capitalization of `kind` for a future registered kind this map hasn't
   *  been updated for yet — never throws, so a newly registered kind still appears in the catalog
   *  (`pipeline-step-catalog-api` spec's "a newly registered kind appears without editing the
   *  catalog surface" scenario) even before its label is added here. */
  def labelFor(kind: String): String =
    Labels.getOrElse(kind, kind.take(1).toUpperCase + kind.drop(1))
}
