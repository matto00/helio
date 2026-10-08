package com.helio.services.pipelines

import com.helio.domain.model.PipelineStep
import com.helio.domain.shapes.PipelineShape
import com.helio.services.firstrun.{ColumnClassifier, FirstRunPlanner}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1402 non-regression pins: configs that real, server-side or known external callers send to
 *  `PipelineService.create` must stay accepted by the `validateRawConfig` check it now runs. */
class CreateStepConfigNonRegressionSpec extends AnyWordSpec with Matchers {

  private def problem(kind: String, config: JsValue): Option[String] =
    PipelineStep.companionFor(kind).toOption.flatMap(_.validateRawConfig(config.compactPrint))

  private def obj(json: String): JsObject = json.parseJson.asJsObject

  "helio-news step configs (literal copies of what its MCP create_pipeline calls send)" should {

    val configs: Vector[(String, JsObject)] = Vector(
      "filter" -> obj("""{"combinator":"AND","conditions":[{"field":"isBug","operator":"=","value":"true"}]}"""),
      "aggregate" -> obj("""{"groupBy":[],"aggregations":[{"alias":"openBugCount","field":"id","fn":"count"}]}"""),
      "aggregate" -> obj("""{"groupBy":[{"name":"month","type":"string"}],"aggregations":[{"alias":"avg_value","field":"value","fn":"avg"}]}"""),
      "sort" -> obj("""{"sortBy":[{"direction":"asc","field":"month"}]}"""),
      "select" -> obj("""{"fields":["date","value"]}""")
    )

    configs.foreach { case (kind, config) =>
      s"be accepted: $kind ${config.compactPrint}" in {
        problem(kind, config) shouldBe None
      }
    }
  }

  "server-generated step configs" should {

    "all pass validateRawConfig for every registered shape's expansion" in {
      val measure = JsObject("fn" -> JsString("sum"), "field" -> JsString("amount"), "alias" -> JsString("total"))
      val params: Map[String, JsObject] = Map(
        "passthrough"  -> JsObject("fields" -> JsArray(JsString("a"), JsString("b"))),
        "single-row"   -> JsObject("mode" -> JsString("aggregate"), "measures" -> JsArray(measure)),
        "top-n"        -> JsObject("measure" -> JsString("revenue"), "direction" -> JsString("desc"), "n" -> JsNumber(5)),
        "time-series"  -> JsObject("timeField" -> JsString("orderedAt"), "granularity" -> JsString("month"), "measures" -> JsArray(measure)),
        "pivot-matrix" -> JsObject(
          "index" -> JsArray(JsString("region")), "column" -> JsString("quarter"),
          "values" -> JsString("revenue"), "agg" -> JsString("sum")
        )
      )
      params.keySet shouldBe PipelineShape.Registry.keySet
      for ((id, p) <- params; exp <- PipelineShape.Registry(id).expand(p).fold(m => fail(m), identity))
        withClue(s"shape $id step ${exp.kind}: ") { problem(exp.kind, exp.config) shouldBe None }
    }

    "all pass validateRawConfig for FirstRunPlanner's generated pipeline" in {
      val headers = Vector("day", "region", "amount")
      val rows = Vector(
        Vector("2026-01-01", "North", "10"),
        Vector("2026-01-02", "South", "20"),
        Vector("2026-01-03", "North", "30")
      )
      val proposal = FirstRunPlanner.pipelineProposal("src-1", "Sales", ColumnClassifier.classify(headers, rows)).toOption.get
      proposal.steps.map(_.`type`) should contain allOf ("cast", "datebucket", "aggregate", "sort", "limit")
      proposal.steps.foreach { s =>
        withClue(s"first-run step ${s.clientId} (${s.`type`}): ") { problem(s.`type`, s.config) shouldBe None }
      }
    }
  }
}
