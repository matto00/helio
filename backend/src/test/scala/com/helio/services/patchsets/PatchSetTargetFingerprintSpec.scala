package com.helio.services.patchsets

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class PatchSetTargetFingerprintSpec extends AnyWordSpec with Matchers {

  private val SampleValue: JsValue = JsObject("v" -> JsNumber(1))

  /** Written out independently of the implementation: the fields each kind's `Update*Request` can write. */
  private val WritableFields: Map[String, Vector[String]] = Map(
    "panel"        -> Vector("title", "appearance", "type", "config"),
    "dashboard"    -> Vector("name", "appearance", "layout"),
    "dataSource"   -> Vector("name"),
    "pipeline"     -> Vector("name"),
    "pipelineStep" -> Vector("type", "config", "position", "enabled"),
    "output"       -> Vector("name", "config")
  )

  private def stateWith(kind: String): JsObject =
    JsObject(WritableFields(kind).map(_ -> SampleValue).toMap)

  "PatchSetTargetFingerprint.of" should {

    WritableFields.foreach { case (kind, fields) =>
      s"allowlist every field the $kind update request can write" in {
        PatchSetTargetFingerprint.Allowlist(kind) shouldBe fields
      }

      fields.foreach { field =>
        s"change when $kind.$field changes" in {
          val base    = stateWith(kind)
          val changed = JsObject(base.fields + (field -> JsString("changed")))
          PatchSetTargetFingerprint.of(kind, changed) should not be PatchSetTargetFingerprint.of(kind, base)
        }
      }

      s"ignore server-maintained $kind fields" in {
        val base = stateWith(kind)
        val noisy = JsObject(
          base.fields ++ Map(
            "id" -> JsString("x"), "ownerId" -> JsString("o"), "meta" -> SampleValue, "updatedAt" -> JsString("t"),
            "createdAt" -> JsString("t"), "lastRunStatus" -> JsString("succeeded"), "lastRunAt" -> JsString("t"),
            "layoutVersion" -> JsNumber(7)
          )
        )
        PatchSetTargetFingerprint.of(kind, noisy) shouldBe PatchSetTargetFingerprint.of(kind, base)
      }
    }

    "be independent of JSON object key order" in {
      val a = JsObject("name" -> JsString("n"), "config" -> JsObject("a" -> JsNumber(1), "b" -> JsNumber(2)))
      val b = JsObject("config" -> JsObject("b" -> JsNumber(2), "a" -> JsNumber(1)), "name" -> JsString("n"))
      PatchSetTargetFingerprint.of("output", a) shouldBe PatchSetTargetFingerprint.of("output", b)
    }

    "carry the v1 version prefix and a sha256 hex digest" in {
      PatchSetTargetFingerprint.of("pipeline", JsObject("name" -> JsString("n"))) should fullyMatch regex "v1:[0-9a-f]{64}"
    }
  }
}
