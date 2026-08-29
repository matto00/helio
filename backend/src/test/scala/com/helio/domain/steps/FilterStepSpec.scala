package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-867 task 4.7 — characterisation test proving `filter` already accepts dotted column
 *  names, unchanged by this ticket (ticket.md premise correction 1): `FilterStep` resolves
 *  `FilterCondition.field` by literal exact-key lookup (`row.getOrElse(field, null)`), never
 *  through `ExpressionEvaluator`, so a dotted column name was never affected by the tokenizer
 *  gap this ticket closes. This test documents already-shipped behaviour, not new behaviour. */
class FilterStepSpec extends AnyWordSpec with Matchers {

  private def cond(field: String, operator: String, value: Option[String]): FilterCondition =
    FilterCondition(field, operator, value)

  "FilterStep.apply" should {

    "retain only the row whose dotted column matches the condition" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("stats.pts_ppr", ">", Some("10")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("stats.pts_ppr" -> 12.0),
        Map("stats.pts_ppr" -> 4.0)
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("stats.pts_ppr" -> 12.0))
    }
  }
}
