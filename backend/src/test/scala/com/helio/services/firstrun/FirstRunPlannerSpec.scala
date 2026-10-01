package com.helio.services.firstrun

import com.helio.api.protocols.pipelines.{PipelineProposal, ProposalOutputSummary}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class FirstRunPlannerSpec extends AnyWordSpec with Matchers {

  private def kindsOf(headers: Vector[String], rows: Vector[Vector[String]]): Map[String, ColumnKind] =
    ColumnClassifier.classify(headers, rows).map(c => c.name -> c.kind).toMap

  private def plan(headers: Vector[String], rows: Vector[Vector[String]]): PipelineProposal =
    FirstRunPlanner.pipelineProposal("src-1", "Sales", ColumnClassifier.classify(headers, rows)).toOption.get

  private val dated = Vector(
    Vector("2026-01-01", "North", "10"),
    Vector("2026-01-02", "South", "20"),
    Vector("2026-01-03", "North", "30")
  )
  private val datedHeaders = Vector("day", "region", "amount")

  "ColumnClassifier" should {
    "type ISO dates, categories and plain numbers" in {
      kindsOf(datedHeaders, dated) shouldBe Map("day" -> ColumnKind.DateLike, "region" -> ColumnKind.Categorical, "amount" -> ColumnKind.Numeric)
    }

    "NOT treat an MM/dd/yyyy column as date-like, since datebucket cannot parse it" in {
      val rows = Vector(Vector("01/02/2026"), Vector("01/03/2026"), Vector("01/04/2026"))
      kindsOf(Vector("when"), rows)("when") should not be ColumnKind.DateLike
    }

    "keep an epoch-numeric column numeric even though datebucket would accept epochs" in {
      val rows = Vector(Vector("1767225600"), Vector("1767312000"), Vector("1767398400"))
      kindsOf(Vector("ts"), rows)("ts") shouldBe ColumnKind.Numeric
    }

    "not call comma-grouped or currency cells numeric, because the cast step would null them" in {
      val rows = Vector(Vector("$1,200"), Vector("$2,300"), Vector("$900"))
      kindsOf(Vector("revenue"), rows)("revenue") should not be ColumnKind.Numeric
    }

    "tolerate up to 10% non-numeric cells in a numeric column" in {
      val rows = (1 to 9).map(i => Vector(i.toString)).toVector :+ Vector("n/a")
      kindsOf(Vector("v"), rows)("v") shouldBe ColumnKind.Numeric
    }

    "skip blank and duplicate headers" in {
      ColumnClassifier.classify(Vector("a", "", "a"), Vector(Vector("1", "2", "3"))).map(_.name) shouldBe Vector("a")
    }
  }

  "FirstRunPlanner" should {
    "emit a cast step, table, time-series and top-n for date + category + numeric columns" in {
      val p = plan(datedHeaders, dated)
      p.steps.head.clientId shouldBe "cast"
      p.steps.head.config.fields("casts").asJsObject.fields.keySet shouldBe Set("amount")
      p.outputs.map(_.kind) shouldBe Vector("table", "chart", "chart")
      p.outputs.map(_.name) shouldBe Vector("Sales table", "Sales over time", "Sales top region")
      p.steps.map(_.`type`) shouldBe Vector("cast", "select", "datebucket", "aggregate", "sort", "aggregate", "sort", "limit")
    }

    "chain every output off the cast step and end each output on its chain's last step" in {
      val p = plan(datedHeaders, dated)
      val byId = p.steps.map(s => s.clientId -> s).toMap
      p.steps.filter(_.parentStepId.contains("cast")).map(_.clientId) shouldBe Vector("passthrough_0", "time-series_0", "agg_topn")
      p.outputs.map(_.nodeStepClientId.get) shouldBe Vector("passthrough_0", "time-series_2", "top-n_1")
      p.outputs.foreach(o => byId.keys should contain(o.nodeStepClientId.get))
    }

    "produce only a table, with no cast step and no parent, when there is no numeric column" in {
      val p = plan(Vector("name", "city"), Vector(Vector("a", "x"), Vector("b", "y"), Vector("c", "x")))
      p.steps.map(_.`type`) shouldBe Vector("select")
      p.steps.head.parentStepId shouldBe None
      p.outputs.map(_.kind) shouldBe Vector("table")
    }

    "skip time-series when the only date-like column has no numeric partner" in {
      val p = plan(Vector("day", "note"), Vector(Vector("2026-01-01", "a"), Vector("2026-01-02", "b"), Vector("2026-01-03", "c")))
      p.outputs.map(_.kind) shouldBe Vector("table")
    }

    "bucket by day for few distinct dates and by month for many" in {
      def granularityFor(n: Int): String = {
        val rows = (0 until n).map(i => Vector(java.time.LocalDate.of(2025, 1, 1).plusDays(i.toLong).toString, "1")).toVector
        plan(Vector("day", "amount"), rows).steps.find(_.`type` == "datebucket").get.config.fields("granularity").toString
      }
      granularityFor(90) shouldBe "\"day\""
      granularityFor(91) shouldBe "\"month\""
    }

    "prefer a non-id numeric column as the measure" in {
      val cols = ColumnClassifier.classify(Vector("order_id", "amount"), Vector(Vector("1", "5"), Vector("2", "6"), Vector("3", "7")))
      FirstRunPlanner.measureOf(cols).map(_.name) shouldBe Some("amount")
    }

    "lay every panel out full width at x=0, stacked with no overlap, table first" in {
      val p       = plan(datedHeaders, dated)
      val created = p.outputs.zipWithIndex.map { case (o, i) => ProposalOutputSummary(s"out-$i", o.name, o.kind, None) }
      val panels  = FirstRunPlanner.dashboardProposal("Sales", p, created).toOption.get.panels
      panels.map(_.title) shouldBe Vector("Sales table", "Sales over time", "Sales top region")
      panels.map(_.layout.get).map(l => (l.x, l.w)).distinct shouldBe Vector((0, 12))
      panels.map(_.layout.get.y) shouldBe Vector(0, 6, 10)
      panels.map(_.layout.get.h) shouldBe Vector(6, 4, 4)
    }
  }
}
