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

    // HEL-889: `=`/`!=` stringify a Double row value (`0` -> `"0.0"`), so a
    // caller writing `"0"` never matches. This is the red-first test for the fix.
    "return a row whose numeric years_exp is 0 when the condition value is \"0\"" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "=", Some("0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("years_exp" -> 0.0),
        Map("years_exp" -> 3.0)
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("years_exp" -> 0.0))
    }

    "return a row whose numeric years_exp is 0 when the condition value is \"0.0\"" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "=", Some("0.0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("years_exp" -> 0.0),
        Map("years_exp" -> 3.0)
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("years_exp" -> 0.0))
    }

    "exclude a row whose numeric years_exp does not equal the condition value" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "=", Some("0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(Map("years_exp" -> 3.0))

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector.empty
    }

    "exclude a numeric row value from = when the condition value does not parse as a number" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "=", Some("zero")))
      )
      val rows: Seq[Map[String, Any]] = Vector(Map("years_exp" -> 0.0))

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector.empty
    }

    "keep string equality for a non-numeric column" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("position", "=", Some("WR")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("position" -> "WR"),
        Map("position" -> "RB")
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("position" -> "WR"))
    }

    "not numerically match a numeric-looking string column (player_id \"007\" vs \"7\")" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("player_id", "=", Some("7")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("player_id" -> "007"),
        Map("player_id" -> "7")
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("player_id" -> "7"))
    }

    "match a numeric-looking string column on its exact textual value" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("player_id", "=", Some("007")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("player_id" -> "007"),
        Map("player_id" -> "7")
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("player_id" -> "007"))
    }

    "exclude a null years_exp row from =" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "=", Some("0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(Map("other" -> 1))

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector.empty
    }

    "exclude a numeric row value from != when the numeric value matches" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "!=", Some("0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("years_exp" -> 0.0),
        Map("years_exp" -> 3.0)
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("years_exp" -> 3.0))
    }

    "not numerically match a numeric-looking string column from !=" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("player_id", "!=", Some("7")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("player_id" -> "007"),
        Map("player_id" -> "7")
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("player_id" -> "007"))
    }

    "always satisfy != for a null years_exp row" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "!=", Some("0")))
      )
      val rows: Seq[Map[String, Any]] = Vector(Map("other" -> 1))

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("other" -> 1))
    }

    "keep contains textual and unaffected by numeric coercion" in {
      val cfg = FilterConfig(
        combinator = "AND",
        conditions = Vector(cond("years_exp", "contains", Some("1")))
      )
      val rows: Seq[Map[String, Any]] = Vector(
        Map("years_exp" -> 10.0),
        Map("years_exp" -> 3.0)
      )

      val result = FilterStep.apply(rows, cfg)

      result shouldBe Vector(Map("years_exp" -> 10.0))
    }
  }
}
