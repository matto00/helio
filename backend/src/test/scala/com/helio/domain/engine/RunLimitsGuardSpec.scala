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

    "hold the AC6 walk (root 300k + retained middle Output 550k + parent 750k + child 800k = 2.4M cells), and refuse it once a 200,001-cell column is added" in {
      def peak(extraColumn: Long): Boolean = {
        val tally = new LiveCellTally
        Seq(300000L, 550000L, 750000L, 800000L + extraColumn).forall(n => tally.tryAdd(cells(n), RunLimits.MaxLiveCells))
      }
      peak(0L) shouldBe true
      peak(RunLimits.MaxLiveCells - 2400000L + 1L) shouldBe false
    }
  }

  "the post-walk accounting" should {
    // A 50,000-row frame of `cols` columns; frames are distinct objects so identity de-duplication does not merge them.
    def frame(cols: Int): Seq[Row] = Vector.fill(50000)((0 until cols).map(c => s"c$c" -> (c: Any)).toMap)

    def cost(terminalCols: Int, otherCols: Seq[Int]): Long = {
      val terminal = frame(terminalCols)
      val others   = otherCols.map(c => frame(c))
      val outcomes: Map[NodeKey, NodeOutcome] =
        ((StepKey("t") -> NodeOutcome(terminal, 50000L)) +: others.zipWithIndex.map { case (f, i) => StepKey(s"o$i") -> NodeOutcome(f, 50000L) }).toMap
      RunLimits.postWalkCells(outcomes, others.indices.map(i => StepKey(s"o$i"): NodeKey).toSet, terminal)
    }

    "pin the AC6 shape (Outputs on a 16-column terminal and an 11-column middle node) at exactly 3,900,000 and accept it" in {
      cost(16, Seq(11)) shouldBe 3900000L
      cost(16, Seq(11)) should be <= RunLimits.MaxPostWalkCells
    }

    "refuse the skeptic's adjacent-Outputs shape (23-column terminal plus its 22-column parent: 2 frames + 2 JSON copies)" in {
      cost(23, Seq(22)) should be > RunLimits.MaxPostWalkCells
    }

    "price several large non-terminal Outputs: three 11-column Outputs beside the terminal cost more than one" in {
      cost(16, Seq(11, 11, 11)) should be > cost(16, Seq(11))
    }

    "hold the post-walk limit at or under the measured ceiling (design.md Measured Budget)" in {
      RunLimits.MaxPostWalkCells should be <= 3900000L
    }
  }
}
