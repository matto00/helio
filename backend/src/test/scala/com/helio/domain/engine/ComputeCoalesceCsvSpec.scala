package com.helio.domain.engine

import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import com.helio.testsupport.CsvLoadSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1423: a compute step over rows produced by the REAL CSV loader (blank cell -> null, HEL-1408). */
class ComputeCoalesceCsvSpec extends AnyWordSpec with Matchers with CsvLoadSupport {

  private val csv =
    """first,last
      |Ada,Lovelace
      |Grace,
      |,Hopper
      |""".stripMargin

  private def col(expr: String): Seq[Any] =
    ComputeStep.apply(loadCsv(csv), ComputeConfig("full", expr, None)).map(_("full"))

  "compute over a CSV with blank cells" should {
    "concat without coalesce is null when either part is blank" in {
      col("""concat($first, " ", $last)""") shouldBe Seq("Ada Lovelace", null, null)
    }

    "concat with coalesce rejoins the blanks" in {
      col("""concat(coalesce($first, ""), " ", coalesce($last, ""))""") shouldBe
        Seq("Ada Lovelace", "Grace ", " Hopper")
    }
  }
}
