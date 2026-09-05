package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-893 tasks.md 6.4 — regression guard for the shape a CSV source actually produces: a
 *  column of numeric-looking `String`s. Under HEL-893's design, every CSV column materializes
 *  as a `String` unconditionally (`InProcessPipelineEngine.loadCsvRowsFromBytes`), so a sort
 *  over such a column is a real, common case that no prior test covered. `SortStep` coerces via
 *  `PipelineRowJson.toDouble`'s `case s: String => s.toDoubleOption` branch when BOTH sides
 *  parse as numbers, so `"9" < "10" < "100"` sorts numerically rather than lexicographically
 *  (which would order "10" < "100" < "9"). */
class SortStepSpec extends AnyWordSpec with Matchers {

  private def key(field: String, direction: String = "asc"): SortKey = SortKey(field, direction)

  "SortStep.apply" should {

    "sorts numeric-looking String values numerically, not lexicographically (HEL-893)" in {
      val rows = Seq(
        Map("n" -> "10"),
        Map("n" -> "9"),
        Map("n" -> "100")
      )
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n"))))
      sorted.map(_("n")) shouldBe Seq("9", "10", "100")

      // A lexicographic sort of the same three strings would instead produce
      // "10", "100", "9" -- pin the contrast so the guard fails if the numeric
      // coercion regresses to string comparison.
      sorted.map(_("n")) should not be Seq("10", "100", "9")
    }

    "sorts numeric-looking String values descending, numerically" in {
      val rows = Seq(Map("n" -> "9"), Map("n" -> "100"), Map("n" -> "10"))
      val sorted = SortStep.apply(rows, SortConfig(Vector(key("n", "desc"))))
      sorted.map(_("n")) shouldBe Seq("100", "10", "9")
    }
  }
}
