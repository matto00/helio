package com.helio.api.protocols.pipelines

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

/** HEL-1629: wire shapes for `POST /api/pipelines/:id/draft/save`, the atomic bulk save of a client-side pipeline draft.
 *  The body is the FINAL step tree and Outputs (declarative), diffed against the stored definition server-side. Titled
 *  `DraftSaveRequest` / `DraftSaveResponse` in `schemas/pipelines/`.
 *
 *  A step or Output carries either an `id` (it already exists in THIS pipeline) or a `clientId` (new, minted by the client);
 *  its parent / node is named by `parentStepId` / `nodeStepId` (an existing id) or `parentClientId` / `nodeStepClientId` (a
 *  new one in the same draft). A parentless step names its `rootId`. An explicit `id` that is not in the pipeline is accepted
 *  ONLY when the server restores a journaled definition (undo); a public request carrying one is a 400. */
final case class DraftStepRequest(
    id: Option[String],
    clientId: Option[String],
    `type`: String,
    config: JsObject,
    enabled: Option[Boolean],
    parentStepId: Option[String],
    parentClientId: Option[String],
    rootId: Option[String],
    position: Int
)

final case class DraftOutputRequest(
    id: Option[String],
    clientId: Option[String],
    name: String,
    kind: String,
    nodeStepId: Option[String],
    nodeStepClientId: Option[String],
    rootId: Option[String],
    config: Option[JsObject]
)

/** What the client has seen and accepts being removed with the save (the cascade of a deleted step). Every list defaults to
 *  empty when absent. */
final case class DraftCascadeConfirmation(
    stepIds: Vector[String],
    outputIds: Vector[String],
    panelIds: Vector[String],
    alertRuleIds: Vector[String]
)

final case class DraftSaveRequest(
    baseFingerprint: String,
    steps: Vector[DraftStepRequest],
    outputs: Vector[DraftOutputRequest],
    runAfterSave: Option[String],
    confirmCascade: Option[DraftCascadeConfirmation]
)

final case class DraftSavedDefinitionResponse(steps: Vector[PipelineStepResponse], outputs: Vector[OutputResponse])

final case class DraftSavedResponse(fingerprint: String, definition: DraftSavedDefinitionResponse, applicationId: String)

/** The run requested with `runAfterSave`. `started = true`: the run was admitted. `started = false`: the HEL-505 guard (or an
 *  access check) refused it AFTER the save committed; `code` is the HTTP status the run endpoint would have answered
 *  (429 for the guard) and `retryAfterSeconds` the advisory wait. The saved definition is never rolled back. */
sealed trait DraftRunOutcomeResponse
final case class DraftRunStarted(runId: Option[String], status: String) extends DraftRunOutcomeResponse
final case class DraftRunNotStarted(code: Int, retryAfterSeconds: Option[Long], reason: String) extends DraftRunOutcomeResponse

final case class DraftSaveResponse(saved: DraftSavedResponse, run: Option[DraftRunOutcomeResponse])

/** 422 body when the draft removes more than `confirmCascade` covers (`PatchSetPreviewImpact`'s hint lines plus the
 *  structured ids). */
final case class DraftCascadeImpactResponse(
    stepIds: Vector[String],
    outputIds: Vector[String],
    panelIds: Vector[String],
    alertRuleIds: Vector[String],
    hints: Vector[String]
)
final case class DraftCascadeRequiredResponse(message: String, code: String, impact: DraftCascadeImpactResponse)

trait DraftSaveProtocol extends SprayJsonSupport with DefaultJsonProtocol with PipelineStepProtocol with OutputProtocol {

  implicit val draftStepRequestFormat: RootJsonFormat[DraftStepRequest]     = jsonFormat9(DraftStepRequest.apply)
  implicit val draftOutputRequestFormat: RootJsonFormat[DraftOutputRequest] = jsonFormat8(DraftOutputRequest.apply)

  implicit val draftCascadeConfirmationFormat: RootJsonFormat[DraftCascadeConfirmation] = new RootJsonFormat[DraftCascadeConfirmation] {
    private def ids(obj: JsObject, key: String): Vector[String] =
      obj.fields.get(key).map(_.convertTo[Vector[String]]).getOrElse(Vector.empty)
    def read(json: JsValue): DraftCascadeConfirmation = {
      val obj = json.asJsObject
      DraftCascadeConfirmation(ids(obj, "stepIds"), ids(obj, "outputIds"), ids(obj, "panelIds"), ids(obj, "alertRuleIds"))
    }
    def write(c: DraftCascadeConfirmation): JsValue = JsObject(
      "stepIds" -> c.stepIds.toJson, "outputIds" -> c.outputIds.toJson, "panelIds" -> c.panelIds.toJson, "alertRuleIds" -> c.alertRuleIds.toJson
    )
  }

  implicit val draftSaveRequestFormat: RootJsonFormat[DraftSaveRequest] = jsonFormat5(DraftSaveRequest.apply)

  implicit val draftSavedDefinitionResponseFormat: RootJsonFormat[DraftSavedDefinitionResponse] =
    jsonFormat2(DraftSavedDefinitionResponse.apply)
  implicit val draftSavedResponseFormat: RootJsonFormat[DraftSavedResponse] = jsonFormat3(DraftSavedResponse.apply)

  implicit val draftRunOutcomeResponseFormat: RootJsonFormat[DraftRunOutcomeResponse] = new RootJsonFormat[DraftRunOutcomeResponse] {
    def write(o: DraftRunOutcomeResponse): JsValue = o match {
      case DraftRunStarted(runId, status) =>
        JsObject(Map("started" -> JsBoolean(true), "status" -> JsString(status)) ++ runId.map("runId" -> JsString(_)))
      case DraftRunNotStarted(code, retryAfter, reason) =>
        JsObject(
          Map("started" -> JsBoolean(false), "code" -> JsNumber(code), "reason" -> JsString(reason)) ++
            retryAfter.map("retryAfterSeconds" -> JsNumber(_))
        )
    }
    def read(json: JsValue): DraftRunOutcomeResponse = {
      val obj = json.asJsObject
      if (obj.fields.get("started").contains(JsBoolean(true)))
        DraftRunStarted(obj.fields.get("runId").map(_.convertTo[String]), obj.fields("status").convertTo[String])
      else
        DraftRunNotStarted(
          obj.fields("code").convertTo[Int],
          obj.fields.get("retryAfterSeconds").map(_.convertTo[Long]),
          obj.fields("reason").convertTo[String]
        )
    }
  }

  /** `run` is always present on the wire, `null` when no run was requested. */
  implicit val draftSaveResponseFormat: RootJsonFormat[DraftSaveResponse] = new RootJsonFormat[DraftSaveResponse] {
    def write(r: DraftSaveResponse): JsValue =
      JsObject("saved" -> r.saved.toJson, "run" -> r.run.map(_.toJson).getOrElse(JsNull))
    def read(json: JsValue): DraftSaveResponse = {
      val obj = json.asJsObject
      DraftSaveResponse(
        obj.fields("saved").convertTo[DraftSavedResponse],
        obj.fields.get("run").filter(_ != JsNull).map(_.convertTo[DraftRunOutcomeResponse])
      )
    }
  }

  implicit val draftCascadeImpactResponseFormat: RootJsonFormat[DraftCascadeImpactResponse] = jsonFormat5(DraftCascadeImpactResponse.apply)
  implicit val draftCascadeRequiredResponseFormat: RootJsonFormat[DraftCascadeRequiredResponse] = jsonFormat3(DraftCascadeRequiredResponse.apply)
}
