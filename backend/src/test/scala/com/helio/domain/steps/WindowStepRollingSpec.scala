package com.helio.domain.steps

import com.helio.domain.engine.PipelineRowJson
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1316: trailing rolling frames (`rolling_avg|sum|min|max|count`) over N rows or N calendar days. */
class WindowStepRollingSpec extends AnyWordSpec with Matchers {

  private type Row = PipelineRowJson.Row

  private def cfg(
      function: String,
      size: Int,
      unit: Option[String] = Some("rows"),
      orderField: String = "day",
      partitionBy: Vector[String] = Vector.empty,
      field: String = "v"
  ): WindowConfig =
    WindowConfig(partitionBy, Vector(SortKey(orderField, "asc")), function, Some(field), "out", None, Some(size), unit)

  private def outs(rows: Seq[Row]): Seq[Any] = rows.map(_("out"))

  "rolling_avg over rows" should {
    "match the hand-computed 7-row fixture including the leading partial frames" in {
      val rows: Seq[Row] = (1 to 10).map(i => Map[String, Any]("day" -> i, "v" -> i))
      val result         = outs(WindowStep.apply(rows, cfg("rolling_avg", 7)))
      // rows 1..6 average everything available so far; row 7 is the first full frame (1..7 = 4.0)
      result shouldBe Seq(1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0)
    }

    "order by orderBy, not input order, and re-emit rows in input order" in {
      val rows: Seq[Row] = Seq(3, 1, 2).map(i => Map[String, Any]("day" -> i, "v" -> (i * 10)))
      outs(WindowStep.apply(rows, cfg("rolling_avg", 2))) shouldBe Seq(25.0, 10.0, 15.0)
    }

    "default to rows when frameUnit is absent" in {
      val rows: Seq[Row] = (1 to 3).map(i => Map[String, Any]("day" -> i, "v" -> i))
      outs(WindowStep.apply(rows, cfg("rolling_sum", 2, unit = None))) shouldBe Seq(1.0, 3.0, 5.0)
    }

    "compute sum, min, max and count over the same frame" in {
      val rows: Seq[Row] = Seq(5, 1, 4, 2, 8).zipWithIndex.map { case (v, i) => Map[String, Any]("day" -> i, "v" -> v) }
      outs(WindowStep.apply(rows, cfg("rolling_sum", 3))) shouldBe Seq(5.0, 6.0, 10.0, 7.0, 14.0)
      outs(WindowStep.apply(rows, cfg("rolling_min", 3))) shouldBe Seq(5.0, 1.0, 1.0, 1.0, 2.0)
      outs(WindowStep.apply(rows, cfg("rolling_max", 3))) shouldBe Seq(5.0, 5.0, 5.0, 4.0, 8.0)
      outs(WindowStep.apply(rows, cfg("rolling_count", 3))) shouldBe Seq(1, 2, 3, 3, 3)
    }

    "respect partitions with interleaved input" in {
      val rows: Seq[Row] = Seq(
        Map[String, Any]("team" -> "a", "day" -> 1, "v" -> 10),
        Map[String, Any]("team" -> "b", "day" -> 1, "v" -> 100),
        Map[String, Any]("team" -> "a", "day" -> 2, "v" -> 20),
        Map[String, Any]("team" -> "b", "day" -> 2, "v" -> 200),
        Map[String, Any]("team" -> "a", "day" -> 3, "v" -> 30)
      )
      outs(WindowStep.apply(rows, cfg("rolling_avg", 2, partitionBy = Vector("team")))) shouldBe
        Seq(10.0, 100.0, 15.0, 150.0, 25.0)
    }

    "break orderBy ties by input index" in {
      val rows: Seq[Row] = Seq(Map[String, Any]("day" -> 1, "v" -> 1), Map[String, Any]("day" -> 1, "v" -> 3))
      outs(WindowStep.apply(rows, cfg("rolling_sum", 2))) shouldBe Seq(1.0, 4.0)
    }

    "skip null, non-numeric and NaN values, and emit null / 0 over an empty frame" in {
      val rows: Seq[Row] = Seq(
        Map[String, Any]("day" -> 1, "v" -> null),
        Map[String, Any]("day" -> 2, "v" -> "abc"),
        Map[String, Any]("day" -> 3, "v" -> Double.NaN),
        Map[String, Any]("day" -> 4, "v" -> 6),
        Map[String, Any]("day" -> 5, "v" -> "4")
      )
      outs(WindowStep.apply(rows, cfg("rolling_avg", 2))) shouldBe Seq(null, null, null, 6.0, 5.0)
      outs(WindowStep.apply(rows, cfg("rolling_sum", 2))) shouldBe Seq(null, null, null, 6.0, 10.0)
      outs(WindowStep.apply(rows, cfg("rolling_min", 2))) shouldBe Seq(null, null, null, 6.0, 4.0)
      outs(WindowStep.apply(rows, cfg("rolling_max", 2))) shouldBe Seq(null, null, null, 6.0, 6.0)
      outs(WindowStep.apply(rows, cfg("rolling_count", 2))) shouldBe Seq(0, 0, 0, 1, 2)
    }

    "give a size-1 frame the row's own value" in {
      val rows: Seq[Row] = (1 to 3).map(i => Map[String, Any]("day" -> i, "v" -> i))
      outs(WindowStep.apply(rows, cfg("rolling_max", 1))) shouldBe Seq(1.0, 2.0, 3.0)
    }
  }

  "rolling functions over days" should {
    def dated(pairs: (Any, Any)*): Seq[Row] = pairs.map { case (d, v) => Map[String, Any]("date" -> d, "v" -> v) }

    "not fill gaps and share one value between same-date peers" in {
      val rows = dated("2026-01-01" -> 1, "2026-01-02" -> 2, "2026-01-02" -> 3, "2026-01-05" -> 4, "2026-01-06" -> 5)
      outs(WindowStep.apply(rows, cfg("rolling_sum", 3, Some("days"), "date"))) shouldBe Seq(1.0, 6.0, 6.0, 4.0, 9.0)
    }

    "count the frame boundary inclusively (7 days covers the current day plus 6 before)" in {
      val rows = dated("2026-01-01" -> 1, "2026-01-07" -> 2, "2026-01-08" -> 4)
      outs(WindowStep.apply(rows, cfg("rolling_count", 7, Some("days"), "date"))) shouldBe Seq(1, 2, 2)
    }

    "give an unparseable or null key null and keep it out of every frame" in {
      val rows = dated("2026-01-01" -> 1, "nope" -> 100, (null: Any) -> 100, "2026-01-02" -> 2)
      outs(WindowStep.apply(rows, cfg("rolling_sum", 3, Some("days"), "date"))) shouldBe Seq(1.0, null, null, 3.0)
    }

    "order mixed timestamp formats by date, not by string" in {
      val rows = dated("2026-01-02T10:00:00Z" -> 2, "2026-01-01 08:30:00" -> 1, "2026-01-03" -> 4)
      outs(WindowStep.apply(rows, cfg("rolling_sum", 2, Some("days"), "date"))) shouldBe Seq(3.0, 1.0, 6.0)
    }

    "respect partitions" in {
      val rows: Seq[Row] = Seq(
        Map[String, Any]("t" -> "a", "date" -> "2026-01-01", "v" -> 1),
        Map[String, Any]("t" -> "b", "date" -> "2026-01-01", "v" -> 10),
        Map[String, Any]("t" -> "a", "date" -> "2026-01-02", "v" -> 2)
      )
      outs(WindowStep.apply(rows, cfg("rolling_sum", 2, Some("days"), "date", Vector("t")))) shouldBe Seq(1.0, 10.0, 3.0)
    }
  }

  "WindowStep error order for rolling functions" should {
    def err(c: WindowConfig): String = intercept[StepConfigError](WindowStep.apply(Seq.empty, c)).getMessage
    val base                         = cfg("rolling_avg", 3)

    "report a missing field, then a missing frameSize, then an empty orderBy" in {
      err(base.copy(field = None, frameSize = None, orderBy = Vector.empty)) should include("requires 'field'")
      err(base.copy(frameSize = None, orderBy = Vector.empty)) should include("frameSize")
      err(base.copy(orderBy = Vector.empty)) should include("orderBy")
    }
    "report an out-of-range frameSize, an unknown frameUnit and a days frame with the wrong ordering" in {
      err(base.copy(frameSize = Some(0))) should include("1..1000")
      err(base.copy(frameSize = Some(1001))) should include("1..1000")
      err(base.copy(frameUnit = Some("weeks"))) should include("weeks")
      err(base.copy(frameUnit = Some("days"), orderBy = Vector(SortKey("d", "desc")))) should include("ascending")
      err(base.copy(frameUnit = Some("days"), orderBy = Vector(SortKey("d", "asc"), SortKey("e", "asc")))) should include("one")
    }
    "accept a case-insensitive ASC direction in days mode" in {
      noException should be thrownBy WindowStep.apply(Seq.empty, base.copy(frameUnit = Some("days"), orderBy = Vector(SortKey("d", "ASC"))))
    }
    "ignore frame keys on a non-rolling function" in {
      noException should be thrownBy WindowStep.apply(Seq.empty, base.copy(function = "row_number", frameSize = Some(0), frameUnit = Some("weeks")))
    }
  }
}
