package com.helio.domain.engine

import com.helio.domain.model.DataFieldType
import com.helio.domain.steps._
import com.helio.testsupport.CsvLoadSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1408: a blank CSV cell is null for every step. Every assertion here runs over rows loaded
 *  through the REAL `InProcessPipelineEngine.loadRows` CSV loader (never hand-built null rows),
 *  so each test is about what a CSV blank does. The per-step regression rows live in
 *  [[CsvBlankCellsNullStepsSpec]]. */
class CsvBlankCellsNullSpec extends AnyWordSpec with Matchers with CsvLoadSupport {

  private val teamCsv =
    """team,score
      |a,1
      |a,
      |b,3
      |,4
      |""".stripMargin

  "CSV blank cells (engine-level, real loader)" should {

    "count and count_distinct exclude blank cells" in {
      val rows = loadCsv(teamCsv)
      val out = AggregateStep.apply(
        rows,
        AggregateConfig(
          Vector.empty,
          Vector(Aggregation("n", "count", "team"), Aggregation("d", "count_distinct", "team"))
        )
      )
      out.head("n") shouldBe 3L
      out.head("d") shouldBe 2L
    }

    "fillnull constant fills blank cells" in {
      val rows = loadCsv(teamCsv)
      val out = FillNullStep.apply(rows, FillNullConfig(Vector("team", "score"), "constant", Some("X")))
      out.map(_("team")) shouldBe Seq("a", "a", "b", "X")
      out.map(_("score")) shouldBe Seq("1", "X", "3", "4")
    }
  }

  "the CSV loader (HEL-1408 design D1)" should {

    "load an empty, a quoted-empty and a whitespace-only cell as null" in {
      val rows = loadCsv("a,b,c\n,\"\",   \n")
      rows should have size 1
      rows.head shouldBe Map("a" -> null, "b" -> null, "c" -> null)
    }

    "pad a short row's missing trailing cells with null" in {
      val rows = loadCsv("a,b,c\n1\n1,2\n")
      rows shouldBe Seq(
        Map("a" -> "1", "b" -> null, "c" -> null),
        Map("a" -> "1", "b" -> "2", "c" -> null)
      )
    }

    "skip blank and whitespace-only lines" in {
      loadCsv("a,b\n1,2\n\n   \n\t\n3,4\n").map(_("a")) shouldBe Seq("1", "3")
    }

    "keep a comma-only line as an all-null row (it is not a blank line)" in {
      loadCsv("a,b,c\n,,\n") shouldBe Seq(Map("a" -> null, "b" -> null, "c" -> null))
    }

    "never trim a non-blank cell" in {
      loadCsv("name,x\n\" Bo \",y\n").head("name") shouldBe " Bo "
    }

    "leave the header row unchanged" in {
      val rows = loadCsv(" a ,b\n1,2\n")
      rows.head.keySet shouldBe Set(" a ", "b")
    }
  }

  "schema inference and the source preview are unchanged (HEL-1408 design D2)" should {

    "infer an all-blank column as a nullable string" in {
      val schema = SchemaInferenceEngine.fromCsv("a,b\n1,\n2,\n")
      val b      = schema.fields.find(_.name == "b").get
      b.dataType shouldBe DataFieldType.StringType
      b.nullable shouldBe true
    }

    "show a blank cell in the source preview as an empty string" in {
      val (_, rows) = SchemaInferenceEngine.parseCsvRowsBytes("a,b\n1,\n2,x\n".getBytes("UTF-8"))
      rows shouldBe Vector(Vector("1", ""), Vector("2", "x"))
    }
  }
}
