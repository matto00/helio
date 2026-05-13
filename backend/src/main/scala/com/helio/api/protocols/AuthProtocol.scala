package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Auth / User / Google OAuth / Preferences types ───────────────────────────

final case class RegisterRequest(email: String, password: String, displayName: Option[String])
final case class LoginRequest(email: String, password: String)
final case class UserPreferences(accentColor: Option[String], zoomLevels: Map[String, Double])
final case class UserResponse(
    id: String,
    email: String,
    displayName: Option[String],
    createdAt: String,
    avatarUrl: Option[String] = None,
    preferences: Option[UserPreferences] = None
)
final case class AuthResponse(token: String, expiresAt: String, user: UserResponse)
final case class GoogleProfile(sub: String, email: Option[String], name: Option[String], picture: Option[String])
final case class UserPreferencePayload(zoomLevel: Option[Double], accentColor: Option[String], dashboardId: Option[String])
final case class UpdateUserPreferenceRequest(fields: Vector[String], user: UserPreferencePayload)

object UserResponse {
  def fromDomain(user: User): UserResponse =
    UserResponse(
      id          = user.id.value,
      email       = user.email,
      displayName = user.displayName,
      createdAt   = user.createdAt.toString,
      avatarUrl   = user.avatarUrl
    )
}

trait AuthProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val registerRequestFormat: RootJsonFormat[RegisterRequest] = jsonFormat3(RegisterRequest.apply)
  implicit val loginRequestFormat: RootJsonFormat[LoginRequest]       = jsonFormat2(LoginRequest.apply)
  implicit val userPreferencesFormat: RootJsonFormat[UserPreferences] = jsonFormat2(UserPreferences.apply)
  implicit val userResponseFormat: RootJsonFormat[UserResponse]       = jsonFormat6(UserResponse.apply)
  implicit val authResponseFormat: RootJsonFormat[AuthResponse]       = jsonFormat3(AuthResponse.apply)

  // Google OAuth — read-only since we only ingest Google's userinfo payload.
  implicit val googleProfileFormat: RootJsonReader[GoogleProfile] = new RootJsonReader[GoogleProfile] {
    def read(json: JsValue): GoogleProfile = {
      val obj = json.asJsObject
      GoogleProfile(
        sub     = obj.fields("sub").convertTo[String],
        email   = obj.fields.get("email").map(_.convertTo[String]),
        name    = obj.fields.get("name").map(_.convertTo[String]),
        picture = obj.fields.get("picture").map(_.convertTo[String])
      )
    }
  }

  implicit val userPreferencePayloadFormat: RootJsonFormat[UserPreferencePayload]             = jsonFormat3(UserPreferencePayload.apply)
  implicit val updateUserPreferenceRequestFormat: RootJsonFormat[UpdateUserPreferenceRequest] = jsonFormat2(UpdateUserPreferenceRequest.apply)
}
