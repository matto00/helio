package com.helio.ai

import com.helio.domain.ai.{AiStepClient, AiStepFailure, AiStepRequest}

import scala.concurrent.{ExecutionContext, Future}

/** Production [[AiStepClient]] adapter over [[ClaudeClient]] (design.md D2). Sends one user
 *  message per call and maps [[ClaudeError]]'s three variants onto [[AiStepFailure]]'s matching
 *  ones -- `AiStepFailure.Unavailable` is produced only by the context default
 *  ([[AiStepClient.Unavailable]]), never by this class, since a `ClaudeAiStepClient` only ever
 *  exists once `ClaudeConfig.fromEnv()` already resolved `Right`.
 *
 *  HEL-1108 call point: this `complete` method is the SINGLE place every pipeline AI step's model
 *  call passes through. Tier/quota gating (HELIO_BETA_DAILY_MESSAGE_LIMIT) belongs here, keyed
 *  off `request.ownerUserId` -- not implemented by this ticket. */
class ClaudeAiStepClient(client: ClaudeClient)(implicit ec: ExecutionContext) extends AiStepClient {

  override def complete(request: AiStepRequest): Future[Either[AiStepFailure, String]] = {
    // HEL-1108 (not implemented here): a tier/quota check over request.ownerUserId belongs
    // immediately before this send -- the one call point every AI pipeline step's model call
    // passes through (design.md D4).
    val claudeRequest = ClaudeRequest(messages = Seq(ClaudeMessage(ClaudeRole.User, s"${request.instruction}\n\n${request.content}")))
    client.send(claudeRequest).map {
      case Right(response) => Right(response.text)
      case Left(ClaudeError.GuardrailExceeded(reason)) => Left(AiStepFailure.Guardrail(reason))
      case Left(ClaudeError.ApiError(status, body))    => Left(AiStepFailure.Api(status, body))
      case Left(ClaudeError.TransportFailure(message)) => Left(AiStepFailure.Transport(message))
    }
  }
}
