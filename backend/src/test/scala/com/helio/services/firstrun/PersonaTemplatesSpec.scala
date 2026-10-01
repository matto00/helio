package com.helio.services.firstrun

import com.helio.api.protocols.pipelines.ProposalOutputSummary
import com.helio.services.telemetry.ProductEventRegistry
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.io.Source
import scala.util.Try

/** CI validation of the bundled persona datasets and the template registry (HEL-1210): header
 *  schema, row-count range, size cap, numeric columns really numeric, and a plan that is valid with
 *  non-overlapping full-width layouts. */
class PersonaTemplatesSpec extends AnyWordSpec with Matchers {

  private val MinRows  = 50
  private val MaxRows  = 250
  private val MaxBytes = 50 * 1024

  private def load(resource: String): (Vector[String], Vector[Vector[String]], Int) = {
    val stream = getClass.getClassLoader.getResourceAsStream(resource)
    withClue(s"$resource on the classpath: ") { stream should not be null }
    val bytes = try stream.readAllBytes() finally stream.close()
    val lines = Source.fromBytes(bytes, "UTF-8").getLines().toVector.filter(_.nonEmpty)
    (lines.head.split(",", -1).toVector, lines.tail.map(_.split(",", -1).toVector), bytes.length)
  }

  "PersonaTemplates" should {

    "expose exactly streamer, founder, ops and finance, each with a unique slug" in {
      PersonaTemplates.All.map(_.slug) shouldBe Vector("streamer", "founder", "ops", "finance")
    }

    "have every slug rolled up by telemetry and valid under the wire slug pattern" in {
      PersonaTemplates.All.map(_.slug).toSet shouldBe ProductEventRegistry.RolledUpTemplateSlugs
      PersonaTemplates.All.foreach(t => t.slug should fullyMatch regex "^[a-z0-9-]{1,40}$")
    }

    "name every sample source and dashboard as a sample" in {
      PersonaTemplates.All.foreach { t =>
        t.sourceName should startWith(s"Sample: ${t.persona}")
        t.dashboardName should include("(sample)")
      }
    }
  }

  PersonaTemplates.All.foreach { t =>
    s"the ${t.slug} dataset" should {
      lazy val (header, rows, size) = load(t.resource)

      "stay within the row-count range and size cap" in {
        rows.size should (be >= MinRows and be <= MaxRows)
        size should be <= MaxBytes
      }

      "have a header containing every column the template references" in {
        val referenced = t.tableColumns ++ t.numericColumns.keys ++
          Seq(t.series.timeField, t.series.measure, t.ranking.category, t.ranking.measure)
        header.distinct should have size header.size.toLong
        referenced.foreach(c => header should contain(c))
        t.tableColumns.toSet shouldBe header.toSet
      }

      "have rectangular rows with no blank cells" in {
        rows.foreach { r =>
          r should have size header.size.toLong
          r.foreach(_.trim should not be empty)
        }
      }

      "hold a parseable number in every column the pipeline casts" in {
        t.numericColumns.keys.foreach { col =>
          val idx = header.indexOf(col)
          rows.foreach(r => withClue(s"$col=${r(idx)}: ") { Try(r(idx).toDouble).isSuccess shouldBe true })
        }
      }

      "hold ISO yyyy-MM-dd dates in the time column" in {
        val idx = header.indexOf(t.series.timeField)
        rows.foreach(r => r(idx) should fullyMatch regex """\d{4}-\d{2}-\d{2}""")
      }

      "plan a valid pipeline with a table plus two explicitly typed charts" in {
        val proposal = t.pipelineProposal("src-id").fold(fail(_), identity)
        proposal.outputs.map(_.kind) shouldBe Vector("table", "chart", "chart")
        proposal.outputs.filter(_.kind == "chart").flatMap(_.config).foreach { cfg =>
          cfg.fields("chartType").toString should (include("line") or include("bar"))
        }
        proposal.steps.head.`type` shouldBe "cast"
        proposal.outputs.head.config.get.fields("columnOrder").convertTo[Vector[String]] shouldBe t.tableColumns
      }

      "lay out three full-width, non-overlapping panels" in {
        val proposal = t.pipelineProposal("src-id").fold(fail(_), identity)
        val created = proposal.outputs.zipWithIndex.map { case (o, i) =>
          ProposalOutputSummary(s"id-$i", o.name, o.kind, None)
        }
        val dash = FirstRunPlanner.dashboardProposal(t.dashboardName, proposal, created, explicitChartTypes = true).fold(fail(_), identity)
        dash.panels.map(_.chartType) shouldBe Vector(None, Some(t.series.chartType), Some(t.ranking.chartType))
        val items = dash.panels.map(_.layout.get).map(l => (l.x, l.y, l.w, l.h))
        items.foreach { case (x, _, w, _) => (x, w) shouldBe ((0, 12)) }
        items.map(_._2) shouldBe items.map(_._2).sorted
        items.sliding(2).foreach { pair => pair.head._2 + pair.head._4 should be <= pair.last._2 }
      }
    }
  }
}
