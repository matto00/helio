package com.helio.services

import com.helio.api.protocols.PutAgentPreferencesRequest
import com.helio.domain.{AgentPreferences, AuthenticatedUser}
import com.helio.infrastructure.AgentPreferencesRepository
import spray.json.JsObject

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `GET`/`PUT /api/preferences` (HEL-472 / 420-A), plus the dedicated
 *  `PUT /api/preferences/memory-enabled` (HEL-531 / 420-E). Every operation is scoped to the
 *  caller's own row (RLS-enforced by [[AgentPreferencesRepository]] under `withUserContext`), and
 *  there is no target-ownership check that can fail the way `PipelineScheduleService`'s does --
 *  so every method returns a plain `Future[AgentPreferences]`, never
 *  `Future[Either[ServiceError, AgentPreferences]]` (tasks.md 2.2). */
final class AgentPreferencesService(repo: AgentPreferencesRepository)(implicit ec: ExecutionContext) {

  /** Returns the caller's stored preferences, or an all-empty default (`AgentPreferences.empty`)
   *  when nothing has been stored yet (design.md Decision 3). */
  def get(user: AuthenticatedUser): Future[AgentPreferences] =
    repo.get(user.id).map(_.getOrElse(AgentPreferences.empty(user.id, AgentPreferencesService.DefaultMemoryEnabled)))

  /** Full replace (design.md Decision 4) -- the request body's fields become the ENTIRE stored
   *  preferences object. `userId` is always taken from the authenticated caller, never the wire
   *  body (the wire `PutAgentPreferencesRequest` carries no such field at all). An absent
   *  `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` key decodes to `None` via
   *  spray-json's standard `Option` handling, clearing any previously-stored value; an absent
   *  `extras` key normalizes to `JsObject.empty` here, identically to an explicit `{}`.
   *
   *  HEL-531 (420-E) design.md Decision 2: `memoryEnabled` lives in the SAME stored JSONB blob as
   *  these four fields, but `PutAgentPreferencesRequest` carries no `memoryEnabled` field at all
   *  (design.md Decision 1 -- it is written only through `setMemoryEnabled`'s dedicated endpoint).
   *  This read-then-write carries the caller's CURRENT `memoryEnabled` forward unchanged before
   *  overlaying the request's four fields, so an ordinary "Save preferences" call from 420-D's
   *  (already-shipped, memoryEnabled-unaware) Settings UI can never silently reset it back to the
   *  default. */
  def put(user: AuthenticatedUser, req: PutAgentPreferencesRequest): Future[AgentPreferences] =
    get(user).flatMap { current =>
      val prefs = AgentPreferences(
        userId              = user.id,
        defaultSeriesColors = req.defaultSeriesColors,
        defaultPanelStyle   = req.defaultPanelStyle,
        namingConventions   = req.namingConventions,
        extras              = req.extras.getOrElse(JsObject.empty),
        memoryEnabled       = current.memoryEnabled
      )
      repo.put(user.id, prefs)
    }

  /** `PUT /api/preferences/memory-enabled` (HEL-531 / 420-E design.md Decision 1/2) -- the mirror
   *  image of `put`: reads the caller's current preferences, overlays ONLY `memoryEnabled`, and
   *  writes the whole object back via the same `AgentPreferencesRepository.put` primitive. Every
   *  other field is carried forward unchanged. */
  def setMemoryEnabled(user: AuthenticatedUser, enabled: Boolean): Future[AgentPreferences] =
    get(user).flatMap(current => repo.put(user.id, current.copy(memoryEnabled = enabled)))
}

object AgentPreferencesService {

  /** Env-var-overridable default for a caller with no stored preferences (design.md Decision 3),
   *  same convention as `WorkspaceContextBudget.DefaultBudgetBytes`. `true` preserves today's
   *  actual behavior -- no opt-out has ever existed, so every existing user's memory capture stays
   *  on unless they explicitly opt out. */
  val DefaultMemoryEnabled: Boolean =
    sys.env.get("AGENT_MEMORY_DEFAULT_ENABLED").flatMap(_.toBooleanOption).getOrElse(true)
}
