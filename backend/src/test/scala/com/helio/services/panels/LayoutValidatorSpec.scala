package com.helio.services.panels

import com.helio.services.panels.LayoutValidator.{Overlap, OutOfBounds, Rect, Violation}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}

/** Asserts the backend validator against the SAME fixture the frontend `breakpointLayout.fixture.test.ts`
 *  reads (`shared-test-fixtures/layout-validity.json`), so client and server cannot drift on
 *  bounds/overlap semantics or column counts (HEL-1071). sbt runs with cwd `backend/`. */
class LayoutValidatorSpec extends AnyWordSpec with Matchers {

  private val fixture: JsObject =
    JsonParser(Files.readString(Paths.get("../shared-test-fixtures/layout-validity.json"))).asJsObject

  private def ints(v: JsValue): Int = v.asInstanceOf[JsNumber].value.toIntExact
  private def str(v: JsValue): String = v.asInstanceOf[JsString].value

  private val fixtureCols: Map[String, Int] =
    fixture.fields("cols").asJsObject.fields.map { case (k, v) => k -> ints(v) }

  private def rects(v: JsValue): Vector[Rect] =
    v.asInstanceOf[JsArray].elements.map { e =>
      val o = e.asJsObject.fields
      Rect(str(o("panelId")), ints(o("x")), ints(o("y")), ints(o("w")), ints(o("h")))
    }

  private def kind(v: Violation): String = v match {
    case _: Overlap     => "overlap"
    case _: OutOfBounds => "out_of_bounds"
  }

  "the backend column counts" should {
    "equal the fixture's (and so the frontend's dashboardGridCols)" in {
      LayoutBreakpointScaling.breakpointCols shouldBe fixtureCols
    }
  }

  "LayoutValidator.violations" should {
    val cases = fixture.fields("cases").asInstanceOf[JsArray].elements
    cases should not be empty

    cases.foreach { c =>
      val o = c.asJsObject.fields
      s"agree with the fixture: ${str(o("name"))}" in {
        val bp = str(o("breakpoint"))
        fixtureCols(bp) shouldBe LayoutBreakpointScaling.breakpointCols(bp)
        val got = LayoutValidator.violations(rects(o("items")), fixtureCols(bp))
        val expected = o("violations").asInstanceOf[JsArray].elements.map { v =>
          val vo = v.asJsObject.fields
          (str(vo("kind")), vo("panelIds").asInstanceOf[JsArray].elements.map(str))
        }
        got.map(v => (kind(v), v.panelIds)) shouldBe expected
        LayoutValidator.isValid(rects(o("items")), fixtureCols(bp)) shouldBe o("valid").asInstanceOf[JsBoolean].value
      }
    }
  }
}
