package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Direct unit tests for [[AggregateStep.apply]] — no engine plumbing required.
 *  Covers all 5 aggregate functions × empty / single-row / multi-group / null /
 *  mixed-type edge cases, and confirms apply/infer parity for count. */
class AggregateStepSpec extends AnyWordSpec with Matchers {


  private def agg(alias: String, fn: String, field: String): Aggregation =
    Aggregation(alias, fn, field)

  private def pct(alias: String, field: String, p: Double): Aggregation =
    Aggregation(alias, "percentile", field, Some(p))

  private def vals(field: String, values: Any*): Seq[Map[String, Any]] =
    values.map(v => Map[String, Any](field -> v))

  private def one(rows: Seq[Map[String, Any]], a: Aggregation): Any =
    apply(rows, Vector.empty, Vector(a)).head(a.alias)

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


  "AggregateStep.apply" should {

    // HEL-905 (design.md Decision 10, HEL-744 anti-over-fix guard): a NON-empty groupBy over
    // zero input rows still yields zero output rows -- the empty-groupBy special case
    // (below) must never leak into this arm.
    "return empty Seq when rows input is empty AND groupBy is non-empty" in {
      val result = apply(
        rows         = Seq.empty,
        groupBy      = Vector(groupField("dept")),
        aggregations = Vector(agg("total", "sum", "age"))
      )
      result shouldBe empty
    }

    // HEL-905 (design.md Decision 10, HEL-744): empty groupBy + zero input rows must yield
    // exactly ONE row -- a metric Output off an empty filter shows 0, not nothing.
    "return exactly one row with count=0 when rows AND groupBy are both empty" in {
      val result = apply(
        rows         = Seq.empty,
        groupBy      = Vector.empty,
        aggregations = Vector(agg("total", "count", "age"))
      )
      result should have size 1
      result.head("total") shouldBe 0L
    }

    "return one row with null for sum/avg/min/max when rows AND groupBy are both empty" in {
      val result = apply(
        rows         = Seq.empty,
        groupBy      = Vector.empty,
        aggregations = Vector(
          agg("total_sum", "sum", "age"),
          agg("total_avg", "avg", "age"),
          agg("total_min", "min", "age"),
          agg("total_max", "max", "age")
        )
      )
      result should have size 1
      result.head("total_sum").asInstanceOf[AnyRef] shouldBe null
      result.head("total_avg").asInstanceOf[AnyRef] shouldBe null
      result.head("total_min").asInstanceOf[AnyRef] shouldBe null
      result.head("total_max").asInstanceOf[AnyRef] shouldBe null
    }


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

  // ── HEL-1310: median / percentile / count_distinct ─────────────────────────

  "AggregateStep median/percentile/count_distinct" should {

    "compute the median of an odd and an even count" in {
      one(vals("v", 3.0, 1.0, 2.0), agg("m", "median", "v")) shouldBe 2.0
      one(vals("v", 4.0, 1.0, 3.0, 2.0), agg("m", "median", "v")) shouldBe 2.5
    }

    "compute percentile with linear interpolation (p90 of 1..10 is 9.1)" in {
      val rows = vals("v", (1 to 10).map(_.toDouble): _*)
      one(rows, pct("p", "v", 90)).asInstanceOf[Double] shouldBe 9.1 +- 1e-9
    }

    "return min and max for percentile p=0 and p=100" in {
      val rows = vals("v", 5.0, 9.0, 1.0, 7.0)
      one(rows, pct("lo", "v", 0)) shouldBe 1.0
      one(rows, pct("hi", "v", 100)) shouldBe 9.0
    }

    "accept an upper-case fn name" in {
      one(vals("v", 1.0, 3.0), Aggregation("m", "MEDIAN", "v")) shouldBe 2.0
      one(vals("v", 1.0, 3.0), Aggregation("m", "PERCENTILE", "v", Some(100))) shouldBe 3.0
    }

    "let numeric strings participate and ignore nulls and non-numeric values" in {
      one(vals("v", "10", null, "abc", 30L), agg("m", "median", "v")) shouldBe 20.0
    }

    "exclude NaN from median/percentile" in {
      one(vals("v", "NaN", 1.0, 3.0), agg("m", "median", "v")) shouldBe 2.0
    }

    "keep infinity: [Inf, Inf] at a fractional position is Inf, not NaN" in {
      val inf = Double.PositiveInfinity
      one(vals("v", inf, inf), agg("m", "median", "v")) shouldBe inf
      one(vals("v", inf, inf, inf), pct("p", "v", 25)) shouldBe inf
    }

    "count distinct non-null values, with 1L and 1.0 counting once and \"1\" distinct from 1" in {
      one(vals("v", "a", "b", "a", null, "c"), agg("d", "count_distinct", "v")) shouldBe 3L
      one(vals("v", 1L, 1.0), agg("d", "count_distinct", "v")) shouldBe 1L
      one(vals("v", "1", 1L), agg("d", "count_distinct", "v")) shouldBe 2L
    }

    "compute per group when grouped" in {
      val rows = Seq(
        Map[String, Any]("g" -> "a", "v" -> 1.0), Map[String, Any]("g" -> "a", "v" -> 3.0),
        Map[String, Any]("g" -> "b", "v" -> 10.0), Map[String, Any]("g" -> "b", "v" -> 10.0), Map[String, Any]("g" -> "b", "v" -> 20.0)
      )
      val out = apply(rows, Vector(groupField("g")), Vector(
        agg("med", "median", "v"), pct("p100", "v", 100), agg("d", "count_distinct", "v")
      )).map(r => r("g") -> r).toMap
      out("a")("med") shouldBe 2.0
      out("a")("p100") shouldBe 3.0
      out("a")("d") shouldBe 2L
      out("b")("med") shouldBe 10.0
      out("b")("d") shouldBe 2L
    }

    "return null/null/0 for a group whose field is entirely null" in {
      val rows = Seq(Map[String, Any]("g" -> "a", "v" -> null))
      val out = apply(rows, Vector(groupField("g")), Vector(
        agg("med", "median", "v"), pct("p", "v", 50), agg("d", "count_distinct", "v")
      )).head
      out("med").asInstanceOf[AnyRef] shouldBe null
      out("p").asInstanceOf[AnyRef] shouldBe null
      out("d") shouldBe 0L
    }

    "yield null/null/0 for empty input with empty groupBy" in {
      val out = apply(Seq.empty, Vector.empty, Vector(
        agg("med", "median", "v"), pct("p", "v", 50), agg("d", "count_distinct", "v")
      )).head
      out("med").asInstanceOf[AnyRef] shouldBe null
      out("p").asInstanceOf[AnyRef] shouldBe null
      out("d") shouldBe 0L
    }

    "yield zero rows for empty input with non-empty groupBy" in {
      apply(Seq.empty, Vector(groupField("g")), Vector(agg("med", "median", "v"))) shouldBe empty
    }

    "throw StepConfigError for invalid aggregation configs, on empty and non-empty input" in {
      val bad = Seq(
        Aggregation("a", "percentile", "v"),
        Aggregation("a", "percentile", "v", Some(101)),
        Aggregation("a", "percentile", "v", Some(-1)),
        Aggregation("a", "percentile", "v", Some(Double.NaN)),
        Aggregation("a", "percentile", "v", Some(Double.PositiveInfinity)),
        Aggregation("a", "median", "v", Some(50)),
        Aggregation("a", "bogus", "v")
      )
      bad.foreach { a =>
        withClue(a.toString) {
          an[StepConfigError] should be thrownBy apply(vals("v", 1.0), Vector.empty, Vector(a))
          an[StepConfigError] should be thrownBy apply(Seq.empty, Vector.empty, Vector(a))
        }
      }
    }

    "round-trip a config without p byte-identically" in {
      import spray.json._
      val raw = """{"groupBy":[],"aggregations":[{"alias":"t","fn":"sum","field":"v"}]}"""
      AggregateConfig.decode(raw).toJson shouldBe raw.parseJson
      AggregateConfig.decode(raw).toJson.compactPrint should not include "\"p\""
    }
  }

  "AggregateStep.companion.validateRawConfig" should {
    def raw(aggs: String) = s"""{"groupBy":[],"aggregations":[$aggs]}"""
    val c = AggregateStep.companion

    "accept median, count_distinct, percentile with p, and upper-case PERCENTILE with p" in {
      c.validateRawConfig(raw("""{"alias":"a","fn":"median","field":"v"},{"alias":"b","fn":"count_distinct","field":"v"},{"alias":"c","fn":"percentile","field":"v","p":90},{"alias":"d","fn":"PERCENTILE","field":"v","p":0}""")) shouldBe None
    }

    "reject each invalid aggregation, joining all problems" in {
      c.validateRawConfig(raw("""{"alias":"a","fn":"percentile","field":"v"}""")).get should include("requires 'p'")
      c.validateRawConfig(raw("""{"alias":"a","fn":"percentile","field":"v","p":101}""")).get should include("between 0 and 100")
      c.validateRawConfig(raw("""{"alias":"a","fn":"sum","field":"v","p":5}""")).get should include("only valid for percentile")
      c.validateRawConfig(raw("""{"alias":"a","fn":"bogus_fn","field":"v"}""")).get should (include("Unsupported aggregation function") and include("bogus_fn"))
      val both = c.validateRawConfig(raw("""{"alias":"a","fn":"percentile","field":"v"},{"alias":"b","fn":"bogus_fn","field":"v"}""")).get
      both should (include("requires 'p'") and include("bogus_fn") and include("; "))
    }

    "leave a malformed (non-numeric p) config to the decode-mismatch message" in {
      c.validateRawConfig(raw("""{"alias":"a","fn":"percentile","field":"v","p":"x"}""")).get should include("p?")
    }
  }
}
