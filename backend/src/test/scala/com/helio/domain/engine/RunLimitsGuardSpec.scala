package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1660: the deterministic CI guard for the run limits. `RunPathHeapSpec` measures the heap but is opt-in (`HELIO_MEASURE=1`, run
 *  under -Xmx768m), because heap peaks swing by tens of MB between runs. This spec pins what that measurement fixed, with no GC in it:
 *  the ruled constants, and the tally arithmetic that makes the 50,000 x 6 ordinary pipeline (AC6) fit while a wider one is refused.
 *
 *  `MeasuredCeiling` is the largest budget whose worst budget-dependent shape stayed 192 MB minus the largest observed swing
 *  (see design.md "Measured Budget"); raise `MaxLiveCells` past it only by re-measuring. */
class RunLimitsGuardSpec extends AnyWordSpec with Matchers {

  private val MeasuredCeiling = 2600000L

  private def cells(n: Long): Seq[Row] = Vector.tabulate(n.toInt)(i => Map[String, Any]("v" -> i))

  "the run limits" should {
    "keep the owner-ruled numbers" in {
      RunLimits.MaxNodeRows shouldBe 100000
      RunLimits.MaxStringChars shouldBe 1048576
    }

    "stay at or under the measured ceiling" in {
      RunLimits.MaxLiveCells should be <= MeasuredCeiling
    }

    "hold the AC6 walk (root 300k + retained middle Output 550k + parent 750k + child 800k = 2.4M cells), and refuse it one 50,000-cell column wider" in {
      def peak(extraColumn: Long): Boolean = {
        val tally = new LiveCellTally
        Seq(300000L, 550000L, 750000L, 800000L + extraColumn).forall(n => tally.tryAdd(cells(n), RunLimits.MaxLiveCells))
      }
      peak(0L) shouldBe true
      peak(RunLimits.MaxLiveCells - 2400000L + 1L) shouldBe false
    }
  }
}
