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
  private val names     = fixture.fields("functions").convertTo[Vector[String]]
  private val operators  = fixture.fields("operators").convertTo[Vector[String]]
  private val literals   = fixture.fields("literals").convertTo[Vector[String]]

  "the shared compute-expression-functions fixture" should {
    "equal ExpressionEvaluator.SupportedFunctions in both directions" in {
      names.toSet shouldBe ExpressionEvaluator.SupportedFunctions.toSet
      names should have size ExpressionEvaluator.SupportedFunctions.size
    }

    "list if among the functions" in { names should contain("if") }

    "equal ExpressionEvaluator.SupportedOperators and BooleanLiterals in both directions" in {
      operators.toSet shouldBe ExpressionEvaluator.SupportedOperators.toSet
      operators should have size ExpressionEvaluator.SupportedOperators.size
      literals.toSet shouldBe ExpressionEvaluator.BooleanLiterals.toSet
      literals should have size ExpressionEvaluator.BooleanLiterals.size
    }

    "name only operators and literals the strict parser actually accepts" in {
      val fields = Set("a", "b")
      val probes = operators.map {
        case "not" => "not $a"
        case op    => s"$$a $op $$b"
      } ++ literals
      probes.foreach(p => withClue(p)(ExpressionEvaluator.validate(p, fields) shouldBe Right(())))
    }
  }
}
