package com.helio.api.protocols

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Unit tests for [[Edit]]/[[PatchSet]]'s custom reader/writer (HEL-403) —
 *  mirrors [[PipelineProposalProtocolSpec]]'s structure. Covers: mixed
 *  round-trip (panel update + panel delete + dashboard update), absent-
 *  optional tolerance, target.id enforcement for update/delete vs. create,
 *  and rejection of unrecognized op/target.kind values. */
class PatchSetProtocolSpec extends AnyWordSpec with Matchers with PatchSetProtocol {

  private val panelUpdatePatch = UpdatePanelRequest(
    title      = Some("Renamed panel"),
    appearance = None,
    `type`     = None,
    config     = None
  )

  private val panelUpdateEdit = Edit(
    target             = EditTarget(kind = "panel", id = Some("panel-1")),
    op                 = "update",
    panelPatch         = Some(panelUpdatePatch),
    dashboardPatch     = None,
    dataSourcePatch    = None,
    dataTypePatch      = None,
    pipelinePatch      = None,
    pipelineStepPatch  = None,
    createPatch        = None
  )

  private val panelDeleteEdit = Edit(
    target             = EditTarget(kind = "panel", id = Some("panel-2")),
    op                 = "delete",
    panelPatch         = None,
    dashboardPatch     = None,
    dataSourcePatch    = None,
    dataTypePatch      = None,
    pipelinePatch      = None,
    pipelineStepPatch  = None,
    createPatch        = None
  )

  private val dashboardLayout = DashboardLayoutPayload(
    lg = Vector(DashboardLayoutItemPayload(panelId = "panel-3", x = 0, y = 0, w = 4, h = 2)),
    md = Vector.empty,
    sm = Vector.empty,
    xs = Vector.empty
  )

  private val dashboardUpdatePatch = UpdateDashboardRequest(
    name       = None,
    appearance = None,
    layout     = Some(dashboardLayout)
  )

  private val dashboardUpdateEdit = Edit(
    target             = EditTarget(kind = "dashboard", id = Some("dash-1")),
    op                 = "update",
    panelPatch         = None,
    dashboardPatch     = Some(dashboardUpdatePatch),
    dataSourcePatch    = None,
    dataTypePatch      = None,
    pipelinePatch      = None,
    pipelineStepPatch  = None,
    createPatch        = None
  )

  private val mixedPatchSet = PatchSet(
    summary = Some("Rename a panel, drop another, resize the dashboard layout"),
    edits   = Vector(panelUpdateEdit, panelDeleteEdit, dashboardUpdateEdit)
  )

  // ── HEL-403: mixed round-trip ──────────────────────────────────────────────

  "PatchSet.write/read" should {
    "round-trip a mixed patch set (panel update + panel delete + dashboard layout update)" in {
      mixedPatchSet.toJson.convertTo[PatchSet] shouldBe mixedPatchSet
    }

    "serialize each edit's populated patch field under a single shared 'patch' key" in {
      val edits = mixedPatchSet.toJson.asJsObject.fields("edits").asInstanceOf[JsArray].elements
      edits(0).asJsObject.fields("patch") shouldBe panelUpdatePatch.toJson
      edits(2).asJsObject.fields("patch") shouldBe dashboardUpdatePatch.toJson
    }

    "decode an update edit's patch into the case class matching target.kind" in {
      val json    = mixedPatchSet.toJson
      val decoded = json.convertTo[PatchSet]
      decoded.edits(0).panelPatch shouldBe Some(panelUpdatePatch)
      decoded.edits(2).dashboardPatch shouldBe Some(dashboardUpdatePatch)
    }
  }

  // ── HEL-403: absent-optional tolerance ─────────────────────────────────────

  "PatchSet.read" should {
    "tolerate an absent summary field" in {
      val json = JsObject(
        "edits" -> JsArray(
          JsObject(
            "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString("panel-2")),
            "op"     -> JsString("delete")
          )
        )
      )
      json.convertTo[PatchSet].summary shouldBe None
    }
  }

  "Edit.read" should {
    "tolerate an absent patch field (e.g. a delete edit)" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString("panel-2")),
        "op"     -> JsString("delete")
      )
      val edit = json.convertTo[Edit]
      edit.panelPatch shouldBe None
      edit.dashboardPatch shouldBe None
      edit.dataSourcePatch shouldBe None
      edit.dataTypePatch shouldBe None
      edit.pipelinePatch shouldBe None
      edit.pipelineStepPatch shouldBe None
      edit.createPatch shouldBe None
    }
  }

  // ── HEL-403: target.id enforcement (design.md D3) ──────────────────────────

  "Edit.read — target.id enforcement" should {
    "raise a deserializationError when op is 'update' and target omits id" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel")),
        "op"     -> JsString("update"),
        "patch"  -> panelUpdatePatch.toJson
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "raise a deserializationError when op is 'update' and target.id is blank" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString("   ")),
        "op"     -> JsString("update"),
        "patch"  -> panelUpdatePatch.toJson
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "raise a deserializationError when op is 'delete' and target omits id" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel")),
        "op"     -> JsString("delete")
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "succeed when op is 'create' and target omits id, producing target.id = None" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel")),
        "op"     -> JsString("create"),
        "patch"  -> JsObject("title" -> JsString("New panel"))
      )
      val edit = json.convertTo[Edit]
      edit.target.id shouldBe None
      edit.op shouldBe "create"
      edit.createPatch shouldBe Some(JsObject("title" -> JsString("New panel")))
    }
  }

  // ── HEL-403: unrecognized op/target.kind rejection ─────────────────────────

  "Edit.read — validation" should {
    "raise a deserializationError for an unrecognized op" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString("panel-1")),
        "op"     -> JsString("archive")
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "raise a deserializationError for an unrecognized target.kind" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("workspace"), "id" -> JsString("ws-1")),
        "op"     -> JsString("update")
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "raise a deserializationError when op is missing" in {
      val json = JsObject(
        "target" -> JsObject("kind" -> JsString("panel"), "id" -> JsString("panel-1"))
      )
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }

    "raise a deserializationError when target is missing" in {
      val json = JsObject("op" -> JsString("delete"))
      an[DeserializationException] should be thrownBy json.convertTo[Edit]
    }
  }

  // ── HEL-403: absent-optional write omission ────────────────────────────────

  "PatchSet.write" should {
    "omit the summary key when absent" in {
      val json = PatchSet(summary = None, edits = Vector(panelDeleteEdit)).toJson.asJsObject
      json.fields.keySet should not contain "summary"
    }

    "emit no null values for any absent optional field" in {
      val json = PatchSet(summary = None, edits = Vector(panelDeleteEdit)).toJson.asJsObject
      json.fields.values.toList should not contain JsNull
    }
  }

  "Edit.write" should {
    "omit the patch key when absent (delete edit)" in {
      val json = panelDeleteEdit.toJson.asJsObject
      json.fields.keySet should not contain "patch"
    }

    "emit no null values for any absent optional field" in {
      val json = panelDeleteEdit.toJson.asJsObject
      json.fields.values.toList should not contain JsNull
    }
  }
}
