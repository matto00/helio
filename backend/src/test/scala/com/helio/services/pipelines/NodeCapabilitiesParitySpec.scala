package com.helio.services.pipelines

import com.helio.domain.engine.SchemaField
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}

/** HEL-1733 D7: the seam between the server's `PipelineNodeReads.buildNodeCapabilities` / `OutputConfigValidation.mergeConfig`
 *  and the frontend's ports of them (`state/nodeCapabilities.ts`, `state/draftOutputs.ts`'s `draftMerge`). Both suites assert
 *  against the same checked-in file, so drift on either side reds one of them. A GUARD, not a proof: set
 *  `HELIO_WRITE_PARITY_FIXTURE=1` to regenerate the file from the server's output after a deliberate rule change. */
class NodeCapabilitiesParitySpec extends AnyWordSpec with Matchers {

  private val path = Paths.get("../frontend/src/features/pipelines/state/__fixtures__/nodeCapabilitiesParity.json")

  private def schema(fields: (String, String)*): Vector[SchemaField] = fields.toVector.map { case (n, t) => SchemaField(n, t) }

  private val schemas: Vector[(String, Vector[SchemaField])] = Vector(
    "empty"                    -> Vector.empty,
    "string only"              -> schema("name" -> "string"),
    "integer only"             -> schema("n" -> "integer"),
    "float only"               -> schema("x" -> "float"),
    "boolean only"             -> schema("b" -> "boolean"),
    "timestamp only"           -> schema("t" -> "timestamp"),
    "string-body only"         -> schema("body" -> "string-body"),
    "binary-ref only"          -> schema("blob" -> "binary-ref"),
    "time series"              -> schema("date" -> "timestamp", "status" -> "string", "duration_s" -> "integer", "ratio" -> "float"),
    "no numeric column"        -> schema("a" -> "string", "b" -> "boolean", "t" -> "timestamp"),
    "no orderable column"      -> schema("a" -> "string", "b" -> "boolean")
  )

  private def obj(fields: (String, JsValue)*): JsObject = JsObject(fields.toMap)
  private def str(s: String): JsValue = JsString(s)
  private def strings(v: Vector[String]): JsValue = JsArray(v.map(JsString(_)))

  private val merges: Vector[(String, JsObject, JsObject)] = Vector(
    ("patch overrides one key", obj("a" -> JsNumber(1), "b" -> JsNumber(2)), obj("b" -> JsNumber(3))),
    ("patch adds a key", obj("a" -> JsNumber(1)), obj("c" -> str("x"))),
    ("null clears a key (kept as null)", obj("a" -> JsNumber(1), "b" -> JsNumber(2)), obj("a" -> JsNull)),
    ("shallow: a nested object is replaced whole", obj("chartOptions" -> obj("x" -> JsNumber(1), "y" -> JsNumber(2))), obj("chartOptions" -> obj("x" -> JsNumber(9)))),
    ("empty patch", obj("a" -> JsNumber(1)), JsObject.empty),
    ("empty stored", JsObject.empty, obj("fieldMapping" -> obj("xAxis" -> str("date"))))
  )

  private def computed: JsObject = {
    val capabilityCases = schemas.map { case (name, s) =>
      val resp = PipelineNodeReads.buildNodeCapabilities(None, s)
      obj(
        "name"   -> str(name),
        "schema" -> JsArray(s.map(f => obj("name" -> str(f.name), "type" -> str(f.`type`)))),
        "columns" -> JsArray(resp.columns.map(c => obj("name" -> str(c.name), "dataType" -> str(c.dataType)))),
        "capabilities" -> JsObject(resp.capabilities.toVector.sortBy(_._1).map { case (kind, c) =>
          kind -> obj(
            "bindable"        -> JsBoolean(c.bindable),
            "requiredSlots"   -> strings(c.requiredSlots),
            "optionalSlots"   -> strings(c.optionalSlots),
            "eligibleColumns" -> JsObject(c.eligibleColumns.toVector.sortBy(_._1).map { case (slot, cols) => slot -> strings(cols) }.toMap),
            "reason"          -> c.reason.map(JsString(_)).getOrElse(JsNull),
            "message"         -> c.message.map(JsString(_)).getOrElse(JsNull)
          )
        }.toMap)
      )
    }
    val mergeCases = merges.map { case (name, stored, patch) =>
      obj("name" -> str(name), "stored" -> stored, "patch" -> patch, "merged" -> OutputConfigValidation.mergeConfig(stored, patch))
    }
    obj("capabilities" -> JsArray(capabilityCases), "merges" -> JsArray(mergeCases))
  }

  "the node capabilities and merge parity fixture" should {
    "equal what the server computes today (regenerate with HELIO_WRITE_PARITY_FIXTURE=1)" in {
      if (sys.env.contains("HELIO_WRITE_PARITY_FIXTURE")) Files.writeString(path, computed.prettyPrint + "\n")
      JsonParser(Files.readString(path)) shouldBe computed
    }
    "cover every canonical field type and every Output kind (SchemaField itself refuses synonyms and unknown types, so the server never sees them)" in {
      val names = schemas.map(_._1)
      names should contain allOf ("string only", "integer only", "float only", "boolean only", "timestamp only", "string-body only", "binary-ref only")
      computed.fields("capabilities").asInstanceOf[JsArray].elements.head.asJsObject.fields("capabilities").asJsObject.fields.keySet shouldBe
        Set("metric", "chart", "table", "collection", "timeline", "markdown", "insight")
    }
  }
}
