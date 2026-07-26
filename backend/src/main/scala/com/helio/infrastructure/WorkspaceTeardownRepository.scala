package com.helio.infrastructure

import com.helio.domain.{AuthenticatedUser, DataTypeId}
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** HEL-366: tag-scoped bulk teardown — plan computation AND execution inside
 *  a single app-pool DB transaction (design.md Decision 3's hard constraint).
 *
 *  **Every read and write in [[teardown]]'s composed `DBIO` runs via
 *  `ctx.withUserContext` — never `ctx.withSystemContext`.** RLS is the
 *  owner-scoping backbone this whole feature leans on; a sub-check that
 *  silently used the privileged pool would defeat that guarantee for exactly
 *  the sub-check protecting the most dangerous part of the operation. This
 *  rules out `DataSourceRepository.findByIdInternal` / `DataTypeService.
 *  checkSourceLink` (both privileged-pool) — the source-link guard below is
 *  a narrow, deliberately-duplicated re-implementation scoped to the app
 *  pool instead (design.md Decision 6 / tasks.md 3.2).
 *
 *  Delete order is Pipelines → DataTypes → DataSources so the *reported*
 *  counts are precise (a pipeline deleted first means its later output-
 *  DataType / source-DataSource deletes are not double-counted as cascades),
 *  even though PostgreSQL's FK cascades would enforce correctness regardless
 *  of order (design.md Decision 3). */
class WorkspaceTeardownRepository(
    ctx: DbContext,
    dataTypeRepo: DataTypeRepository
)(implicit ec: ExecutionContext) {

  import WorkspaceTeardownRepository._

  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val pipelinesTable   = TableQuery[PipelineRepository.PipelineTable]
  private val dataTypesTable   = TableQuery[DataTypeRepository.DataTypeTable]

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
      taggedSources   <- dataSourcesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result
      taggedPipelines <- pipelinesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result
      taggedTypes     <- dataTypesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag).result

      sourceDependentConflicts <- DBIO.sequence(taggedSources.map(s => sourceDependentPipelineConflict(s, tag)))
      typeDependentConflicts   <- DBIO.sequence(taggedTypes.map(t => outputTypeDependentPipelineConflict(t, tag)))
      sourceLinkConflicts      <- DBIO.sequence(taggedTypes.map(t => sourceLinkConflict(t, tag)))
      panelBoundConflicts      <- DBIO.sequence(taggedTypes.map(t => panelBoundConflict(t, user)))

      conflicts = (sourceDependentConflicts ++ typeDependentConflicts ++ sourceLinkConflicts ++ panelBoundConflicts).flatten.toVector
      // design.md Decision 4: a dry run's counts mean "would be affected",
      // not "were affected" — gate them on the set being CLEAN (no
      // conflicts), not on `committed` (which is also false for a clean dry
      // run). Only the actual DELETEs and the post-commit file-cleanup input
      // (`deletedSources` below) are gated on `committed`.
      clean = conflicts.isEmpty

      committed <-
        if (!clean || dryRun) DBIO.successful(false)
        else {
          val pipelineIds = taggedPipelines.map(_.id).toSet
          val typeIds     = taggedTypes.map(_.id).toSet
          val sourceIds   = taggedSources.map(_.id).toSet
          val deletePipelines = pipelinesTable.filter(_.id.inSet(pipelineIds)).delete
          val deleteTypes     = dataTypesTable.filter(_.id.inSet(typeIds)).delete
          val deleteSources   = dataSourcesTable.filter(_.id.inSet(sourceIds)).delete
          (deletePipelines andThen deleteTypes andThen deleteSources).map(_ => true)
        }
    } yield TeardownOutcome(
      blocked = conflicts.nonEmpty,
      conflicts = conflicts,
      committed = committed,
      sourcesDeleted = if (clean) taggedSources.size else 0,
      pipelinesDeleted = if (clean) taggedPipelines.size else 0,
      typesDeleted = if (clean) taggedTypes.size else 0,
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

  /** design.md Decision 2 / tasks.md 3.3, output DataType→Pipeline direction:
   *  blocks when the Pipeline producing this tagged DataType (as its
   *  `output_data_type_id`) exists AND that Pipeline's `tag IS DISTINCT
   *  FROM` the tag being torn down. A source-companion DataType (never any
   *  pipeline's `output_data_type_id`) always yields no match here — the
   *  same query is safe to run uniformly over every tagged DataType rather
   *  than pre-filtering to pipeline outputs. */
  private def outputTypeDependentPipelineConflict(
      dt: DataTypeRepository.DataTypeRow,
      tag: String
  ): DBIO[Option[TeardownConflict]] =
    sql"""SELECT id, name FROM pipelines
          WHERE output_data_type_id = ${dt.id} AND tag IS DISTINCT FROM $tag
          LIMIT 1"""
      .as[(String, String)].headOption.map(_.map { case (pipelineId, pipelineName) =>
        TeardownConflict(
          resourceKind = "data_type",
          resourceId   = dt.id,
          resourceName = dt.name,
          reason       = s"is the output of pipeline '$pipelineName' ($pipelineId) that is not in this tag batch"
        )
      })

  /** design.md Decision 6 / tasks.md 3.2: the source-link guard, reimplemented
   *  as a narrow, app-pool, tag-scoped existence check — NOT a call to
   *  `DataTypeService.checkSourceLink` (privileged pool via
   *  `findByIdInternal`; not composable into this transaction, and its bare-
   *  existence semantics would wrongly block the common tagged-source +
   *  tagged-companion case). Blocks ONLY when a DataSource with
   *  `id = dt.sourceId` exists AND its `tag IS DISTINCT FROM` the tag being
   *  torn down — a source tagged into the SAME batch is not a blocker since
   *  it is deleted in the same call. See the cross-reference comment on
   *  `DataTypeService.checkSourceLink`. */
  private def sourceLinkConflict(dt: DataTypeRepository.DataTypeRow, tag: String): DBIO[Option[TeardownConflict]] =
    dt.sourceId match {
      case None => DBIO.successful(None)
      case Some(srcId) =>
        sql"""SELECT id, name FROM data_sources
              WHERE id = $srcId AND tag IS DISTINCT FROM $tag
              LIMIT 1"""
          .as[(String, String)].headOption.map(_.map { case (sourceId, sourceName) =>
            TeardownConflict(
              resourceKind = "data_type",
              resourceId   = dt.id,
              resourceName = dt.name,
              reason       = s"is the auto-inferred schema of data source '$sourceName' ($sourceId) that is not in this tag batch"
            )
          })
    }

  /** Reuses `DataTypeRepository.existsBoundToAnyOwnedPanelAction` (tasks.md
   *  3.1) — the exact same app-pool query `DELETE /api/types/:id` already
   *  runs, composed as a bare `DBIO` inside this transaction rather than
   *  duplicated. */
  private def panelBoundConflict(dt: DataTypeRepository.DataTypeRow, user: AuthenticatedUser): DBIO[Option[TeardownConflict]] =
    dataTypeRepo.existsBoundToAnyOwnedPanelAction(DataTypeId(dt.id), user).map { count =>
      if (count > 0)
        Some(TeardownConflict(
          resourceKind = "data_type",
          resourceId   = dt.id,
          resourceName = dt.name,
          reason       = "is bound to one or more panels"
        ))
      else None
    }
}

object WorkspaceTeardownRepository {

  /** One blocking conflict — the tagged resource that would be blocked, and
   *  why. `resourceKind` is `"data_source"` or `"data_type"` (only these two
   *  kinds carry a guard per design.md Decision 2/6 — a tagged Pipeline has
   *  no analogous "someone else depends on me" guard: nothing else has a
   *  hard FK dependency on a Pipeline row). */
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
      typesDeleted: Int,
      deletedSources: Vector[DeletedSource]
  )
}
