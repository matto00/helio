package com.helio.domain.insights

import spray.json.JsObject

import java.time.Instant

/** One cited value (HEL-1741 D3). A numeric citation carries `number`; a date citation carries `date`.
 *  `isPct` marks a percent-change value, the only kind a `%` numeral may match. */
final case class Citation(
    id: String,
    outputId: String,
    field: String,
    number: Option[Double],
    date: Option[Instant],
    capturedAt: Option[Instant],
    isPct: Boolean = false
)

/** The bounded grounding pack: `json` is the structure, `serialized` the escaped compact text that goes
 *  inside the data block (D4). */
final case class InsightPack(json: JsObject, citations: Vector[Citation], serialized: String) {
  def citationById: Map[String, Citation] = citations.map(c => c.id -> c).toMap
}

object InsightPack {

  /** Every structural key a pack may contain. Row column names are data, not structure. */
  val TopLevelKeys: Set[String]   = Set("citations", "head", "compares", "windows")
  val CitationKeys: Set[String]   = Set("id", "outputId", "field", "value", "capturedAt")
  val HeadKeys: Set[String]       = Set("outputId", "capturedAt", "columns", "rowCount", "rows")
  val RowKeys: Set[String]        = Set("rank", "data")
  val CompareKeys: Set[String]    = Set("outputId", "outputName", "field", "compare", "current", "baseline", "delta", "pct", "currentAt", "baselineAt", "compareWindowDays")
  val WindowKeys: Set[String]     = Set("outputId", "label", "points")
  val WindowPointKeys: Set[String] = Set("t", "v")
  val CellKeys: Set[String]       = Set("cite", "v")
}
