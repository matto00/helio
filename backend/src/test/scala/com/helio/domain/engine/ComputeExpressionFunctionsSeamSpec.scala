package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** HEL-1314 seam test, backend half. `shared-test-fixtures/compute-expression-functions.json` lists the
 *  functions the compute grammar supports; the frontend function reference and the helio-mcp
 *  description are tested against the SAME file, so a function added to the engine without
 *  documenting it in either surface fails there. */
class ComputeExpressionFunctionsSeamSpec extends AnyWordSpec with Matchers {

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/compute-expression-functions.json"))).asJsObject
  private val names   = fixture.fields("functions").convertTo[Vector[String]]

  "the shared compute-expression-functions fixture" should {
    "equal ExpressionEvaluator.SupportedFunctions in both directions" in {
      names.toSet shouldBe ExpressionEvaluator.SupportedFunctions.toSet
      names should have size ExpressionEvaluator.SupportedFunctions.size
    }
  }
}
