package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-913: persistence for `pipeline_roots` -- the table that replaces
 *  `pipelines.source_data_source_id` (V98). A pipeline has N roots, each an
 *  independently-loaded `(dataSourceId, position)` pair a step trunk can be
 *  attached to (design.md R1-R3). RLS mirrors `pipeline_steps`: owner-only
 *  for INSERT/UPDATE/DELETE, sharing-aware (`helio_can_access_pipeline`) for
 *  SELECT (V98 §11) -- so every write here goes through `ctx.withUserContext`
 *  scoped to the pipeline OWNER, exactly like `PipelineStepRepository`.
 */
class PipelineRootRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineRootRepository._

  private val rootsTable = TableQuery[PipelineRootTable]

  private def rowToDomain(row: PipelineRootRow): PipelineRoot =
    PipelineRoot(
      id           = PipelineRootId(row.id),
      pipelineId   = PipelineId(row.pipelineId),
      dataSourceId = DataSourceId(row.dataSourceId),
      position     = row.position,
      createdAt    = row.createdAt
    )

  /** Sharing-aware list, ordered by position (R3's cross-root tiebreak). */
  def list(pipelineId: PipelineId, user: AuthenticatedUser): Future[Vector[PipelineRoot]] =
    ctx.withUserContext(user.id.value)(
      rootsTable.filter(_.pipelineId === pipelineId.value).sortBy(_.position).result
    ).map(_.map(rowToDomain).toVector)

  /** ACL-bypassing list. Reserved for privileged/background callers (engine, run service) that
   *  have already resolved authorization at a higher layer -- mirrors
   *  `PipelineRepository.findByIdInternal`'s contract. */
  def listInternal(pipelineId: PipelineId): Future[Vector[PipelineRoot]] =
    ctx.withSystemContext(
      rootsTable.filter(_.pipelineId === pipelineId.value).sortBy(_.position).result
    ).map(_.map(rowToDomain).toVector)

  /** Appends one root at the next available position. Caller (the service layer) is responsible
   *  for authorizing `dataSourceId` against the owner before calling this -- mirrors
   *  `PipelineRepository.create`'s existing `dataSourceRepo.findByIdOwned` contract. */
  def add(pipelineId: PipelineId, dataSourceId: DataSourceId, user: AuthenticatedUser): Future[PipelineRoot] = {
    val id  = UUID.randomUUID().toString
    val now = Instant.now()
    val nextPositionQuery =
      rootsTable.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
    ctx.withUserContext(user.id.value) {
      nextPositionQuery.flatMap { maxPosOpt =>
        val row = PipelineRootRow(id, pipelineId.value, dataSourceId.value, maxPosOpt.map(_ + 1).getOrElse(0), now)
        (rootsTable += row).map(_ => row)
      }
    }.map(rowToDomain)
  }

  /** DBIO variant of [[add]], for composition into the single-call transactional pipeline-create
   *  path (mirrors `PipelineRepository.createAction`). `position` is passed explicitly rather
   *  than computed via `max` -- the transactional create path knows every root's position up
   *  front (it is creating them all in the same call), so there is no concurrent-insert race to
   *  resolve here the way `add` above must. */
  def addAction(pipelineId: PipelineId, dataSourceId: DataSourceId, position: Int): DBIO[PipelineRoot] = {
    val id  = UUID.randomUUID().toString
    val now = Instant.now()
    val row = PipelineRootRow(id, pipelineId.value, dataSourceId.value, position, now)
    (rootsTable += row).map(_ => rowToDomain(row))
  }

  /** Owner-scoped removal. Returns `false` if no row matched (not owned / does not exist) --
   *  the service layer (task 4.6 / R7) is responsible for refusing removal of the LAST root or a
   *  root a surviving lane still references BEFORE calling this. */
  def remove(rootId: PipelineRootId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(
      rootsTable.filter(_.id === rootId.value).delete
    ).map(_ > 0)

  /** DBIO variant of [[remove]] (HEL-913 task 7.4/7.5), for composition into
   *  `PipelineService.removeRoot`'s ONE transaction spanning this repo and
   *  `PipelineStepRepository`'s explicit step/`node_snapshots` cleanup (R7 phase 2) --
   *  mirrors `addAction`'s existing DBIO-variant convention. Privileged (no ACL check here):
   *  the caller has already confirmed editor/owner access and every R7 refusal BEFORE composing
   *  this into the transaction. */
  def removeAction(rootId: PipelineRootId): DBIO[Int] =
    rootsTable.filter(_.id === rootId.value).delete

  /** Compacts a pipeline's remaining roots to a dense 0..N-1 position sequence, preserving
   *  relative order. Used after a root removal (R7 phase 2) so a later root's `position` never
   *  carries a gap a cross-root tiebreak (R3) would otherwise have to special-case. */
  def compactPositions(pipelineId: PipelineId): DBIO[Unit] =
    rootsTable
      .filter(_.pipelineId === pipelineId.value)
      .sortBy(_.position)
      .map(r => (r.id, r.position))
      .result
      .flatMap { rows =>
        val updates = rows.zipWithIndex.collect {
          case ((id, currentPos), idx) if currentPos != idx =>
            rootsTable.filter(_.id === id).map(_.position).update(idx)
        }
        DBIO.sequence(updates).map(_ => ())
      }
}

object PipelineRootRepository {

  private implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  case class PipelineRootRow(
      id: String,
      pipelineId: String,
      dataSourceId: String,
      position: Int,
      createdAt: Instant
  )

  class PipelineRootTable(tag: Tag) extends Table[PipelineRootRow](tag, "pipeline_roots") {
    def id           = column[String]("id", O.PrimaryKey)
    def pipelineId   = column[String]("pipeline_id")
    def dataSourceId = column[String]("data_source_id")
    def position     = column[Int]("position")
    def createdAt    = column[Instant]("created_at")

    def * = (id, pipelineId, dataSourceId, position, createdAt).mapTo[PipelineRootRow]
  }
}
