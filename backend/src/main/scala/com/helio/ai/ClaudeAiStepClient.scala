package com.helio.ai

import com.helio.domain.ai.{AiStepClient, AiStepFailure, AiStepRequest}
import com.helio.domain.model.UserId
import com.helio.services.auth.AiPipelineQuotaGate

import scala.concurrent.{ExecutionContext, Future}

/** Production [[AiStepClient]] adapter over [[ClaudeClient]] (design.md D2). Sends one user
 *  message per call and maps [[ClaudeError]]'s three variants onto [[AiStepFailure]]'s matching
 *  ones -- `AiStepFailure.Unavailable` is produced only by the context default
 *  ([[AiStepClient.Unavailable]]), never by this class, since a `ClaudeAiStepClient` only ever
 *  exists once `ClaudeConfig.fromEnv()` already resolved `Right`.
 *
 *  HEL-1108 call point: this `complete` method is the SINGLE place every pipeline AI step's model
 *  call passes through. `quotaGate` is a REQUIRED (non-defaulted) constructor parameter (design.md
 *  D8) -- deliberately NOT optional, so an ungated instance is not constructible at the type
 *  level: the prevailing defaulted-param convention elsewhere in this codebase is not followed
 *  here because a defaulted gate is exactly how an ungated client would stay constructible. */
class ClaudeAiStepClient(client: ClaudeClient, quotaGate: AiPipelineQuotaGate)(implicit ec: ExecutionContext) extends AiStepClient {

  override def complete(request: AiStepRequest): Future[Either[AiStepFailure, String]] =
    // HEL-1108 (design.md D8/3.5c): a request carrying no owner is NOT PERMITTED, never exempt --
    // this is the only path (besides the tier lookup itself) that denies without a DB write, and
    // it fails BEFORE any model call, same as every other denial arm below.
    request.ownerUserId match {
      case None =>
        Future.successful(Left(AiStepFailure.Unavailable("no owner identity was resolved for this pipeline AI request")))
      case Some(ownerId) =>
        quotaGate.checkAndIncrement(UserId(ownerId)).flatMap {
          case Left(limit) => Future.successful(Left(AiStepFailure.QuotaExceeded(limit)))
          case Right(())   => sendToModel(request)
        }
    }

  private def sendToModel(request: AiStepRequest): Future[Either[AiStepFailure, String]] = {
    val claudeRequest = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, s"${request.instruction}\n\n${request.content}")))
    client.send(claudeRequest).map {
      case Right(response) => Right(response.text)
      case Left(ClaudeError.GuardrailExceeded(reason)) => Left(AiStepFailure.Guardrail(reason))
      case Left(ClaudeError.ApiError(status, body))    => Left(AiStepFailure.Api(status, body))
      case Left(ClaudeError.TransportFailure(message)) => Left(AiStepFailure.Transport(message))
    }
  }
}
