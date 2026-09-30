package com.helio.api.routes

import com.helio.api.JsonProtocols
import com.helio.api.protocols.assistant.TierErrorResponse
import com.helio.services.auth.ChatAccessError
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

/** Maps a [[ChatAccessError]] (tier gate denial) to its status + [[TierErrorResponse]] body, shared
 *  by every Claude-backed route family (HEL-703 assistant, HEL-1205 authoring/refinements) so the
 *  403/429 wire shape is one definition. NOT `ServiceResponse.run`, which hardcodes the generic
 *  `ErrorResponse` and has no `429` case (`CHAT_LIMIT_REACHED` has no `ServiceError` counterpart). */
object TierErrorCompletion extends JsonProtocols {
  def completeTierError(err: ChatAccessError): Route = err match {
    case ChatAccessError.TierForbidden(message) =>
      complete(StatusCodes.Forbidden, TierErrorResponse("TIER_FORBIDDEN", message, None))
    case ChatAccessError.LimitReached(limit) =>
      complete(StatusCodes.TooManyRequests, TierErrorResponse("CHAT_LIMIT_REACHED", err.message, Some(limit)))
  }
}
