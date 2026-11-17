package com.helio.domain.insights

import com.helio.domain.insights.InsightLimits
import spray.json._

import java.time.Instant

/** Shared inputs for the insight specs. Fake data only. */
object InsightFixtures {

  val t1: Instant = Instant.parse("2026-11-14T10:00:00Z")
  val t0: Instant = Instant.parse("2026-11-07T10:00:00Z")

  val compare: InsightCompare =
    InsightCompare("o1", "Revenue", "revenue", "7d", Some(1234.4), Some(1409.0), Some(-174.6), Some(-12.4), Some(t1), Some(t0))

  def row(fields: (String, JsValue)*): JsObject = JsObject(fields.toMap)

  /** Two-row head: c1..c7 compare, c8 head capturedAt, c9 rowCount, row 1 rank c10 / amount c11, row 2 rank c12 / amount c13. */
  val inputs: InsightInputs = InsightInputs(
    Some(
      InsightHead(
        "o1",
        t1,
        Vector("name", "amount"),
        Vector(row("name" -> JsString("alpha"), "amount" -> JsString("1234")), row("name" -> JsString("beta"), "amount" -> JsNumber(77)))
      )
    ),
    Vector(compare),
    Vector.empty
  )

  val spec: InsightRenderSpec = InsightRenderSpec(maxSentences = 3, maxChars = 300)

  /** Rough but deterministic token estimator for tests that do not need the real tokenizer. */
  val wordEstimator: Seq[String] => Int = _.map(_.split("\\s+").length).sum

  def pack(in: InsightInputs = inputs): InsightPack = InsightContextBuilder.pack(in, 50, InsightLimits())

  def idOf(p: InsightPack, field: String): String = p.citations.find(_.field == field).map(_.id).getOrElse(sys.error(s"no citation for $field"))
}
