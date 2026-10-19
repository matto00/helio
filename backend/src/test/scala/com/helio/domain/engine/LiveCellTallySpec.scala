package com.helio.domain.engine

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.steps.CellWeight
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1630 (owner ruling C6, C7): what the draft walk holds, priced in cells with text weighted by length. */
class LiveCellTallySpec extends AnyWordSpec with Matchers {

  private def text(n: Int): String = new String(Array.fill(n)('x')) // a distinct object, not an interned literal
  private def rowsWith(s: String, count: Int, extra: Int = 1): Vector[Row] =
    Vector.fill(count)((1 to extra).map(i => s"c$i" -> (i: Any)).toMap + ("t" -> s))

  "the tally" should {
    "weigh a text once however many rows and frames share it" in {
      val tally = new LiveCellTally
      val shared = text(460)
      val weight = CellWeight.textCells(460)
      tally.add(rowsWith(shared, 100))
      tally.held shouldBe 100 * 2 + weight
      tally.add(rowsWith(shared, 100)) // a child frame that carries the same text
      tally.held shouldBe 200 * 2 + weight
    }

    "weigh distinct texts of the same content separately" in {
      val tally = new LiveCellTally
      tally.add(Vector.fill(10)(Map[String, Any]("t" -> text(460))))
      tally.held shouldBe 10 + 10 * CellWeight.textCells(460)
    }

    "give the text back only when the last frame holding it is released" in {
      val tally = new LiveCellTally
      val shared = text(460)
      val a = rowsWith(shared, 10)
      val b = rowsWith(shared, 10)
      tally.add(a); tally.add(b)
      tally.remove(a)
      tally.held shouldBe 10 * 2 + CellWeight.textCells(460)
      tally.remove(b)
      tally.held shouldBe 0L
    }

    "refuse a frame that would pass the budget, stopping early, and leave the tally as it was" in {
      val tally = new LiveCellTally
      tally.add(rowsWith("a", 10))
      val before = tally.held
      tally.tryAdd(Vector.fill(1000)(Map[String, Any]("t" -> text(2300))), before + 5000) shouldBe false
      tally.held shouldBe before
      tally.tryAdd(rowsWith("b", 10), before + 5000) shouldBe true
      tally.held shouldBe before + 20
    }
  }
}
