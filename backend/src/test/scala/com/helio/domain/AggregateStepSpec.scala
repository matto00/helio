package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Direct unit tests for [[AggregateStep.apply]] — no engine plumbing required.
 *  Covers all 5 aggregate functions × empty / single-row / multi-group / null /
 *  mixed-type edge cases, and confirms apply/infer parity for count. */
class AggregateStepSpec extends AnyWordSpec with Matchers {

  // ── Helpers ────────────────────────────────────────────────────────────────

  private def agg(alias: String, fn: String, field: String): Aggregation =
    Aggregation(alias, fn, field)

  private def groupField(name: String): AggregateField =
    AggregateField(name, "string")

  private def cfg(
      groupBy: Vector[AggregateField],
      aggregations: Vector[Aggregation]
  ): AggregateConfig =
    AggregateConfig(groupBy, aggregations)

  private def apply(
      rows: Seq[Map[String, Any]],
      groupBy: Vector[AggregateField],
      aggregations: Vector[Aggregation]
  ): Seq[Map[String, Any]] =
    AggregateStep.apply(rows, cfg(groupBy, aggregations))

  // ── 1.2  Empty rows → empty output ────────────────────────────────────────

  "AggregateStep.apply" should {

    "return empty Seq when rows input is empty" in {
      val result = apply(
        rows         = Seq.empty,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("total", "sum", "age"))
      )
      result shouldBe empty
    }

    // ── 1.3  Empty groupBy collapses all rows to one output row ──────────────

    "collapse all rows to one output row when groupBy is empty" in {
      val rows = Seq(
        Map[String, Any]("age" -> 10.0),
        Map[String, Any]("age" -> 20.0),
        Map[String, Any]("age" -> 30.0)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector.empty,
        aggregations = Vector(agg("total", "sum", "age"))
      )
      result should have size 1
      result.head("total") shouldBe 60.0
    }

    // ── 1.4  All-null field: sum → 0.0; avg / min / max → null ──────────────

    "return 0.0 for sum of an all-null field" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> null),
        Map[String, Any]("dept" -> "eng", "score" -> null)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("total", "sum", "score"))
      )
      result should have size 1
      result.head("total") shouldBe 0.0
    }

    "return null for avg of an all-null field" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> null),
        Map[String, Any]("dept" -> "eng", "score" -> null)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("avg_score", "avg", "score"))
      )
      result should have size 1
      result.head("avg_score").asInstanceOf[AnyRef] shouldBe null
    }

    "return null for min of an all-null field" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "score" -> null))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("mn", "min", "score"))
      )
      result.head("mn").asInstanceOf[AnyRef] shouldBe null
    }

    "return null for max of an all-null field" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "score" -> null))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("mx", "max", "score"))
      )
      result.head("mx").asInstanceOf[AnyRef] shouldBe null
    }

    // ── 1.5  count of all-null field → 0L ────────────────────────────────────

    "return 0L for count of an all-null field" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> null),
        Map[String, Any]("dept" -> "eng", "score" -> null)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("n", "count", "score"))
      )
      result should have size 1
      result.head("n") shouldBe 0L
    }

    // ── 1.6  Multi-group sum ──────────────────────────────────────────────────

    "produce correct sum per group for multi-group input" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "revenue" -> 100.0),
        Map[String, Any]("dept" -> "eng", "revenue" -> 50.0),
        Map[String, Any]("dept" -> "mkt", "revenue" -> 200.0)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("total_rev", "sum", "revenue"))
      )
      result should have size 2
      val engRow = result.find(_("dept") == "eng").get
      engRow("total_rev") shouldBe 150.0
      val mktRow = result.find(_("dept") == "mkt").get
      mktRow("total_rev") shouldBe 200.0
    }

    // ── 1.7  count returns Long (apply/infer parity) ──────────────────────────

    "return count as Long, consistent with inferred integer type" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> 10.0),
        Map[String, Any]("dept" -> "eng", "score" -> 20.0)
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("n", "count", "score"))
      )
      result should have size 1
      val countValue = result.head("n")
      countValue shouldBe 2L
      countValue shouldBe a [java.lang.Long]
    }

    // ── 1.8  min/max on string-typed field → null ─────────────────────────────

    "return null for min on a string-typed field (toDouble yields no numerics)" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "label" -> "alpha"),
        Map[String, Any]("dept" -> "eng", "label" -> "beta")
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("mn_label", "min", "label"))
      )
      result should have size 1
      result.head("mn_label").asInstanceOf[AnyRef] shouldBe null
    }

    "return null for max on a string-typed field (toDouble yields no numerics)" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "label" -> "alpha"),
        Map[String, Any]("dept" -> "eng", "label" -> "beta")
      )
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("mx_label", "max", "label"))
      )
      result should have size 1
      result.head("mx_label").asInstanceOf[AnyRef] shouldBe null
    }

    // ── Single-row edge cases ──────────────────────────────────────────────────

    "handle single-row input for sum" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "age" -> 42.0))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("total", "sum", "age"))
      )
      result should have size 1
      result.head("total") shouldBe 42.0
    }

    "handle single-row input for count" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "age" -> 42.0))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("n", "count", "age"))
      )
      result should have size 1
      result.head("n") shouldBe 1L
    }

    "handle single-row input for avg" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "age" -> 42.0))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("avg_age", "avg", "age"))
      )
      result should have size 1
      result.head("avg_age") shouldBe 42.0
    }

    "handle single-row input for min and max" in {
      val rows = Seq(Map[String, Any]("dept" -> "eng", "age" -> 42.0))
      val result = apply(
        rows         = rows,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(
          agg("mn", "min", "age"),
          agg("mx", "max", "age")
        )
      )
      result should have size 1
      result.head("mn") shouldBe 42.0
      result.head("mx") shouldBe 42.0
    }
  }
}
