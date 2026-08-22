package com.helio.services.workspace

import com.helio.services.workspace.WorkspaceContextService
import com.helio.domain.model.DataField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsArray, JsNumber, JsObject, JsString}

import scala.concurrent.ExecutionContext

/** HEL-372 tasks.md 4.2 — pure unit tests for
 *  `WorkspaceContextService.sanitizeSampleRows` (design.md D3), split out of
 *  `WorkspaceContextServiceSpec` (already past CONTRIBUTING's ~400-line
 *  guidance, task 4.1) into its own file since these cases need no database
 *  fixture at all — `sanitizeSampleRows` is a pure function of its two
 *  arguments and touches none of the service's four constructor
 *  dependencies, so this spec constructs the service with `null`s (the same
 *  nullable-dependency idiom `DataTypeService.listRows`/`PanelCapabilityService`
 *  already use for fixtures that don't need a real repo). */
class WorkspaceContextServiceSanitizeSampleRowsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val service = new WorkspaceContextService(null, null, null, null)

  private def structuredField(name: String, dataType: String = "string"): DataField =
    DataField(name = name, displayName = name, dataType = dataType, nullable = false)

  "sanitizeSampleRows" should {

    "cap the number of rows at 5, even when given more" in {
      val fields = Vector(structuredField("id"))
      val rawRows = (0 until 7).map(i => JsObject("id" -> JsNumber(i))).toVector

      val result = service.sanitizeSampleRows(fields, rawRows)

      result should have size 5
    }

    "cap columns at the first 40 declared Structured fields, in field order" in {
      val fields  = (0 until 45).map(i => structuredField(s"col$i")).toVector
      val rawRow  = JsObject(fields.map(f => f.name -> JsString(f.name)).toMap)

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      result should have size 1
      result.head.fields.keySet should have size 40
      result.head.fields.keySet should contain("col0")
      result.head.fields.keySet should contain("col39")
      result.head.fields.keySet should not contain "col40"
      result.head.fields.keySet should not contain "col44"
    }

    "exclude a Content-category field from the projection entirely" in {
      val fields = Vector(
        structuredField("name", "string"),
        structuredField("body", "string-body")
      )
      val rawRow = JsObject("name" -> JsString("alice"), "body" -> JsString("x" * 500))

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      result should have size 1
      result.head.fields.keySet shouldBe Set("name")
      result.head.fields("name") shouldBe JsString("alice")
    }

    "exclude a field whose dataType string does not parse (conservative default)" in {
      val fields = Vector(
        structuredField("name", "string"),
        structuredField("mystery", "not-a-real-type")
      )
      val rawRow = JsObject("name" -> JsString("alice"), "mystery" -> JsString("?"))

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      result.head.fields.keySet shouldBe Set("name")
    }

    "truncate an oversized string cell to 200 chars of its compactPrint plus the exact marker" in {
      val fields = Vector(structuredField("note"))
      val original = JsString("x" * 250)
      val rawRow = JsObject("note" -> original)

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      val expected = JsString(original.compactPrint.take(200) + "…[truncated]")
      result.head.fields("note") shouldBe expected
    }

    "truncate an oversized non-string cell to a JsString with the same exact marker" in {
      val fields = Vector(structuredField("wide"))
      val original = JsArray(Vector.fill(150)(JsNumber(7)))
      original.compactPrint.length should be > 200
      val rawRow = JsObject("wide" -> original)

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      val expected = JsString(original.compactPrint.take(200) + "…[truncated]")
      result.head.fields("wide") shouldBe expected
      result.head.fields("wide") shouldBe a[JsString]
    }

    "leave a cell at or under the 200-char cap untouched" in {
      val fields = Vector(structuredField("note"))
      val original = JsString("short")
      val rawRow = JsObject("note" -> original)

      val result = service.sanitizeSampleRows(fields, Vector(rawRow))

      result.head.fields("note") shouldBe original
    }

    "return an empty Vector for an empty snapshot" in {
      val fields = Vector(structuredField("id"))

      val result = service.sanitizeSampleRows(fields, Vector.empty)

      result shouldBe empty
    }
  }
}
