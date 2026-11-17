package com.helio.domain.insights

import com.helio.domain.insights.InsightFixtures._
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1741 tasks 3.1: the validator's number, marker, date and length rules. */
class InsightValidatorSpec extends AnyWordSpec with Matchers {

  private val p   = pack()
  private val cur = idOf(p, "revenue.current")
  private val pct = idOf(p, "revenue.pct")
  private val at  = idOf(p, "revenue.currentAt")

  private def check(text: String): Vector[String] = InsightValidator.validate(text, p, maxSentences = 3, maxChars = 300)

  "a fabricated number" should {
    "be rejected with a reason naming the numeral" in {
      val reasons = check(s"Revenue is 999 [$cur].")
      reasons should have size 1
      reasons.head should include("'999'")
    }
    "be rejected when the sentence cites nothing" in {
      check("Revenue is 1,234.").head should include("'1,234'")
    }
    "not borrow a value cited in another sentence" in {
      check(s"Revenue is 1,234 [$cur]. It grew by 1,234.") should have size 1
    }
  }

  "cited numbers" should {
    "accept a correctly rounded value" in {
      check(s"Revenue is 1,234 [$cur].") shouldBe empty
      check(s"Revenue is 1.2k [$cur].") shouldBe empty
      check(s"Revenue is 1,234.4 [$cur].") shouldBe empty
    }
    "accept a percent with or without a minus sign for a negative change" in {
      check(s"Revenue fell 12.4% [$pct].") shouldBe empty
      check(s"Revenue changed -12.4% [$pct].") shouldBe empty
      check(s"Revenue fell 12% [$pct].") shouldBe empty
    }
    "match a percent numeral only against a percent citation" in {
      check(s"Revenue is 1,234% [$cur].") should not be empty
    }
    "not treat the digits inside a citation marker as a numeral" in {
      val id12 = p.citations(11).id
      id12 shouldBe "c12"
      check("The second row is shown [c12].") shouldBe empty
      check("Rank 2 [c12].") shouldBe empty
    }
    "accept a string cell cited as a number and stated with thousands separators" in {
      val amount = idOf(p, "amount")
      p.citationById(amount).number shouldBe Some(1234.0)
      check(s"Alpha holds 1,234 [$amount].") shouldBe empty
    }
    "reject a digit run inside an alphanumeric token that is not cited" in {
      check(s"Q3 revenue is 1,234 [$cur].").head should include("'3'")
    }
  }

  "markers" should {
    "reject an id that is not in the pack" in {
      check("Revenue is fine [c999].") should contain("citation marker [c999] is not in the pack")
    }
  }

  "dates" should {
    "accept the UTC date of a cited date and reject another" in {
      check(s"As of 2026-11-14 [$at] revenue is 1,234 [$cur].") shouldBe empty
      check(s"As of 2026-11-15 [$at] revenue is 1,234 [$cur].").head should include("2026-11-15")
    }
    "accept a year and a day of month of a cited date" in {
      check(s"In 2026 [$at] revenue is 1,234 [$cur].") shouldBe empty
      check(s"On the 14th [$at] revenue is 1,234 [$cur].") shouldBe empty
      check(s"In 2025 [$at] revenue is 1,234 [$cur].") should not be empty
    }
  }

  "length" should {
    "reject more sentences than maxSentences, treating a decimal point as no boundary" in {
      InsightValidator.validate(s"One [$cur]. Two. Three. Four.", p, 3, 300) should not be empty
      InsightValidator.validate(s"Revenue is 1234.4 [$cur] today.", p, 1, 300) shouldBe empty
    }
    "reject more characters than maxChars, ignoring markers" in {
      InsightValidator.validate(s"Revenue [$cur] is fine.", p, 3, 17) shouldBe empty
      InsightValidator.validate(s"Revenue [$cur] is fine.", p, 3, 16) should not be empty
    }
    "reject blank text" in {
      check("   ") should not be empty
    }
  }
}
