package com.helio.api.protocols.hooks

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── External trigger hook types (HEL-369) ────────────────────────────────────

/** `POST /api/hooks/run` request body. */
final case class HookRunRequest(pipelineId: String)

/** `POST /api/hooks/run` response. `status` mirrors `RunResultResponse`'s
 *  terminal outcome ("succeeded"/"failed") or, when the trigger collapsed
 *  into an already-in-flight run (design.md Decision 6), that run's current
 *  persisted status. */
final case class HookTriggerResponse(runId: String, pipelineId: String, status: String)

trait HookProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val hookRunRequestFormat: RootJsonFormat[HookRunRequest]           = jsonFormat1(HookRunRequest.apply)
  implicit val hookTriggerResponseFormat: RootJsonFormat[HookTriggerResponse] = jsonFormat3(HookTriggerResponse.apply)
}
