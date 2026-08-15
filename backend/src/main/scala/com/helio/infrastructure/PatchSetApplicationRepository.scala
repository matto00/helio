package com.helio.infrastructure

import com.helio.domain.{AuthenticatedUser, PatchSetApplicationId, UserId}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped Slick repository for the `patch_set_applications` table (HEL-413 design.md D1/D2/
 *  D3) — mirrors `AuthoringConversationRepository`'s `withUserContext` + JSONB-column-mapping
 *  conventions exactly. A row is written once, by `PatchSetApplyService.apply`'s terminal success
 *  branch, and read once, by `PatchSetUndoService.undo` — no update method exists (the journal is
 *  immutable once written).
 *
 *  `edits` holds `JournaledEdit`s — a repository-internal shape distinct from `EditOutcome`
 *  (the `/apply` wire response type): it additionally carries `targetKind`/`op` (needed to
 *  reconstruct the right per-kind inverse once detached from the original `PatchSet` request) and
 *  `rawResultingConfig` (design.md D2a's panel-update-only raw config snapshot, which must never
 *  reach the `/apply` response). */
class PatchSetApplicationRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PatchSetApplicationRepository._

  private val table = TableQuery[PatchSetApplicationTable]

  private def rowToRecord(row: PatchSetApplicationRow): PatchSetApplicationRecord =
    PatchSetApplicationRecord(
      id        = PatchSetApplicationId(row.id),
      ownerId   = UserId(row.ownerId.toString),
      appliedAt = row.appliedAt,
      edits     = row.edits,
      createdAt = row.createdAt
    )

  private def recordToRow(r: PatchSetApplicationRecord): PatchSetApplicationRow =
    PatchSetApplicationRow(
      id        = r.id.value,
      ownerId   = UUID.fromString(r.ownerId.value),
      appliedAt = r.appliedAt,
      edits     = r.edits,
      createdAt = r.createdAt
    )

  /** Inserts a fresh application row, then prunes that SAME owner's rows beyond the `keepN`
   *  most-recent (default 20, design.md D3), atomically in the SAME `withUserContext`
   *  transaction — the insert and the prune's `DELETE ... NOT IN (SELECT id ... ORDER BY
   *  applied_at DESC LIMIT keepN)` both run as one write, mirroring
   *  `PipelineRunRepository.deleteOldRunsInternal`'s existing precedent (never a non-atomic
   *  SELECT-then-DELETE round trip). Runs in `record.ownerId`'s user context so the V79 RLS
   *  policy's `WITH CHECK` (implied by the bare `USING` clause on `INSERT`) is satisfied. */
  def create(record: PatchSetApplicationRecord, keepN: Int = 20): Future[PatchSetApplicationRecord] = {
    val ownerUuid     = UUID.fromString(record.ownerId.value)
    val insertAction  = table += recordToRow(record)
    val pruneAction   = pruneBeyond(ownerUuid, keepN)
    ctx.withUserContext(record.ownerId.value)(insertAction andThen pruneAction).map(_ => record)
  }

  private def pruneBeyond(ownerUuid: UUID, keepN: Int) = {
    val keepIds = table.filter(_.ownerId === ownerUuid).sortBy(_.appliedAt.desc).take(keepN).map(_.id)
    table.filter(r => r.ownerId === ownerUuid && !r.id.in(keepIds)).delete
  }

  /** Owner-scoped findById — RLS-scoped via `withUserContext` AND an explicit `ownerId` filter
   *  (defense-in-depth, mirrors `AuthoringConversationRepository.findById`). A missing id, a
   *  foreign-owned id, and a pruned-away id are all indistinguishable: every one resolves to
   *  `None` (design.md D3 — "a pruned-away id later 404s on undo exactly like an unowned/
   *  nonexistent one — no special-cased response"). */
  def findById(id: PatchSetApplicationId, user: AuthenticatedUser): Future[Option[PatchSetApplicationRecord]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      table.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToRecord))
  }
}

object PatchSetApplicationRepository extends DefaultJsonProtocol {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** One journaled edit (design.md D1) — the journal's OWN record shape, distinct from
   *  `EditOutcome` (the `/apply` wire response type). `targetKind`/`op` come from the original
   *  `Edit` (needed to pick the right per-kind inverse once detached from the request that
   *  produced this record); `priorState`/`resultingState`/`newId` are `EditOutcome`'s own fields,
   *  reused verbatim; `rawResultingConfig` is design.md D2a's panel-update-only raw config
   *  snapshot — `None` for every other kind/op. */
  final case class JournaledEdit(
      index: Int,
      targetKind: String,
      op: String,
      priorState: Option[JsValue],
      resultingState: Option[JsValue],
      newId: Option[String],
      rawResultingConfig: Option[JsValue]
  )

  implicit val journaledEditFormat: RootJsonFormat[JournaledEdit] = jsonFormat7(JournaledEdit.apply)

  implicit val journaledEditsColumnType: BaseColumnType[Vector[JournaledEdit]] =
    MappedColumnType.base[Vector[JournaledEdit], String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[Vector[JournaledEdit]]
    )

  /** The repository-facing shape — value-class-typed, mirrors `AuthoringConversationRecord`'s
   *  role for `AuthoringConversationRepository`. Never crosses the HTTP boundary directly. */
  final case class PatchSetApplicationRecord(
      id: PatchSetApplicationId,
      ownerId: UserId,
      appliedAt: Instant,
      edits: Vector[JournaledEdit],
      createdAt: Instant
  )

  private[infrastructure] case class PatchSetApplicationRow(
      id: String,
      ownerId: UUID,
      appliedAt: Instant,
      edits: Vector[JournaledEdit],
      createdAt: Instant
  )

  private[infrastructure] class PatchSetApplicationTable(tag: Tag)
      extends Table[PatchSetApplicationRow](tag, "patch_set_applications") {
    def id        = column[String]("id", O.PrimaryKey)
    def ownerId   = column[UUID]("owner_id")
    def appliedAt = column[Instant]("applied_at")
    def edits     = column[Vector[JournaledEdit]]("edits")
    def createdAt = column[Instant]("created_at")

    def * = (id, ownerId, appliedAt, edits, createdAt).mapTo[PatchSetApplicationRow]
  }
}
