package com.helio.infrastructure

import com.helio.ai.ClaudeMessage
import com.helio.api.protocols.{AuthoringConversationProtocol, AuthoringDisplayTurn, DashboardProposal, PatchSet}
import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for the `authoring_conversations` table (HEL-397 design.md D3,
 *  generalized by HEL-411 design.md D3 to carry a refinement conversation's `PatchSet` outcome
 *  alongside an authoring conversation's `DashboardProposal` outcome) — mirrors `MetricRepository`'s
 *  `withUserContext` + JSONB-column-mapping conventions exactly. `apiHistory` (the raw
 *  `Vector[ClaudeMessage]` shape needed to continue the Claude conversation) is read here but NEVER
 *  serialized to the wire — `findDisplayById` is the only read `DashboardAuthoringService.
 *  getConversation`/`RefinementService.getConversation`/`GET /api/authoring/conversations/:id` is
 *  ever wired to (design.md D7/D4).
 *
 *  A given row's `latestProposal`/`latestPatchSet` are mutually exclusive (HEL-411 design.md D3) —
 *  `V78__refinement_conversations.sql`'s `CHECK` is the DB-level backstop; `create`/`appendTurn`
 *  below take BOTH as explicit, separate `Option` parameters (never inferred from a single value or
 *  a boolean flag) so a call site can never silently populate both. `AuthoringConversationTurns`/
 *  `RefinementConversationTurns` are the only two callers, and each populates only its own side. */
class AuthoringConversationRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import AuthoringConversationRepository._

  private val table = TableQuery[AuthoringConversationTable]

  private def rowToRecord(row: AuthoringConversationRow): AuthoringConversationRecord =
    AuthoringConversationRecord(
      id              = AuthoringConversationId(row.id),
      ownerId         = UserId(row.ownerId.toString),
      apiHistory      = row.apiHistory,
      displayTurns    = row.displayTurns,
      latestProposal  = row.latestProposal,
      latestPatchSet  = row.latestPatchSet,
      totalTokensUsed = row.totalTokensUsed,
      createdAt       = row.createdAt,
      updatedAt       = row.updatedAt
    )

  private def recordToRow(r: AuthoringConversationRecord): AuthoringConversationRow =
    AuthoringConversationRow(
      id              = r.id.value,
      ownerId         = UUID.fromString(r.ownerId.value),
      apiHistory      = r.apiHistory,
      displayTurns    = r.displayTurns,
      latestProposal  = r.latestProposal,
      latestPatchSet  = r.latestPatchSet,
      totalTokensUsed = r.totalTokensUsed,
      createdAt       = r.createdAt,
      updatedAt       = r.updatedAt
    )

  /** Inserts a brand-new conversation row — always turn 1, always already-successful: a
   *  `DashboardAuthoringService` call only ever reaches this once a proposal has parsed +
   *  validated (see `V77__authoring_conversations.sql`'s own comment). Runs in `record.ownerId`'s
   *  user context so the V77 RLS policy's `WITH CHECK` (implied by the bare `USING` clause on
   *  `INSERT`) is satisfied. */
  def create(record: AuthoringConversationRecord): Future[AuthoringConversationRecord] =
    ctx.withUserContext(record.ownerId.value)(table += recordToRow(record)).map(_ => record)

  /** Owner-scoped findById — RLS-scoped via `withUserContext` AND an explicit `ownerId` filter
   *  (defense-in-depth, mirrors `MetricRepository.findByIdOwned`). A missing id and a
   *  foreign-owned id are indistinguishable: both resolve to `None` (CONTRIBUTING's ACL triad —
   *  existence is never leaked to a non-owner). */
  def findById(id: AuthoringConversationId, user: AuthenticatedUser): Future[Option[AuthoringConversationRecord]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToRecord))
  }

  /** The display-only subset `GET /api/authoring/conversations/:id` needs (design.md D7, HEL-411
   *  design.md D4 adds `latestPatchSet` alongside `latestProposal`) — `apiHistory` is read from the
   *  row but discarded before returning; it never crosses into the wire-facing
   *  `AuthoringConversationView`. */
  def findDisplayById(
      id: AuthoringConversationId,
      user: AuthenticatedUser
  ): Future[Option[(Vector[AuthoringDisplayTurn], Option[DashboardProposal], Option[PatchSet])]] =
    findById(id, user).map(_.map(r => (r.displayTurns, r.latestProposal, r.latestPatchSet)))

  /** Appends a completed turn — updates `api_history`/`display_turns`/`latest_proposal`/
   *  `latest_patch_set`/`total_tokens_used` together, in the SAME row-scoped `withUserContext`
   *  transaction (design.md D3; mirrors `MetricRepository.update`'s update-then-reselect shape).
   *  `latestProposal`/`latestPatchSet` (HEL-411 design.md D3) are BOTH explicit `Option` parameters
   *  — the caller (`AuthoringConversationTurns`/`RefinementConversationTurns`) always passes exactly
   *  one `Some` and one `None`, never inferred; the `CHECK` on `V78__refinement_conversations.sql`
   *  rejects a write that violates that at the DB level regardless. Returns `None` for a
   *  missing/foreign-owned id — the caller already checked via `findById` before reaching here in
   *  every real call path, but this stays safe standalone. */
  def appendTurn(
      id: AuthoringConversationId,
      user: AuthenticatedUser,
      apiHistory: Vector[ClaudeMessage],
      displayTurns: Vector[AuthoringDisplayTurn],
      latestProposal: Option[DashboardProposal],
      latestPatchSet: Option[PatchSet],
      totalTokensUsed: Int,
      updatedAt: Instant
  ): Future[Option[AuthoringConversationRecord]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val action = table
      .filter(r => r.id === id.value && r.ownerId === ownerUuid)
      .map(r => (r.apiHistory, r.displayTurns, r.latestProposal, r.latestPatchSet, r.totalTokensUsed, r.updatedAt))
      .update((apiHistory, displayTurns, latestProposal, latestPatchSet, totalTokensUsed, updatedAt))
      .andThen(table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption)
      .map(_.map(rowToRecord))
    ctx.withUserContext(user.id.value)(action)
  }
}

object AuthoringConversationRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  // Brings AuthoringDisplayTurn's format (and, transitively, DashboardProposal's) into scope for
  // the JSONB column mappings below.
  private val proto = new AuthoringConversationProtocol {}
  import proto._

  /** `ClaudeMessage` (`com.helio.ai`) is never wire-exposed — `api_history` never leaves this
   *  repository (design.md D3) — so its JSON format lives here, repository-internal, rather than
   *  under `com.helio.api.protocols` (reserved for actually wire-facing types). */
  implicit val claudeMessageFormat: RootJsonFormat[ClaudeMessage] = jsonFormat2(ClaudeMessage.apply)

  implicit val apiHistoryColumnType: BaseColumnType[Vector[ClaudeMessage]] =
    MappedColumnType.base[Vector[ClaudeMessage], String](_.toJson.compactPrint, _.parseJson.convertTo[Vector[ClaudeMessage]])

  implicit val displayTurnsColumnType: BaseColumnType[Vector[AuthoringDisplayTurn]] =
    MappedColumnType.base[Vector[AuthoringDisplayTurn], String](_.toJson.compactPrint, _.parseJson.convertTo[Vector[AuthoringDisplayTurn]])

  implicit val latestProposalColumnType: BaseColumnType[DashboardProposal] =
    MappedColumnType.base[DashboardProposal, String](_.toJson.compactPrint, _.parseJson.convertTo[DashboardProposal])

  /** HEL-411 design.md D3 — the refinement flow's own outcome column, mirroring
   *  `latestProposalColumnType` exactly. `PatchSet`'s format comes from `PatchSetProtocol`, mixed
   *  into `AuthoringConversationProtocol` (see that trait's `extends` clause) so it's in scope here
   *  via the same `proto._` import above. */
  implicit val latestPatchSetColumnType: BaseColumnType[PatchSet] =
    MappedColumnType.base[PatchSet, String](_.toJson.compactPrint, _.parseJson.convertTo[PatchSet])

  /** The repository-facing shape — value-class-typed, mirrors `MetricDefinition`'s role for
   *  `MetricRepository`. Never crosses the HTTP boundary directly: `DashboardAuthoringService`/
   *  `RefinementService` either destructure it into their own response type (just the new
   *  `conversationId`) or into `AuthoringConversationView` (`displayTurns`/`latestProposal`/
   *  `latestPatchSet` only, via `findDisplayById`). `latestProposal`/`latestPatchSet` are mutually
   *  exclusive (HEL-411 design.md D3) — enforced by `V78__refinement_conversations.sql`'s `CHECK`,
   *  never assumed by this type alone. */
  final case class AuthoringConversationRecord(
      id: AuthoringConversationId,
      ownerId: UserId,
      apiHistory: Vector[ClaudeMessage],
      displayTurns: Vector[AuthoringDisplayTurn],
      latestProposal: Option[DashboardProposal],
      latestPatchSet: Option[PatchSet],
      totalTokensUsed: Int,
      createdAt: Instant,
      updatedAt: Instant
  )

  private[infrastructure] case class AuthoringConversationRow(
      id: String,
      ownerId: UUID,
      apiHistory: Vector[ClaudeMessage],
      displayTurns: Vector[AuthoringDisplayTurn],
      latestProposal: Option[DashboardProposal],
      latestPatchSet: Option[PatchSet],
      totalTokensUsed: Int,
      createdAt: Instant,
      updatedAt: Instant
  )

  private[infrastructure] class AuthoringConversationTable(tag: Tag)
      extends Table[AuthoringConversationRow](tag, "authoring_conversations") {
    def id              = column[String]("id", O.PrimaryKey)
    def ownerId         = column[UUID]("owner_id")
    def apiHistory      = column[Vector[ClaudeMessage]]("api_history")
    def displayTurns    = column[Vector[AuthoringDisplayTurn]]("display_turns")
    def latestProposal  = column[Option[DashboardProposal]]("latest_proposal")
    def latestPatchSet  = column[Option[PatchSet]]("latest_patch_set")
    def totalTokensUsed = column[Int]("total_tokens_used")
    def createdAt       = column[Instant]("created_at")
    def updatedAt       = column[Instant]("updated_at")

    def * =
      (id, ownerId, apiHistory, displayTurns, latestProposal, latestPatchSet, totalTokensUsed, createdAt, updatedAt)
        .mapTo[AuthoringConversationRow]
  }
}
