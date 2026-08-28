package com.helio.api.protocols.auth

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._


/** `POST /api/beta-access/redeem` body. `request-access` has no request body -- the caller's
 *  identity alone determines eligibility/recipients. */
final case class RedeemInviteCodeRequest(code: String)

trait BetaAccessProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val redeemInviteCodeRequestFormat: RootJsonFormat[RedeemInviteCodeRequest] =
    jsonFormat1(RedeemInviteCodeRequest.apply)
}
