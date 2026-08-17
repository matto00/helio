package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── TOTP MFA types (HEL-702) ─────────────────────────────────────────────────

final case class MfaStatusResponse(enabled: Boolean, verifiedAt: Option[String], backupCodesRemaining: Int)
final case class MfaEnrollResponse(secret: String, otpauthUri: String)
final case class MfaConfirmRequest(code: String)
final case class MfaBackupCodesResponse(backupCodes: Vector[String])
/** Shared re-auth request shape for `/backup-codes/regenerate` and
 *  `/disable` — `code` is a current TOTP code or an unused backup code
 *  (design.md D6). */
final case class MfaReauthRequest(code: String)
final case class MfaVerifyRequest(challengeToken: String, code: String)
/** Returned by `POST /api/auth/login` / `GET /api/auth/google/callback` in
 *  place of the normal `AuthResponse` when the account has MFA enabled
 *  (`mfa-login-gate` spec) — deliberately carries no user object. */
final case class MfaRequiredResponse(mfaRequired: Boolean, challengeToken: String)

trait MfaProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val mfaStatusResponseFormat: RootJsonFormat[MfaStatusResponse] = jsonFormat3(MfaStatusResponse.apply)
  implicit val mfaEnrollResponseFormat: RootJsonFormat[MfaEnrollResponse] = jsonFormat2(MfaEnrollResponse.apply)
  implicit val mfaConfirmRequestFormat: RootJsonFormat[MfaConfirmRequest] = jsonFormat1(MfaConfirmRequest.apply)
  implicit val mfaBackupCodesResponseFormat: RootJsonFormat[MfaBackupCodesResponse] = jsonFormat1(MfaBackupCodesResponse.apply)
  implicit val mfaReauthRequestFormat: RootJsonFormat[MfaReauthRequest] = jsonFormat1(MfaReauthRequest.apply)
  implicit val mfaVerifyRequestFormat: RootJsonFormat[MfaVerifyRequest] = jsonFormat2(MfaVerifyRequest.apply)
  implicit val mfaRequiredResponseFormat: RootJsonFormat[MfaRequiredResponse] = jsonFormat2(MfaRequiredResponse.apply)
}
