package com.helio.domain.engine

import org.slf4j.LoggerFactory
import spray.json._

import ColumnSchemaInference.{inferAggregate, inferCast, inferCompute, inferGroupBy, inferRename, inferSelect}
import MultiInputSchemaInference.{inferJoin, inferLookup, inferUnion}
import ReshapeSchemaInference.{inferAssert, inferDateBucket, inferPivot, inferStringOps, inferUnpivot, inferWindow}
import TextSchemaInference.{inferAnalyzeWithAi, inferChunkByTokenCount, inferConvertFormat, inferExtractHeadings, inferGenerateText, inferSplitText}

/** HEL-1385: per-op schema inference dispatch and the shared tolerant `parseConfig` wrapper. */
private[engine] object StepSchemaInference {

  private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)

  // HEL-1385: `private[engine]` so the `PipelineAnalyzeService.inferOutputSchema` forwarder can call it.
  private[engine] def inferOutputSchema(
      op:              String,
      config:          String,
      inputSchema:     Vector[SchemaField],
      secondarySchema: Option[Vector[SchemaField]] = None
  ): (Vector[SchemaField], Option[String]) =
    op match {
      // HEL-1100 (design.md D8): `upsertsource` is a terminal write step that never transforms
      // its rows -- a downstream child sees exactly its input schema unchanged, same as
      // `assert`'s pass-through-with-side-effect shape.
      case "filter" | "limit" | "sort" | "dedupe" | "fillnull" | "upsertsource" => (inputSchema, None)
      // HEL-911 (design.md Engine contract item 12, evaluation-1.md CR3): `union`/`join`
      // project a schema derived from BOTH inputs when the secondary input is `lane`-kind
      // and its schema was resolvable (see `analyzeNodes`/`laneDependencyOf`). For a
      // `source`-kind secondary input, `secondarySchema` is always `None` here (this layer
      // has no repo access to resolve a `DataSource`'s schema) -- both fall back to the
      // pre-existing documented best-effort passthrough in that case, unchanged. `join` is
      // a REAL dispatch case now (it had none before this ticket, silently falling to the
      // `unknown`-op arm below and reporting a spurious "Unknown op: 'join'" on every
      // analyze call for a join step -- fixed here as part of implementing this contract
      // item, since design.md's Engine contract item 12 names `join` alongside `union`/
      // `lookup` explicitly).
      case "union"                      => inferUnion(inputSchema, secondarySchema)
      case "join"                       => inferJoin(config, inputSchema, secondarySchema)
      case "select"                     => inferSelect(config, inputSchema)
      case "rename"                     => inferRename(config, inputSchema)
      case "cast"                       => inferCast(config, inputSchema)
      case "compute"                    => inferCompute(config, inputSchema)
      case "aggregate"                  => inferAggregate(config, inputSchema)
      case "splittext"                  => inferSplitText(config, inputSchema)
      case "extractheadings"            => inferExtractHeadings(config, inputSchema)
      case "chunkbytokencount"          => inferChunkByTokenCount(config, inputSchema)
      case "datebucket"                 => inferDateBucket(config, inputSchema)
      case "pivot"                      => inferPivot(config, inputSchema)
      case "window"                     => inferWindow(config, inputSchema)
      case "unpivot"                    => inferUnpivot(config, inputSchema)
      case "stringops"                  => inferStringOps(config, inputSchema)
      case "lookup"                     => inferLookup(config, inputSchema, secondarySchema)
      case "assert"                     => inferAssert(config, inputSchema)
      case "groupby"                    => inferGroupBy(config, inputSchema)
      case "convertformat"              => inferConvertFormat(config, inputSchema)
      case "analyzewithai"              => inferAnalyzeWithAi(config, inputSchema)
      case "generatetext"               => inferGenerateText(config, inputSchema)
      case unknown                      =>
        (inputSchema, Some(s"Unknown op: '$unknown'"))
    }

  /** Safely parse the JSON config and apply the transformation.
   *  On any parse/extraction failure, returns (inputSchema, Some(errorMessage)). */
  private[engine] def parseConfig(op: String, config: String)(
      fn: JsObject => Vector[SchemaField]
  )(fallback: Vector[SchemaField]): (Vector[SchemaField], Option[String]) =
    try {
      val json   = config.parseJson.asJsObject
      val output = fn(json)
      (output, None)
    } catch {
      case ex: Exception =>
        // HEL-311: keep the "<op> config error" category, drop the raw
        // exception tail; log the detail.
        log.warn(s"$op config error", ex)
        (fallback, Some(s"$op config error"))
    }
}
