package com.helio.services.pipelines

/** HEL-1308: the display-format vocabulary of an Output's `config.format` (metric, collection) and
 *  `config.columnFormats` (table). Documentation only -- the values are opaque to the backend (no value validator
 *  exists for them; an unknown value renders unformatted in the client). Each list mirrors the frontend readers
 *  and helio-mcp; the shared seam fixture `duration-format-seam.json` pins all three sides to the same lists and
 *  sentence. */
object OutputFormatVocabulary {

  val MetricFormats: Vector[String]        = Vector("number", "integer", "currency", "percent", "duration", "durationMs")
  val ColumnFormatTypes: Vector[String]    = Vector("number", "currency", "date", "text", "duration")
  val ColumnDurationUnits: Vector[String]  = Vector("s", "ms")

  /** Appended to [[OutputConfigValidation.KeysDoc]]. */
  val Doc: String =
    s"Display formats: a metric or collection `format` is one of ${MetricFormats.mkString(", ")} " +
      "(duration reads seconds, durationMs reads milliseconds); " +
      "a table `columnFormats` entry is { type, decimals?, currency?, datePattern?, unit? } " +
      s"where type is one of ${ColumnFormatTypes.mkString(", ")}, " +
      s"and unit (duration only) is one of ${ColumnDurationUnits.mkString(", ")} (default s)."
}
