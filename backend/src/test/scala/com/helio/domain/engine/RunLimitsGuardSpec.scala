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

  /** The widest-row limit the HEL-1679 measurement certified (`evidence/`); raise `MaxRowRenderChars` past it only by re-measuring. */
  private val MeasuredRowRenderChars = 2000000L

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

    "trip when the post-walk limit is raised past the measured ceiling (a tripwire on the constant, not a proof of memory)" in {
      RunLimits.MaxPostWalkCells should be <= 3900000L
    }
  }

  "the widest-row render limit (HEL-1679, design.md D3)" should {
    // A one-column row whose compactPrint is exactly `n` characters: {"v":"<n - 8 x>"}.
    def rowOf(n: Long): Map[String, Any] = Map("v" -> ("x" * (n - 8).toInt))
    def outcomes(terminal: Seq[Row], retained: Seq[Row]): (Map[NodeKey, NodeOutcome], Set[NodeKey]) =
      (Map[NodeKey, NodeOutcome](StepKey("t") -> NodeOutcome(terminal, terminal.size.toLong), StepKey("o") -> NodeOutcome(retained, retained.size.toLong)), Set[NodeKey](StepKey("o")))
    val narrow: Seq[Row] = Vector(rowOf(100))

    "stay at or above the ruling-4 floor (a row holding one 1,048,576-character value renders 1,048,584 characters) and at or below the certified value" in {
      JsonTextLength.ofRow(rowOf(1048584L)) shouldBe 1048584L
      RunLimits.MaxRowRenderChars should be >= 1048584L
      RunLimits.MaxRowRenderChars should be <= MeasuredRowRenderChars
    }

    "accept a row of exactly the limit and refuse one character over (terminal frame)" in {
      val (o, retain) = outcomes(Vector(rowOf(RunLimits.MaxRowRenderChars)), narrow)
      val terminal    = o(StepKey("t")).rows
      RunLimits.widestRetainedRowChars(o, retain, terminal) shouldBe RunLimits.MaxRowRenderChars
      RunLimits.widestRetainedRowChars(o, retain, terminal) should be <= RunLimits.MaxRowRenderChars
      val (o2, retain2) = outcomes(Vector(rowOf(RunLimits.MaxRowRenderChars + 1)), narrow)
      RunLimits.widestRetainedRowChars(o2, retain2, o2(StepKey("t")).rows) should be > RunLimits.MaxRowRenderChars
    }

    "treat exactly the limit as writable and one character more as too wide" in {
      RunLimits.rowTooWide(RunLimits.MaxRowRenderChars) shouldBe false
      RunLimits.rowTooWide(RunLimits.MaxRowRenderChars + 1) shouldBe true
      RunLimits.rowTooWide(0L) shouldBe false
    }

    "see a too-wide row in a retained Output frame even when the terminal is narrow, and ignore a wide frame nobody retains" in {
      val wide        = Vector(rowOf(RunLimits.MaxRowRenderChars + 1))
      val (o, retain) = outcomes(narrow, wide)
      RunLimits.widestRetainedRowChars(o, retain, o(StepKey("t")).rows) should be > RunLimits.MaxRowRenderChars
      RunLimits.widestRetainedRowChars(o, Set.empty, o(StepKey("t")).rows) should be <= 100L
    }

    "measure the widest of many rows, and 0 for no rows" in {
      RunLimits.widestRowChars(Vector(rowOf(50), rowOf(500), rowOf(70))) shouldBe 500L
      RunLimits.widestRowChars(Vector.empty) shouldBe 0L
    }

    "leave the AC6 post-walk pin and the walk constants unchanged" in {
      RunLimits.MaxPostWalkCells shouldBe 3900000L
      RunLimits.MaxLiveCells shouldBe 2600000L
      RunLimits.MaxStringChars shouldBe 1048576
      RunLimits.MaxNodeRows shouldBe 100000
    }
  }
}
