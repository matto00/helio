package com.helio.api.protocols.patchsets

import com.helio.api.protocols.dashboards.{DashboardProtocol, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{PanelProtocol, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{OutputProtocol, PipelineProtocol, PipelineStepProtocol, UpdateOutputRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{DataSourceProtocol, UpdateDataSourceRequest}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// A patch set describes N targeted edits across one or more EXISTING
// resources (panel/dashboard/dataSource/pipeline/pipelineStep/output) so a
// conversational refinement can be previewed and applied atomically. Unlike
// DashboardProposal/PipelineProposal, every update/delete edit references an
// EXISTING resource id. Nothing is applied here — a future apply path
// (HEL-406 and sibling tickets) consumes this artifact. The wire shape
// matches schemas/patch-sets/patch-set.schema.json. Mirrors PipelineProposalProtocol's
// hand-written, absent-optional-tolerant reader.
//
// HEL-907 task 1.2: `output` added as a target.kind (node/output/placement
// operations, design.md/spec "Patch-set operations target nodes, outputs,
// and placements") — "node" is the pre-existing `pipelineStep` kind (a
// PipelineStep IS a node) and "placement" is the pre-existing `panel` kind
// (an OutputPanel IS a placement) under their original names; only `output`
// itself was missing. `output` has no `create` op (mirrors `pipelineStep`'s
// own precedent, design.md D1): `CreateOutputRequest` carries no parent-
// pipeline-id field of its own (the real `POST /api/pipelines/:id/outputs`
// route takes it from the URL path), and `EditTarget` has no field for a
// not-yet-existing resource's parent id either.

final case class EditTarget(kind: String, id: Option[String])

/** `op`'s `update`-patch is decoded into exactly ONE of the six `Option`
 *  fields below, selected by `target.kind` — the same multi-`Option`-field-
 *  behind-one-shared-wire-key pattern `PipelineProposalSource` uses for its
 *  four inline-source configs (design.md D1). Every field reuses an
 *  existing, already-tested `Update*Request` case class + `RootJsonFormat`
 *  verbatim — no new per-kind DTO. `createPatch` stays untyped
 *  (`Option[JsValue]`) for `op: create` — typed decoding against the
 *  matching `Create*Request` is an apply-time concern (design.md D2,
 *  HEL-406). All seven patch-carrier fields are `None` for `op: delete`. */
// HEL-904 task 3.3: `dataTypePatch`/`UpdateDataTypeRequest` REMOVED outright
// (not retargeted to an `output` field) -- per design.md's delivery-strategy
// table, `schemas/patch-sets/*` and this wire contract's eventual `output`
// target kind are P1.4's job (HEL-907), not this ticket's; this ticket only
// removes `dataType`/`metric` as valid target kinds (design.md's removal
// list groups `PatchSetApplyService` under "branches deleted", not
// "retargeted to Outputs", unlike its four sibling services in task 3.2).
final case class Edit(
    target: EditTarget,
    op: String,
    panelPatch: Option[UpdatePanelRequest],
    dashboardPatch: Option[UpdateDashboardRequest],
    dataSourcePatch: Option[UpdateDataSourceRequest],
    pipelinePatch: Option[UpdatePipelineRequest],
    pipelineStepPatch: Option[UpdatePipelineStepRequest],
    createPatch: Option[JsValue],
    // HEL-907 task 1.2: the `output` target.kind's update-patch, mirroring every sibling field's
    // reuse of an existing, already-tested Update*Request verbatim. Defaulted (unlike every
    // sibling *Patch field) and placed LAST so every pre-existing positional `Edit(...)`
    // construction site (many, across several test files) keeps compiling unchanged — Scala only
    // allows omitting a TRAILING defaulted positional param.
    outputPatch: Option[UpdateOutputRequest] = None
)

final case class PatchSet(summary: Option[String], edits: Vector[Edit])

trait PatchSetProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with PanelProtocol
    with DashboardProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PipelineStepProtocol
    with OutputProtocol {

  implicit val editTargetFormat: RootJsonFormat[EditTarget] = jsonFormat2(EditTarget.apply)

  // Recognized `target.kind`/`op` values — mirrors
  // schemas/patch-sets/patch-set.schema.json's EditTarget.kind and Edit.op enums.
  // HEL-904 task 3.3: `dataType` is REMOVED outright (metric was never a
  // recognized kind here to begin with). HEL-907 task 1.2: `output` added.
  private val recognizedKinds =
    Set("panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output")
  private val recognizedOps = Set("update", "delete", "create")

  /** Hand-written (not `jsonFormatN`) so the reader can validate `op`/
   *  `target.kind`, enforce non-blank `target.id` for `op: update`/`delete`
   *  (design.md D3), and dispatch the shared `"patch"` wire key into the ONE
   *  `Option` field matching `target.kind` for `op: update` (design.md D1);
   *  the writer re-collapses whichever field is populated back onto that
   *  same key (mirrors `pipelineProposalSourceFormat`'s write). */
  implicit val editFormat: RootJsonFormat[Edit] = new RootJsonFormat[Edit] {
    def write(e: Edit): JsValue = {
      val fields = scala.collection.mutable.Map[String, JsValue](
        "target" -> e.target.toJson,
        "op"     -> JsString(e.op)
      )
      e.panelPatch.foreach(v => fields("patch") = v.toJson)
      e.dashboardPatch.foreach(v => fields("patch") = v.toJson)
      e.dataSourcePatch.foreach(v => fields("patch") = v.toJson)
      e.pipelinePatch.foreach(v => fields("patch") = v.toJson)
      e.pipelineStepPatch.foreach(v => fields("patch") = v.toJson)
      e.outputPatch.foreach(v => fields("patch") = v.toJson)
      e.createPatch.foreach(v => fields("patch") = v)
      JsObject(fields.toMap)
    }

    def read(json: JsValue): Edit = {
      val obj = json.asJsObject

      val op = obj.fields
        .get("op")
        .map(_.convertTo[String])
        .getOrElse(deserializationError("edit 'op' is required"))
      if (!recognizedOps.contains(op))
        deserializationError(s"edit 'op' must be one of ${recognizedOps.mkString(", ")}, got '$op'")

      val target = obj.fields
        .get("target")
        .map(_.convertTo[EditTarget])
        .getOrElse(deserializationError("edit 'target' is required"))
      if (!recognizedKinds.contains(target.kind))
        deserializationError(
          s"edit target.kind must be one of ${recognizedKinds.mkString(", ")}, got '${target.kind}'"
        )

      if ((op == "update" || op == "delete") && target.id.forall(_.trim.isEmpty))
        deserializationError(s"edit target.id is required when op is '$op'")

      // HEL-406 design.md D6: HEL-403's carried-over follow-up. A `delete`
      // edit's `patch` is unused (per this file's own header doc); a
      // populated `"patch"` key on a delete edit is rejected here — the
      // layer that actually has the signal — rather than silently discarded
      // before `Edit` is constructed, mirroring the `target.id` enforcement
      // just above (same file, same reader, same error style).
      if (op == "delete" && obj.fields.contains("patch"))
        deserializationError("edit 'patch' must not be present when op is 'delete'")

      val patch = obj.fields.get("patch")

      val (panelPatch, dashboardPatch, dataSourcePatch, pipelinePatch, pipelineStepPatch, outputPatch, createPatch) =
        op match {
          case "update" =>
            target.kind match {
              case "panel"        => (patch.map(_.convertTo[UpdatePanelRequest]), None, None, None, None, None, None)
              case "dashboard"    => (None, patch.map(_.convertTo[UpdateDashboardRequest]), None, None, None, None, None)
              case "dataSource"   => (None, None, patch.map(_.convertTo[UpdateDataSourceRequest]), None, None, None, None)
              case "pipeline"     => (None, None, None, patch.map(_.convertTo[UpdatePipelineRequest]), None, None, None)
              case "pipelineStep" =>
                (None, None, None, None, patch.map(_.convertTo[UpdatePipelineStepRequest]), None, None)
              case "output" =>
                (None, None, None, None, None, patch.map(_.convertTo[UpdateOutputRequest]), None)
              case _ => (None, None, None, None, None, None, None)
            }
          case "create" => (None, None, None, None, None, None, patch)
          case _        => (None, None, None, None, None, None, None)
        }

      Edit(
        target            = target,
        op                = op,
        panelPatch        = panelPatch,
        dashboardPatch    = dashboardPatch,
        dataSourcePatch   = dataSourcePatch,
        pipelinePatch     = pipelinePatch,
        pipelineStepPatch = pipelineStepPatch,
        createPatch       = createPatch,
        outputPatch       = outputPatch
      )
    }
  }

  /** `summary`/`edits` — spray-json's built-in `Option` handling covers
   *  `summary` absent (design.md D4); `edits` missing raises the standard
   *  `DeserializationException`, matching `DashboardProposal`'s own
   *  precedent (`jsonFormat2`, no custom reader). */
  implicit val patchSetFormat: RootJsonFormat[PatchSet] = jsonFormat2(PatchSet.apply)
}
