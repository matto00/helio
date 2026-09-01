package com.helio.infrastructure.persistence.workspace

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.domain.model.AuthenticatedUser
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-366: tag-scoped bulk teardown — plan computation AND execution inside
 *  a single app-pool DB transaction (design.md Decision 3's hard constraint).
 *
 *  **Every read and write in [[teardown]]'s composed `DBIO` runs via
 *  `ctx.withUserContext` — never `ctx.withSystemContext`.** RLS is the
 *  owner-scoping backbone this whole feature leans on.
 *
 *  Delete order is Pipelines → DataSources so the *reported* counts are
 *  precise (a pipeline deleted first means its later source-DataSource
 *  deletes are not double-counted as cascades), even though PostgreSQL's FK
 *  cascades would enforce correctness regardless of order (design.md
 *  Decision 3).
 *
 *  HEL-904 task 3.2: the `resourceKind = "data_type"` branch (and its three
 *  guards -- output-DataType-dependent-pipeline, source-link, panel-bound)
 *  is REMOVED outright, per the `workspace-tag-teardown` OpenSpec delta.
 *  Outputs are torn down transitively via `ON DELETE CASCADE` from their
 *  owning pipeline (see the `outputs` table's FK) -- they are no longer an
 *  independently tagged/guarded resource kind. `DataTypeRepository` is no
 *  longer a constructor dependency of this class. */
class WorkspaceTeardownRepository(
    ctx: DbContext
)(implicit ec: ExecutionContext) {

  import WorkspaceTeardownRepository._

  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val pipelinesTable   = TableQuery[PipelineRepository.PipelineTable]
  // HEL-907 evaluator-1 CR3: extends tag-scoped teardown to dashboards --
  // found while fixing the MCP E2E Sleeper-rebuild script's own dashboard
  // leak (create_dashboard had no tag param because dashboards had no tag
  // column at all, V95 adds one). A dashboard has no external-dependent
  // guard the way a tagged DataSource does (nothing else FK-references a
  // dashboard the way a Pipeline references its source) -- its panels
  // cascade via the pre-existing `panels.dashboard_id ON DELETE CASCADE`
  // (V2), so this is a plain tagged-delete, no conflict check needed.
  private val dashboardsTable  = TableQuery[DashboardRepository.DashboardTable]

  /** Compute the teardown plan for `tag` under `user`'s ownership and — when
   *  it is clean (no conflicts) and `dryRun` is false — execute the deletes,
   *  all inside one `.transactionally` DBIO. The untagged/differently-tagged
   *  dependent re-check runs as the LAST read before the DELETEs are issued
   *  (not a separate earlier call) — design.md Decision 3's residual-TOCTOU
   *  mitigation; there is no other read between it and the deletes in this
   *  composition. */
  def teardown(tag: String, dryRun: Boolean, user: AuthenticatedUser): Future[TeardownOutcome] = {
    val ownerUuid = UUID.fromString(user.id.value)

    val action: DBIO[TeardownOutcome] = for {
      taggedSources    <- dataSourcesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result
      taggedPipelines  <- pipelinesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result
      taggedDashboards <- dashboardsTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result

      sourceDependentConflicts <- DBIO.sequence(taggedSources.map(s => sourceDependentPipelineConflict(s, tag)))

      conflicts = sourceDependentConflicts.flatten.toVector
      // design.md Decision 4: a dry run's counts mean "would be affected",
      // not "were affected" — gate them on the set being CLEAN (no
      // conflicts), not on `committed` (which is also false for a clean dry
      // run). Only the actual DELETEs and the post-commit file-cleanup input
      // (`deletedSources` below) are gated on `committed`.
      clean = conflicts.isEmpty

      committed <-
        if (!clean || dryRun) DBIO.successful(false)
        else {
          val pipelineIds  = taggedPipelines.map(_.id).toSet
          val sourceIds    = taggedSources.map(_.id).toSet
          val dashboardIds = taggedDashboards.map(_.id).toSet
          val deletePipelines  = pipelinesTable.filter(_.id.inSet(pipelineIds)).delete
          val deleteSources    = dataSourcesTable.filter(_.id.inSet(sourceIds)).delete
          // Dashboards have no cross-resource dependent to sequence around
          // (see the constructor-site comment above) -- deleted alongside
          // the other two, panels cascade via their own pre-existing FK.
          val deleteDashboards = dashboardsTable.filter(_.id.inSet(dashboardIds)).delete
          (deletePipelines andThen deleteSources andThen deleteDashboards).map(_ => true)
        }
    } yield TeardownOutcome(
      blocked = conflicts.nonEmpty,
      conflicts = conflicts,
      committed = committed,
      sourcesDeleted = if (clean) taggedSources.size else 0,
      pipelinesDeleted = if (clean) taggedPipelines.size else 0,
      dashboardsDeleted = if (clean) taggedDashboards.size else 0,
      // Post-commit file cleanup (design.md Decision 3 addendum, tasks.md
      // 3.5) needs the raw (sourceType, config) of every deleted source —
      // decoded by the service layer via DataSourceConfigCodec, kept out of
      // this repository to avoid an app-pool-transaction dependency on the
      // protocols package.
      deletedSources =
        if (committed) taggedSources.map(s => DeletedSource(s.id, s.sourceType, s.config)).toVector else Vector.empty
    )

    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  /** design.md Decision 2 / tasks.md 3.3, DataSource→Pipeline direction:
   *  blocks when a Pipeline exists whose `source_data_source_id` is this
   *  tagged DataSource's id AND that Pipeline's `tag IS DISTINCT FROM` the
   *  tag being torn down (covers both an untagged dependent and one tagged
   *  into a different, live batch — never narrowed to a bare `tag IS NULL`
   *  check). */
  private def sourceDependentPipelineConflict(
      source: DataSourceRepository.DataSourceRow,
      tag: String
  ): DBIO[Option[TeardownConflict]] =
    sql"""SELECT id, name FROM pipelines
          WHERE source_data_source_id = ${source.id} AND tag IS DISTINCT FROM $tag
          LIMIT 1"""
      .as[(String, String)].headOption.map(_.map { case (pipelineId, pipelineName) =>
        TeardownConflict(
          resourceKind = "data_source",
          resourceId   = source.id,
          resourceName = source.name,
          reason       = s"has a dependent pipeline '$pipelineName' ($pipelineId) that is not in this tag batch"
        )
      })
}

object WorkspaceTeardownRepository {

  /** One blocking conflict — the tagged resource that would be blocked, and
   *  why. `resourceKind` is `"data_source"` (the only kind carrying a guard
   *  per design.md Decision 2 — a tagged Pipeline has no analogous "someone
   *  else depends on me" guard: nothing else has a hard FK dependency on a
   *  Pipeline row; Outputs cascade with their owning pipeline, per HEL-904
   *  task 3.2, and no longer carry a guard of their own). */
  final case class TeardownConflict(
      resourceKind: String,
      resourceId: String,
      resourceName: String,
      reason: String
  )

  /** A deleted, potentially file-backed DataSource — carries the raw
   *  `(sourceType, config)` so the service layer can decode the stored file
   *  path via `DataSourceConfigCodec` for post-commit best-effort cleanup
   *  (design.md Decision 3 addendum). */
  final case class DeletedSource(id: String, sourceType: String, config: String)

  final case class TeardownOutcome(
      blocked: Boolean,
      conflicts: Vector[TeardownConflict],
      committed: Boolean,
      sourcesDeleted: Int,
      pipelinesDeleted: Int,
      // HEL-907 evaluator-1 CR3: appended last, so this stays source-compatible
      // for any test fixture still constructing this positionally.
      deletedSources: Vector[DeletedSource],
      // HEL-907 evaluator-2: no default -- always explicitly set at this class's one
      // construction site (the `yield` below), never constructed positionally elsewhere.
      dashboardsDeleted: Int
  )
}
