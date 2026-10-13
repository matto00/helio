package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec, PipelineStepResponse, UpdatePipelineStepRequest}
import com.helio.domain.model._
import PatchSetApplyServiceJson._
import spray.json._

import scala.util.{Failure, Success}

/** Pure after-state projections for pipeline-step edits, split out of `PatchSetPreviewProjection`
 *  (HEL-1498; behaviour-preserving). See that object for the shared contract. */
private[patchsets] object PatchSetPreviewStepProjection {

  private[patchsets] def pipelineStepCreateAfter(request: CreatePipelineStepRequest): JsValue =
    JsObject(
      Vector(
        Some("id" -> JsString(PatchSetPreviewProjection.PendingId)),
        Some("type" -> JsString(request.`type`)),
        Some("config" -> request.config),
        request.parentStepId.map(v => "parentStepId" -> JsString(v)),
        request.rootId.map(v => "rootId" -> JsString(v)),
        request.enabled.map(v => "enabled" -> JsBoolean(v))
      ).flatten: _*
    )

  private[patchsets] def pipelineStepUpdateAfter(request: UpdatePipelineStepRequest, prior: PipelineStep): Either[ServiceError, (JsValue, PipelineStep)] = {
    val configuredEither: Either[String, PipelineStep] = request.config match {
      case None => Right(prior)
      case Some(cfgJson) =>
        PipelineStepConfigCodec.decode(prior.kind, cfgJson.compactPrint) match {
          case Failure(_)           => Left(s"Invalid '${prior.kind}' config")
          case Success(typedConfig) => PipelineStepProjectionSupport.withDecodedConfig(prior, typedConfig)
        }
    }
    configuredEither match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right(configured) =>
        val positioned = PipelineStepProjectionSupport.withPosition(configured, request.position.getOrElse(configured.position))
        // HEL-913 task 7.6a-iii: this is a PURE, synchronous preview projection (no DB access --
        // `positioned` is a hypothetical, not-yet-persisted step shape) so it genuinely cannot
        // resolve a root here. `Map.empty` is passed EXPLICITLY (fromDomain has no default,
        // 7.6a-i) rather than silently inherited, and the reason is stated here rather than left
        // for a reader to guess: a config/position preview never changes which root a step
        // belongs to, so this is a narrower gap than "unknown" -- it's "unchanged, just not
        // reflected in this hypothetical projection."
        Right((pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(positioned, Map.empty)), positioned))
    }
  }
}
