package com.helio.services

import com.helio.api.protocols.PutAgentPreferencesRequest
import com.helio.domain.{AgentPreferences, AuthenticatedUser}
import com.helio.infrastructure.AgentPreferencesRepository
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `GET`/`PUT /api/preferences` (HEL-472 / 420-A). Every operation is scoped
 *  to the caller's own row (RLS-enforced by [[AgentPreferencesRepository]] under
 *  `withUserContext`), and there is no target-ownership check that can fail the way
 *  `PipelineScheduleService`'s does -- so both methods return a plain `Future[AgentPreferences]`,
 *  never `Future[Either[ServiceError, AgentPreferences]]` (tasks.md 2.2). */
final class AgentPreferencesService(repo: AgentPreferencesRepository)(implicit ec: ExecutionContext) {

  /** Returns the caller's stored preferences, or an all-empty default (`AgentPreferences.empty`)
   *  when nothing has been stored yet (design.md Decision 3). */
  def get(user: AuthenticatedUser): Future[AgentPreferences] =
    repo.get(user.id).map(_.getOrElse(AgentPreferences.empty(user.id)))

  /** Full replace (design.md Decision 4) -- the request body's fields become the ENTIRE stored
   *  preferences object. `userId` is always taken from the authenticated caller, never the wire
   *  body (the wire `PutAgentPreferencesRequest` carries no such field at all). An absent
   *  `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` key decodes to `None` via
   *  spray-json's standard `Option` handling, clearing any previously-stored value; an absent
   *  `extras` key normalizes to `JsObject.empty` here, identically to an explicit `{}`. */
  def put(user: AuthenticatedUser, req: PutAgentPreferencesRequest): Future[AgentPreferences] = {
    val prefs = AgentPreferences(
      userId              = user.id,
      defaultSeriesColors = req.defaultSeriesColors,
      defaultPanelStyle   = req.defaultPanelStyle,
      namingConventions   = req.namingConventions,
      extras              = req.extras.getOrElse(JsObject.empty)
    )
    repo.put(user.id, prefs)
  }
}
