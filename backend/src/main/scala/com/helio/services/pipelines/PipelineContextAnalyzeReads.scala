package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{PipelineContextAnalyzeItem, PipelineStepConfigCodec}
import com.helio.domain.engine.PipelineAnalyzeService
import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import org.slf4j.LoggerFactory

import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-1625: `GET /api/pipelines/context-analyze` -- every pipeline `GET /api/pipelines` returns for the caller, with
 *  the `steps` and `warnings` `GET /api/pipelines/:id/analyze` returns for it, in a number of statements that does
 *  not depend on how many pipelines, steps or roots there are.
 *
 *  The projection itself is [[PipelineAnalyzeProjection]], shared with `analyze`; this class only prefetches. Reads
 *  (design D4): the summaries, then one batched read each for steps, step root ids and roots, then ONE read of every
 *  source the caller owns among the roots and upsert targets and ONE privileged read of every secondary source. */
private[pipelines] final class PipelineContextAnalyzeReads(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    support:          PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineContextAnalyzeReads])

  import support.{toAnalyzeStepResponse, toWarningResponse}

  def contextAnalyzeForOwner(user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineContextAnalyzeItem]]] =
    (for {
      summaries <- pipelineRepo.listSummaries(user, None)
      // D5: the batch assumes caller == owner (`ownerRootSchemas = None`). `listSummaries` is owner-only today; a
      // pipeline it ever returned that the caller does not own is skipped so the MCP analyzes it per pipeline, which
      // shapes a grantee's answer correctly, rather than silently skipping grantee shaping here.
      (owned, notOwned) = summaries.partition(_.ownerId == user.id.value)
      _ = notOwned.foreach(s => log.warn("context-analyze: skipping pipeline {} not owned by the caller", s.id))
      ids    = owned.map(s => PipelineId(s.id))
      idSet  = ids.toSet
      stepsByPipeline <- pipelineStepRepo.listByPipelineInternalBatch(idSet)
      rootIdsByPipeline <- pipelineStepRepo.rootIdsOfBatch(idSet)
      rootsByPipeline <- pipelineRepo.listRootDataSourceIdsInternalBatch(idSet)
      ownedIds     = sourceIdsOwned(ids, stepsByPipeline, rootsByPipeline)
      secondaryIds = secondarySourceIds(ids, stepsByPipeline)
      ownedMap     <- dataSourceRepo.findByIdsOwned(validIds(ownedIds), user)
      internalMap  <- dataSourceRepo.findByIdsInternal(validIds(secondaryIds))
    } yield {
      def resolver(map: Map[DataSourceId, DataSource]): PipelineAnalyzeProjection.Resolver = raw =>
        Future.fromTry(Try {
          // The same lookup the single read does: a malformed id fails that pipeline (it is then analyzed per pipeline).
          val key = DataSourceId(UUID.fromString(raw.value).toString)
          map.get(key)
        })
      val resolvers = PipelineAnalyzeProjection.Resolvers(
        rootSourceAsCaller  = resolver(ownedMap),
        upsertTargetAsOwner = resolver(ownedMap), // caller == owner (D5): the one owner-scoped map serves both
        secondarySource     = resolver(internalMap)
      )
      ids.map { id =>
        val steps = stepsByPipeline.getOrElse(id, Vector.empty)
        val roots = rootsByPipeline.getOrElse(id, Vector.empty)
        val rootIdOfStep = rootIdsByPipeline.getOrElse(id, Map.empty[PipelineStepId, PipelineRootId])
        // D6: one pipeline's failure omits that item (one WARN naming its id, never step config), not the response.
        project(steps, roots, rootIdOfStep, resolvers)
          .map(item => Option(PipelineContextAnalyzeItem(id.value, item._1, item._2)))
          .recover { case ex =>
            log.warn("context-analyze: omitting pipeline {}: {}", id.value, ex.toString)
            None
          }
      }
    }).flatMap(fs => Future.sequence(fs).map(items => Right(items.flatten): Either[ServiceError, Vector[PipelineContextAnalyzeItem]]))
      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }

  private def project(
      steps:        Vector[PipelineStep],
      roots:        Vector[(PipelineRootId, DataSourceId)],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId],
      resolvers:    PipelineAnalyzeProjection.Resolvers
  ) =
    PipelineAnalyzeProjection.fetch(steps, roots, resolvers).map { fetched =>
      val projected = PipelineAnalyzeProjection.project(steps, rootIdOfStep, fetched, ownerSchemas = None)
      (projected.analyzed.map(toAnalyzeStepResponse), projected.warnings.map(toWarningResponse))
    }

  /** Raw (untrimmed) ids the single read would have looked up as the caller: every root source and every
   *  existing-source upsert target. */
  private def sourceIdsOwned(
      ids:             Vector[PipelineId],
      stepsByPipeline: Map[PipelineId, Vector[PipelineStep]],
      rootsByPipeline: Map[PipelineId, Vector[(PipelineRootId, DataSourceId)]]
  ): Set[String] =
    ids.flatMap { id =>
      rootsByPipeline.getOrElse(id, Vector.empty).map(_._2.value) ++ upsertTargetIds(stepsByPipeline.getOrElse(id, Vector.empty))
    }.toSet

  private def secondarySourceIds(ids: Vector[PipelineId], stepsByPipeline: Map[PipelineId, Vector[PipelineStep]]): Set[String] =
    ids.flatMap(id => stepsByPipeline.getOrElse(id, Vector.empty).flatMap(secondaryIdOf)).toSet

  private def secondaryIdOf(step: PipelineStep): Option[String] =
    Try(PipelineAnalyzeService.secondarySourceIdOf(step.kind, PipelineStepConfigCodec.encode(step))).toOption.flatten

  private def upsertTargetIds(steps: Vector[PipelineStep]): Seq[String] =
    UpsertTargetAnalysis.targetIdsOf(steps.map(s => (s.id.value, s.kind, PipelineStepConfigCodec.encode(s)))).map(_._2)

  /** Only well-formed UUID ids go to the by-id reads (the column compares as uuid, so one malformed id would fail the
   *  whole statement); a malformed id's pipeline fails in [[contextAnalyzeForOwner]]'s resolver instead. */
  private def validIds(raw: Set[String]): Set[DataSourceId] =
    raw.flatMap(r => Try(UUID.fromString(r).toString).toOption).map(DataSourceId(_))
}
