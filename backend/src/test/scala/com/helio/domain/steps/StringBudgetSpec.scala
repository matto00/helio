package com.helio.domain.steps

import com.helio.domain.engine.ExpressionEvaluator
import com.helio.domain.engine.PipelineRowJson.Row
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsNumber, JsString, JsValue}

import java.util.concurrent.atomic.AtomicInteger
import scala.collection.immutable.AbstractSeq

/** HEL-1630 (owner ruling C7): the cap on text a draft `compute`/`stringops` step creates. The per-value cap and the running
 *  total are asserted from outside the step (what it throws, and how many input rows it read before stopping), and a run, which
 *  passes no budget, must keep building any text. */
class StringBudgetSpec extends AnyWordSpec with Matchers {

  private val megabyte = 1048576L

  private def compute(column: String, expression: String) = ComputeConfig(column, expression, None)

  private def stringOps(operation: String, field: String = "t", output: String = "o", fields: Option[Vector[String]] = None, separator: Option[String] = None) =
    StringOpsConfig(operation, field, output, None, separator, None, fields)

  /** Counts every element read, so a spec can assert how far a step got before it stopped. */
  private final class CountingSeq(underlying: Vector[Row]) extends AbstractSeq[Row] {
    val reads = new AtomicInteger(0)
    def iterator: Iterator[Row] = underlying.iterator.map { r => reads.incrementAndGet(); r }
    def apply(i: Int): Row      = { reads.incrementAndGet(); underlying(i) }
    def length: Int             = underlying.length
  }

  private def textRows(n: Int, length: Int): Vector[Row] = Vector.tabulate(n)(i => Map[String, Any]("t" -> ("x" * length), "i" -> i))

  "a compute step under a text budget" should {
    "refuse a text value over the per-value cap with its own message, and still build it without a budget (runs)" in {
      val rows = textRows(3, 80)
      val cfg  = compute("o", "concat($t, $t)")
      val err  = intercept[StepConfigError](ComputeStep.apply(rows, cfg, Some(new StringBudget(100, Long.MaxValue))))
      err.getMessage should include("Draft preview text limit")
      err.getMessage should include("more than 100 characters")
      ComputeStep.apply(rows, cfg).map(_("o").asInstanceOf[String].length) shouldBe Vector(160, 160, 160)
    }

    "refuse a nested concat inside the expression, before it is built (a per-value check only on the result would not)" in {
      // Each level doubles: 14 levels over a 10-character text is 160k characters. Without the in-expression check `eval` just returns it.
      val nested = (1 to 14).foldLeft("$t")((inner, _) => s"concat($inner, $inner)")
      val compiled = ExpressionEvaluator.compile(nested).toOption.get
      val row: Map[String, JsValue] = Map("t" -> JsString("0123456789"))
      intercept[StepConfigError](compiled.eval(row, 1000)).getMessage should include("more than 1000 characters")
      compiled.eval(row).toOption.get.asInstanceOf[JsString].value.length shouldBe 10 * (1 << 14)
    }

    "refuse the `+` text operator over the cap too" in {
      val compiled = ExpressionEvaluator.compile("$t + $t").toOption.get
      intercept[StepConfigError](compiled.eval(Map("t" -> JsString("x" * 600)), 1000)).getMessage should include("more than 1000 characters")
      compiled.eval(Map("t" -> JsString("x" * 400)), 1000).toOption.get shouldBe JsString("x" * 800)
    }

    "stop while it emits once the node's running total passes what the request has left" in {
      val rows = new CountingSeq(textRows(1000, 100))
      // 100 characters = 200 bytes per new text; room for 1 MiB would be 5,242 values, so give room for 10.
      val budget = new StringBudget(1000, 10 * 200L)
      val err    = intercept[StepConfigError](ComputeStep.apply(rows, compute("o", "concat($t)"), Some(budget)))
      err.getMessage should include("Draft preview text limit")
      err.getMessage should include("of new text at once")
      rows.reads.get should be <= 11
    }

    "count a number or a null result as free" in {
      val rows = textRows(50, 100)
      noException should be thrownBy ComputeStep.apply(rows, compute("o", "i + 1"), Some(new StringBudget(1000, 0L)))
    }
  }

  "a stringops step under a text budget" should {
    "charge upper, trim, lower, split and extractRegex results against the running total" in {
      Seq("upper", "lower", "trim").foreach { op =>
        val rows = new CountingSeq(textRows(1000, 100))
        intercept[StepConfigError](StringOpsStep.apply(rows, stringOps(op), Some(new StringBudget(1000, 10 * 200L)))).getMessage should include("of new text at once")
        rows.reads.get should be <= 11
      }
    }

    "refuse a concat whose joined text would pass the per-value cap, before joining" in {
      val rows = textRows(2, 80)
      val cfg  = stringOps("concat", fields = Some(Vector("t", "t")), separator = Some("--"))
      intercept[StepConfigError](StringOpsStep.apply(rows, cfg, Some(new StringBudget(100, Long.MaxValue)))).getMessage should include("more than 100 characters")
      StringOpsStep.apply(rows, cfg).head("o").asInstanceOf[String].length shouldBe 162
    }

    "build any text without a budget (runs and the saved preview)" in {
      val rows = textRows(2, 400000)
      StringOpsStep.apply(rows, stringOps("upper")).map(_("o").asInstanceOf[String].length) shouldBe Vector(400000, 400000)
    }
  }

  "the other text-emitting kinds under a text budget (owner ruling C8)" should {
    // 100-character text = 200 bytes; room for 10 of them.
    def tight = Some(new StringBudget(1000, 10 * 200L))
    val big   = Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("x" * 100), "i" -> i))

    "charge every splittext segment (paragraph and heading modes), and build them all without a budget" in {
      val paragraphs = new CountingSeq(big)
      val cfg        = SplitTextConfig("t", "paragraph", 1, "idx")
      intercept[StepConfigError](SplitTextStep.apply(paragraphs, cfg, None, tight)).getMessage should include("Draft preview text limit")
      paragraphs.reads.get should be <= 11
      val headings = new CountingSeq(Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("# " + "x" * 98), "i" -> i)))
      intercept[StepConfigError](SplitTextStep.apply(headings, cfg.copy(mode = "heading", headingLevel = 1), None, tight)).getMessage should include("Draft preview text limit")
      SplitTextStep.apply(big, cfg).size shouldBe 1000
    }

    "charge every extractheadings title" in {
      val rows = new CountingSeq(Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("# " + "x" * 98), "i" -> i)))
      val cfg  = ExtractHeadingsConfig("t", "idx", "level")
      intercept[StepConfigError](ExtractHeadingsStep.apply(rows, cfg, None, tight)).getMessage should include("Draft preview text limit")
      rows.reads.get should be <= 11
      ExtractHeadingsStep.apply(rows, cfg).size shouldBe 1000
    }

    "charge every chunkbytokencount chunk" in {
      val rows = new CountingSeq(Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("word " * 20), "i" -> i)))
      val cfg  = ChunkByTokenCountConfig("t", 1000, "cl100k_base", "idx", "tokens")
      intercept[StepConfigError](ChunkByTokenCountStep.apply(rows, cfg, None, tight)).getMessage should include("Draft preview text limit")
      rows.reads.get should be <= 11
      ChunkByTokenCountStep.apply(rows, cfg).size shouldBe 1000
    }

    "charge every pivot column name, and still build them without a budget (runs)" in {
      val rows = Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("x" * 100), "g" -> i, "v" -> i))
      val cfg  = PivotConfig(Vector("g"), "t", "v", "first")
      intercept[StepConfigError](PivotStep.apply(rows, cfg, Some(new StringBudget(1000, 10 * 4L)))).getMessage should include("Draft preview text limit")
      intercept[StepConfigError](PivotStep.apply(rows, cfg, Some(new StringBudget(50, Long.MaxValue)))).getMessage should include("more than 50 characters")
      PivotStep.apply(rows, cfg).size shouldBe 1000
    }

    "charge every convertformat result, and refuse a csv -> json expansion before it is built" in {
      val rows = new CountingSeq(Vector.tabulate(1000)(i => Map[String, Any]("t" -> ("word " * 20), "i" -> i)))
      val cfg  = ConvertFormatConfig("t", "text", "markdown", "o")
      intercept[StepConfigError](ConvertFormatStep.apply(rows, cfg, tight)).getMessage should include("Draft preview text limit")
      rows.reads.get should be <= 11
      ConvertFormatStep.apply(rows, cfg).size shouldBe 1000

      val csv     = "a,b\n" + Seq.fill(2000)("1,2").mkString("\n")
      val csvCfg  = ConvertFormatConfig("t", "csv", "json", "o")
      val oneRow  = Vector(Map[String, Any]("t" -> csv))
      intercept[StepConfigError](ConvertFormatStep.apply(oneRow, csvCfg, Some(new StringBudget(5000, Long.MaxValue)))).getMessage should include("more than 5000 characters")
      // Checked BEFORE the output is built: a malformed row after the expansion is not reached (the unchecked path reports csv-malformed first).
      val malformed = Vector(Map[String, Any]("t" -> (csv + "\n1")))
      intercept[StepConfigError](ConvertFormatStep.apply(malformed, csvCfg, Some(new StringBudget(5000, Long.MaxValue)))).getMessage should include("more than 5000 characters")
      intercept[IllegalArgumentException](ConvertFormatStep.apply(malformed, csvCfg)).getMessage should include("csv-malformed")
      ConvertFormatStep.apply(oneRow, csvCfg).head("o").asInstanceOf[String].length should be > 5000
    }

    "charge the string a cast to string builds from a number, but not a string cast to string (the same object)" in {
      val numbers = new CountingSeq(Vector.tabulate(1000)(i => Map[String, Any]("n" -> i.toDouble)))
      val cfg     = CastConfig(Map("n" -> "string"))
      intercept[StepConfigError](CastStep.apply(numbers, cfg, Some(new StringBudget(1000, 10 * 4L)))).getMessage should include("Draft preview text limit")
      numbers.reads.get should be <= 11
      CastStep.apply(numbers, cfg).size shouldBe 1000
      noException should be thrownBy CastStep.apply(big, CastConfig(Map("t" -> "string")), Some(new StringBudget(1000, 0L)))
    }
  }

  "the text price" should {
    "be two bytes a character over 46 bytes a cell, rounded down" in {
      CellWeight.textCells(0) shouldBe 0L
      CellWeight.textCells(22) shouldBe 0L
      CellWeight.textCells(23) shouldBe 1L
      CellWeight.textCells(331) shouldBe 14L
      CellWeight.textCells(megabyte.toInt) shouldBe (2L * megabyte / 46)
    }
  }
}
