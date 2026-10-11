package com.helio.domain.panels

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

class ChartReferenceMarksSpec extends AnyWordSpec with Matchers {

  private def obj(json: String): JsObject = json.parseJson.asJsObject
  private def check(written: String, stored: String = "{}") = ChartReferenceMarks.validate(obj(written), obj(stored))
  private def line(extra: String) = s"""{"referenceLines":[{$extra}]}"""

  "ChartReferenceMarks.validate" should {
    "accept absent, null and empty arrays" in {
      check("{}") shouldBe Right(())
      check("""{"referenceLines":null,"referenceBands":null}""") shouldBe Right(())
      check("""{"referenceLines":[],"referenceBands":[]}""") shouldBe Right(())
    }

    "accept a full line and band, and the boundary caps and label length" in {
      check("""{"referenceLines":[{"value":95,"label":"SLO","tone":"warning"}],"referenceBands":[{"from":-1.5,"to":50,"tone":"success"}]}""") shouldBe Right(())
      check(s"""{"referenceLines":[${Vector.fill(5)("""{"value":1}""").mkString(",")}]}""") shouldBe Right(())
      check(s"""{"referenceBands":[${Vector.fill(3)("""{"from":0,"to":1}""").mkString(",")}]}""") shouldBe Right(())
      check(line(s""""value":1,"label":"${"a" * 60}"""")) shouldBe Right(())
    }

    "name the key for each over-cap list" in {
      check(s"""{"referenceLines":[${Vector.fill(6)("""{"value":1}""").mkString(",")}]}""") shouldBe Left("referenceLines allows at most 5 lines")
      check(s"""{"referenceBands":[${Vector.fill(4)("""{"from":0,"to":1}""").mkString(",")}]}""") shouldBe Left("referenceBands allows at most 3 bands")
    }

    "reject a non-array, a non-object item, a string or missing value, and an unknown item key" in {
      check("""{"referenceLines":{"value":1}}""").left.map(_ should include("referenceLines must be an array")).isLeft shouldBe true
      check("""{"referenceLines":[3]}""") shouldBe Left("referenceLines[0] must be an object")
      check(line(""""value":"95"""")) shouldBe Left("referenceLines[0].value must be a finite number")
      check(line(""""label":"x"""")) shouldBe Left("referenceLines[0].value must be a finite number")
      check(line(""""value":1,"color":"red","z":2""")) shouldBe Left("referenceLines[0] has unknown key(s): color, z")
    }

    "reject a value outside double range" in {
      check(line(""""value":1e400""")) shouldBe Left("referenceLines[0].value must be a finite number")
    }

    "reject a blank, empty, over-long or non-string label" in {
      val msg = Left("referenceLines[0].label must be 1 to 60 characters with at least one non-whitespace character")
      check(line(""""value":1,"label":"   """")) shouldBe msg
      check(line(""""value":1,"label":""""")) shouldBe msg
      check(line(s""""value":1,"label":"${"a" * 61}"""")) shouldBe msg
      check(line(""""value":1,"label":5""")) shouldBe msg
    }

    "count a label in code points, as JSON Schema maxLength does" in {
      check(line(s""""value":1,"label":"${"\uD83D\uDE00" * 60}"""")) shouldBe Right(())
      check(line(s""""value":1,"label":"${"\uD83D\uDE00" * 61}"""")).isLeft shouldBe true
    }

    "reject an unknown or non-string tone, and judge each item by index" in {
      check(line(""""value":1,"tone":"red"""")) shouldBe Left("referenceLines[0].tone must be one of neutral, success, warning, error")
      check("""{"referenceLines":[{"value":1},{"value":2,"tone":7}]}""") shouldBe Left("referenceLines[1].tone must be one of neutral, success, warning, error")
    }

    "require a band's from to be less than its to" in {
      check("""{"referenceBands":[{"from":5,"to":5}]}""") shouldBe Left("referenceBands[0]: from must be less than to")
      check("""{"referenceBands":[{"from":9,"to":5}]}""") shouldBe Left("referenceBands[0]: from must be less than to")
      check("""{"referenceBands":[{"from":"1","to":5}]}""") shouldBe Left("referenceBands[0].from must be a finite number")
    }

    "judge only a key the write changes (tolerance rule)" in {
      val badStored = """{"referenceLines":[{"value":"legacy"}]}"""
      check(badStored, badStored) shouldBe Right(())
      check("""{"referenceBands":[{"from":0,"to":1}]}""", badStored) shouldBe Right(())
      check("""{"referenceLines":[{"value":"other"}]}""", badStored).isLeft shouldBe true
      check("""{"referenceLines":null}""", badStored) shouldBe Right(())
    }
  }

  /** GUARD (HEL-1306): the Scala constants equal the shared fixture's `limits`, which the frontend constants and
   *  the three Output request schemas are also pinned to. Failable by changing any constant. */
  "ChartReferenceMarks constants (guard)" should {
    "equal the shared fixture limits" in {
      val limits = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/chart-reference-marks.json"))).asJsObject.fields("limits").asJsObject
      limits.fields("maxLines").convertTo[Int] shouldBe ChartReferenceMarks.MaxLines
      limits.fields("maxBands").convertTo[Int] shouldBe ChartReferenceMarks.MaxBands
      limits.fields("maxLabel").convertTo[Int] shouldBe ChartReferenceMarks.MaxLabel
      limits.fields("tones").convertTo[Vector[String]] shouldBe ChartReferenceMarks.Tones
    }
  }
}
