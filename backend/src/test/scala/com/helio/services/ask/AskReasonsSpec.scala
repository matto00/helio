package com.helio.services.ask

import com.helio.domain.insights.{InsightPack, InsightValidator}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsObject

/** HEL-1761 D5: the public reason phrases, driven by REAL `InsightValidator` output so a wording change there that breaks
 *  the prefix mapping turns a test red instead of silently degrading to the generic phrase. */
class AskReasonsSpec extends AnyWordSpec with Matchers {

  private val pack = InsightPack(JsObject.empty, Vector.empty, "")

  private def publicFor(text: String): Vector[String] = {
    val reasons = InsightValidator.validate(text, pack, AskPrompts.MaxSentences, AskPrompts.MaxChars)
    reasons should not be empty
    AskReasons.publicOf(reasons)
  }

  "AskReasons.publicOf" should {
    "name the kind of each validator failure, with the exact phrase" in {
      publicFor("   ") shouldBe Vector("the answer was empty")
      publicFor("It fell 99 percent.") shouldBe Vector("a number is not backed by a cited value")
      publicFor("It rose on 2026-11-30.") shouldBe Vector("a date is not backed by a cited date")
      publicFor("See [c12] for more.") shouldBe Vector("a citation marker is not in the data")
      publicFor("a" * 1300 + ".") shouldBe Vector("the answer is too long")
      publicFor("Yes. " * 7) shouldBe Vector("the answer has too many sentences")
    }

    "deduplicate repeated kinds and keep distinct kinds" in {
      publicFor("It fell 99 percent and then 12 percent.") shouldBe Vector("a number is not backed by a cited value")
      publicFor("It fell 99 percent on 2026-11-30.") should contain theSameElementsAs Vector("a number is not backed by a cited value", "a date is not backed by a cited date")
    }

    "map the budget reason and fall back to the generic phrase for an unknown one" in {
      AskReasons.publicOf(Vector("the tool-call budget was reached before an answer")) shouldBe Vector("the tool-call budget was reached before an answer")
      AskReasons.publicOf(Vector("something new 42")) shouldBe Vector(AskReasons.Unchecked)
    }

    "never emit a digit" in {
      val all = Seq("It fell 99 percent on 2026-11-30 [c12].", "Yes. " * 7, "a" * 1300 + ".").flatMap(publicFor)
      all.foreach(_.exists(_.isDigit) shouldBe false)
    }
  }
}
