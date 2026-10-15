package com.helio.services.auth

import com.helio.api.protocols.auth.{UserPreferences, UserResponse}
import com.helio.domain.model.User
import com.helio.infrastructure.persistence.auth.UserPreferenceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1574: the single place that builds the wire `UserResponse` for every user-returning auth response (`/me`,
 *  login, register, OAuth, MFA verify, beta redeem), so each carries `preferences` and the shell has its saved
 *  layout before it first renders. `None` repo (fixtures that predate the shell keys) keeps the old preference-less
 *  shape. */
final class UserResponseAssembler(preferenceRepo: Option[UserPreferenceRepository])(implicit ec: ExecutionContext) {

  def preferencesOf(user: User): Future[Option[UserPreferences]] =
    preferenceRepo match {
      case Some(repo) =>
        repo.getPreferences(user.id).map { p =>
          Some(UserPreferences(p.accentColor, p.zoomLevels, p.contextListWidth, p.contextListCollapsed, p.dashboardTabs))
        }
      case None => Future.successful(None)
    }

  def apply(user: User): Future[UserResponse] =
    preferencesOf(user).map(prefs => UserResponse.fromDomain(user, prefs))
}
