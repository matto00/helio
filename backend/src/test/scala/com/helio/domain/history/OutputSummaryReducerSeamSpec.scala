package com.helio.domain.history

import com.helio.domain.model.OutputKind
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}

/** Seam test: reads the fixture `frontend/src/utils/aggregate.fixture.test.ts` asserts against the
 *  real TS `computeAggregate`/`groupAndAggregate`, so the backend port cannot drift from the
 *  frontend on any listed cell (HEL-1271). */
class OutputSummaryReducerSeamSpec extends AnyWordSpec with Matchers {

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/output-summary-reducer.json"))).asJsObject

  private def cases(key: String): Vector[JsObject] = fixture.fields(key).asInstanceOf[JsArray].elements.map(_.asJsObject)

  private def rowsOf(c: JsObject): Vector[JsObject] = c.fields("rows").asInstanceOf[JsArray].elements.map(_.asJsObject)

  private def str(c: JsObject, key: String): String = c.fields(key).asInstanceOf[JsString].value

  private def expectedDouble(v: JsValue): Option[Double] = v match {
    case JsNumber(n) => Some(n.toDouble)
    case JsNull      => None
    case other       => fail(s"unexpected fixture value $other")
  }

  "JsSemantics.coerceNumber" should {
    for (c <- cases("coerce")) {
      s"match the frontend for ${str(c, "name")}" in {
        val cellValue = if (c.fields.contains("absent")) None else c.fields.get("value")
        JsSemantics.coerceNumber(cellValue.getOrElse(JsNull)) shouldBe expectedDouble(c.fields("expected"))
      }
    }
  }

  "OutputSummaryReducer.computeAggregate" should {
    for (c <- cases("aggregate")) {
      s"match the frontend for ${str(c, "name")}" in {
        OutputSummaryReducer.computeAggregate(rowsOf(c), str(c, "field"), str(c, "agg")) shouldBe expectedDouble(c.fields("expected"))
      }
    }
  }

  "OutputSummaryReducer.groupAndAggregate" should {
    for (c <- cases("group")) {
      s"match the frontend for ${str(c, "name")}" in {
        val (cats, vals) = OutputSummaryReducer.groupAndAggregate(rowsOf(c), str(c, "groupBy"), str(c, "agg"), str(c, "yField"))
        val expected     = c.fields("expected").asJsObject
        cats shouldBe expected.fields("categories").asInstanceOf[JsArray].elements.map(_.asInstanceOf[JsString].value)
        vals shouldBe expected.fields("values").asInstanceOf[JsArray].elements.map(_.asInstanceOf[JsNumber].value.toDouble)
      }
    }
  }

  "OutputSummaryReducer metric field selection" should {
    for (c <- cases("metricField")) {
      s"match the frontend for ${str(c, "name")}" in {
        val metric   = OutputSummaryReducer.summarize(Vector.empty, OutputKind.Metric, c.fields("config").asJsObject).fields("metric")
        val resolved = metric match {
          case JsNull      => JsNull
          case o: JsObject => JsObject("field" -> o.fields("field"), "agg" -> o.fields("agg"))
          case other       => fail(s"unexpected metric $other")
        }
        resolved shouldBe c.fields("expected")
      }
    }
  }
}
