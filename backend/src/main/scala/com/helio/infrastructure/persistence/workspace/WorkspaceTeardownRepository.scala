package com.helio.infrastructure.persistence.workspace

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.{DataSourceReferenceRepository, DataSourceRepository}
import com.helio.infrastructure.persistence.sources.DataSourceReferenceRepository.SourceReferences
import com.helio.domain.model.AuthenticatedUser
import org.postgresql.util.PSQLException
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-366: tag-scoped bulk teardown — plan computation AND execution inside
 *  a single app-pool DB transaction (design.md Decision 3's hard constraint).
 *
 *  **Every read and write of the plan/delete transaction in [[teardown]] runs via
 *  `ctx.withUserContext` — never `ctx.withSystemContext`.** RLS is the
 *  owner-scoping backbone this whole feature leans on.
 *
 *  HEL-1252 -- the ONE deliberate exception: the out-of-batch dependent check ([[dependentConflicts]]) runs
 *  BEFORE that transaction on the privileged pool via [[DataSourceReferenceRepository]], because an RLS
 *  read cannot see a referencing pipeline the caller has no grant on yet the delete would still cascade into
 *  it (or leave it dangling). Its visibility predicates are explicit (owner / named grantee), never RLS, and
 *  a hidden referencing resource only ever contributes an unnamed count to a conflict.
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

  private val referenceRepo   = new DataSourceReferenceRepository(ctx)
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
  def teardown(tag: String, dryRun: Boolean, user: AuthenticatedUser): Future[TeardownOutcome] =
    dependentConflicts(tag, user).flatMap { case (taggedSourceRows, preConflicts) =>
      if (preConflicts.nonEmpty) Future.successful(blockedOutcome(preConflicts))
      else
        ctx.withUserContext(user.id.value)(planAndExecute(tag, dryRun, user).transactionally).recover {
          // A dependent appeared between the pre-check and the delete and V99/V100's zero-root trigger fired.
          // The trigger text names orphaned pipeline ids (possibly hidden from this caller), so it reaches
          // neither the response nor a warn+ log: SQLSTATE only.
          case ex: PSQLException if ex.getSQLState == "P0001" =>
            log.warn(s"WorkspaceTeardownRepository.teardown: zero-root guard fired during delete (SQLSTATE ${ex.getSQLState}); nothing deleted")
            blockedOutcome(taggedSourceRows.map(s => raceConflict(s.id, s.name)).toVector)
        }
    }

  private val log = LoggerFactory.getLogger(getClass)

  private def blockedOutcome(conflicts: Vector[TeardownConflict]): TeardownOutcome =
    TeardownOutcome(
      blocked = true, conflicts = conflicts, committed = false, sourcesDeleted = 0, pipelinesDeleted = 0,
      deletedSources = Vector.empty, dashboardsDeleted = 0
    )

  private def raceConflict(id: String, name: String): TeardownConflict =
    TeardownConflict(
      resourceKind = "data_source", resourceId = id, resourceName = name,
      reason = "A dependent pipeline outside this tag batch appeared during teardown, so nothing was deleted."
    )

  /** HEL-1252 (design.md D4): the authoritative out-of-batch dependent check. Runs on the PRIVILEGED pool
   *  (never RLS) via the shared reference finder, over the caller's tagged sources (explicit
   *  `owner_id = caller AND tag = T`, never RLS). Exempt: only what THIS call deletes -- a referencing pipeline
   *  owned by the caller and tagged T, or a form panel whose dashboard is owned by the caller and tagged T.
   *  Everything else blocks, including another user's identically tagged pipeline (not deleted by this call)
   *  and every hidden resource (counted, never named). Runs for dry runs too. */
  protected def dependentConflicts(tag: String, user: AuthenticatedUser): Future[(Seq[DataSourceRepository.DataSourceRow], Vector[TeardownConflict])] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val caller    = user.id.value.toLowerCase
    // Privileged pool on purpose: the explicit owner + tag filter replaces RLS for this read (HEL-1252 D4).
    ctx.withSystemContext(dataSourcesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result).flatMap { sources =>
      referenceRepo.find(sources.map(_.id).toSet, user.id.value).map { byId =>
        val conflicts = sources.toVector.flatMap { src =>
          byId.get(src.id).flatMap { refs =>
            val remaining = SourceReferences(
              pipelines = refs.pipelines.filterNot(p => p.ownerId.toLowerCase == caller && p.tag.contains(tag)),
              hiddenPipelineCount = refs.hiddenPipelineCount,
              panels = refs.panels.filterNot(p => p.dashboardOwnerId.toLowerCase == caller && p.dashboardTag.contains(tag)),
              hiddenPanelCount = refs.hiddenPanelCount
            )
            if (remaining.isEmpty) None
            else Some(TeardownConflict(
              resourceKind = "data_source", resourceId = src.id, resourceName = src.name,
              reason = s"This data source is still referenced from outside this tag batch by ${remaining.describe}. Tag those into the batch or remove the references first."
            ))
          }
        }
        (sources, conflicts)
      }
    }
  }

  /** The user-context transaction: plan, in-tx narrowing re-check, then (when clean and not a dry run) the
   *  deletes. The re-check is the last read before the DELETEs (design.md Decision 3's residual-TOCTOU
   *  mitigation; no other read sits between). */
  private def planAndExecute(tag: String, dryRun: Boolean, user: AuthenticatedUser): DBIO[TeardownOutcome] = {
    val ownerUuid = UUID.fromString(user.id.value)
    for {
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
  }

  /** In-transaction NARROWING re-check (HEL-1252: not the authoritative exemption -- [[dependentConflicts]] is).
   *  Blocks when a pipeline VISIBLE under RLS roots on this tagged source and its `tag IS DISTINCT FROM` the tag
   *  being torn down (covers an untagged dependent and one in a different live batch; compares tag ONLY, so
   *  it neither exempts nor catches owner/other reference kinds). It is the last read before the deletes,
   *  narrowing the pre-check-to-delete window for visible roots. Its conflict is IDENTITY-FREE on purpose:
   *  on a BYPASSRLS connection this query also sees hidden pipelines, and naming them would make
   *  non-leakage depend on RLS. (HEL-913: the binding lives on `pipeline_roots`.) */
  private def sourceDependentPipelineConflict(
      source: DataSourceRepository.DataSourceRow,
      tag: String
  ): DBIO[Option[TeardownConflict]] =
    sql"""SELECT 1 FROM pipelines p
          JOIN pipeline_roots r ON r.pipeline_id = p.id
          WHERE r.data_source_id = ${source.id} AND p.tag IS DISTINCT FROM $tag
          LIMIT 1"""
      .as[Int].headOption.map(_.map { _ =>
        TeardownConflict(
          resourceKind = "data_source",
          resourceId   = source.id,
          resourceName = source.name,
          reason       = "This data source has a dependent pipeline outside this tag batch."
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
