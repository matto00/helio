package com.helio.infrastructure

import com.helio.domain.{AgentPreferences, UserId}
import slick.jdbc.PostgresProfile.api._
import spray.json.DefaultJsonProtocol._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence for agent-authoring preferences (HEL-472 / 420-A). One row per user, keyed
 *  directly on `user_id` (the primary key) -- see V81. The four logical fields
 *  (`defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`/`extras`) are serialized into a
 *  single `preferences` JSONB column at this boundary (design.md Decision 1), mirroring
 *  `AlertRuleRepository.condition`'s `jsonbStringType` pattern.
 *
 *  Both `get` and `put` run under [[DbContext.withUserContext]] -- there is no privileged/
 *  pre-auth read path here (unlike `ApiTokenRepository`'s authentication lookups), so every call
 *  site is a request-bound user action the V81 RLS policy scopes to the caller's own row
 *  (design.md Decision 3). */
class AgentPreferencesRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AgentPreferencesRepository._

  private val table = TableQuery[AgentPreferencesTable]

  /** Returns `None` when the caller has no stored row yet -- `AgentPreferencesService.get` maps
   *  that to an all-empty default (design.md Decision 3). */
  def get(userId: UserId): Future[Option[AgentPreferences]] = {
    val userUuid = UUID.fromString(userId.value)
    ctx.withUserContext(userId.value)(
      table.filter(_.userId === userUuid).result.headOption
    ).map(_.map(rowToDomain))
  }

  /** Upsert-by-user: `INSERT ... ON CONFLICT (user_id) DO UPDATE`, via Slick's `insertOrUpdate`
   *  (the same primitive `PipelineScheduleRepository.upsert` uses) -- a full replace of the
   *  stored row, never a field-by-field merge (design.md Decision 4). */
  def put(userId: UserId, prefs: AgentPreferences): Future[AgentPreferences] =
    ctx.withUserContext(userId.value)(
      table.insertOrUpdate(domainToRow(prefs))
    ).map(_ => prefs)

  private def rowToDomain(row: AgentPreferencesRow): AgentPreferences = {
    val fields = row.preferences.parseJson.asJsObject.fields
    AgentPreferences(
      userId              = UserId(row.userId.toString),
      defaultSeriesColors = fields.get("defaultSeriesColors").map(_.convertTo[Vector[String]]),
      defaultPanelStyle   = fields.get("defaultPanelStyle").collect { case o: JsObject => o },
      namingConventions   = fields.get("namingConventions").collect { case o: JsObject => o },
      extras              = fields.get("extras").collect { case o: JsObject => o }.getOrElse(JsObject.empty)
    )
  }

  /** `updated_at` is deliberately set here, repository-internal, on every call -- never sourced
   *  from `prefs` (which carries no such field at all, design.md Decision 4a). Explicit rather
   *  than relying on the column's `DEFAULT now()`, since that default only fires on the INSERT
   *  branch of `ON CONFLICT ... DO UPDATE`, never the UPDATE branch. */
  private def domainToRow(prefs: AgentPreferences): AgentPreferencesRow = {
    val fields = Map.newBuilder[String, JsValue]
    prefs.defaultSeriesColors.foreach(v => fields += "defaultSeriesColors" -> v.toJson)
    prefs.defaultPanelStyle.foreach(v => fields += "defaultPanelStyle" -> v)
    prefs.namingConventions.foreach(v => fields += "namingConventions" -> v)
    fields += "extras" -> prefs.extras
    AgentPreferencesRow(
      userId      = UUID.fromString(prefs.userId.value),
      preferences = JsObject(fields.result()).compactPrint,
      updatedAt   = Instant.now()
    )
  }
}

object AgentPreferencesRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String <-> PostgreSQL JSONB -- identity at the Scala level; the type exists to
   *  mark the JSONB-backed column explicitly (mirrors `AlertRuleRepository.jsonbStringType`/
   *  `DataSourceRepository.jsonbStringType`). */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  final case class AgentPreferencesRow(
      userId: UUID,
      preferences: String,
      updatedAt: Instant
  )

  class AgentPreferencesTable(tag: Tag) extends Table[AgentPreferencesRow](tag, "agent_preferences") {
    def userId      = column[UUID]("user_id", O.PrimaryKey)
    def preferences = column[String]("preferences")(jsonbStringType)
    def updatedAt   = column[Instant]("updated_at")
    def * = (userId, preferences, updatedAt) <> (AgentPreferencesRow.tupled, AgentPreferencesRow.unapply)
  }
}
