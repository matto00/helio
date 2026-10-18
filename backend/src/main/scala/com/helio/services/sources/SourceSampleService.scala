package com.helio.services.sources

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.api.protocols.sources.SourceSampleResponse
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.{InProcessPipelineEngine, PipelineAnalyzeService}
import com.helio.domain.model._
import com.helio.domain.util.{Clock, SystemClock}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import com.helio.services.ServiceError
import org.apache.pekko.actor.typed.ActorSystem
import org.slf4j.LoggerFactory

import java.net.InetAddress
import java.nio.file.NoSuchFileException
import java.time.temporal.ChronoUnit
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try
import scala.util.control.NonFatal

/** HEL-1628: serves `GET /api/data-sources/:id/sample`, the engine-loaded head (at most
 *  [[SourceSampleService.SampleMax]] rows) of one source, for the client's draft-preview evaluator.
 *
 *  It owns its own [[InProcessPipelineEngine]] built from the same `fileSystem`, `connector`, URL-fetch seam
 *  ([[SourceUrlFetch.seam]]) and SQL host guards that `PipelineRunService` receives, and calls
 *  `loadRowsWithStats` directly -- never `PipelineRunService` -- so the pipeline-run guard (rate window,
 *  concurrency cap, `pipeline_runs`) is structurally unreachable: a sample is not a run.
 *
 *  Access (HEL-1648), in order: the source's owner (`findByIdOwned`, caller's RLS context) is served as before and
 *  any `pipelineId` is ignored. Otherwise, with a `pipelineId`, the caller must hold a grant on that pipeline that
 *  `findByIdShared` proves under the caller's RLS, must be its owner or an `editor` grantee (a `viewer` is refused),
 *  and the pipeline must USE the source: a root, or a join/union/lookup secondary of any step (enabled or not --
 *  an editor can enable a step). Only then is the source read privileged (`findByIdInternal`). EVERY denial,
 *  including a missing, empty, unknown or malformed `pipelineId`, is the one `NotFound` an unknown source id gets,
 *  and logs nothing, so the endpoint is no existence oracle for sources or pipelines. There is deliberately no
 *  "same owner" test on the source: "P uses S" is the rule, and it relies on every step-write path checking a
 *  secondary source's ownership with the WRITER's identity (`StepReferenceChecks.secondarySourceOwnershipF`), so a
 *  foreign source can only be in P because its owner (or P's owner for their own) put it there.
 *
 *  Only after access is established does the engine read, with `ConnectorResolveContext.Internal`, exactly
 *  as an admitted run does, so credential handling is the run path's, unchanged. Nothing here logs rows,
 *  cell values, configs or credentials. */
final class SourceSampleService(
    dataSourceRepo: DataSourceRepository,
    fileSystem: FileSystem,
    connector: RestApiConnectorDriver,
    system: ActorSystem[_],
    resolveHost: String => Try[Array[InetAddress]],
    isBlocked: (String, InetAddress) => Boolean,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    clock: Clock = SystemClock
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val engine = new InProcessPipelineEngine(
    fileSystem,
    connector,
    SourceUrlFetch.seam(system, resolveHost, isBlocked),
    resolveHost,
    isBlocked
  )

  private val notFound = Left(ServiceError.NotFound("Data source not found"))

  /** The caller's RLS ownership check first; failing that, the HEL-1648 pipeline-scoped grant path. */
  private def authorized(id: DataSourceId, user: AuthenticatedUser, pipelineId: Option[PipelineId]): Future[Option[DataSource]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case some @ Some(_) => Future.successful(some)
      case None =>
        pipelineId match {
          case Some(pid) => authorizedViaPipeline(id, pid, user)
          case None      => Future.successful(None)
        }
    }

  private def authorizedViaPipeline(id: DataSourceId, pid: PipelineId, user: AuthenticatedUser): Future[Option[DataSource]] =
    pipelineRepo.findByIdShared(pid, Some(user)).flatMap {
      case None => Future.successful(None)
      case Some(pipeline) =>
        val mayRead: Future[Boolean] =
          if (pipeline.ownerId.value == user.id.value) Future.successful(true)
          else pipelineRepo.findGrantRole(pid, user).map(_.contains("editor"))
        mayRead.flatMap {
          case false => Future.successful(None)
          case true =>
            pipelineUses(pid, id).flatMap {
              // ACL bypass is safe here: the caller's grant on `pid` was proved under their own RLS
              // (`findByIdShared`), they are its owner or an editor, and `pid` uses this very source.
              case true  => dataSourceRepo.findByIdInternal(id)
              case false => Future.successful(None)
            }
        }
    }

  /** Whether `pid` has `id` as a root or as a join/union/lookup secondary of any of its steps. A step whose config
   *  cannot be encoded or decoded counts as no use (fail closed). */
  private def pipelineUses(pid: PipelineId, id: DataSourceId): Future[Boolean] =
    pipelineRepo.listRootDataSourceIdsInternal(pid).flatMap { roots =>
      if (roots.exists(_._2 == id)) Future.successful(true)
      else
        pipelineStepRepo
          .listByPipelineInternal(pid)
          .map(_.exists { s =>
            Try(PipelineStepConfigCodec.encode(s)).toOption
              .flatMap(config => PipelineAnalyzeService.secondarySourceIdOf(s.kind, config))
              .contains(id.value)
          })
          // A step whose stored config cannot be decoded makes the listing fail with IllegalStateException: "no use", never a
          // 500. Any other (e.g. DB) failure propagates as a 5xx: it runs after the grant proof and is not data-dependent, so it is no oracle.
          .recover { case _: IllegalStateException => false }
    }

  def sample(
      id: DataSourceId,
      user: AuthenticatedUser,
      pipelineId: Option[PipelineId] = None
  ): Future[Either[ServiceError, SourceSampleResponse]] =
    authorized(id, user, pipelineId).flatMap {
      case None                  => Future.successful(notFound)
      case Some(_: ImageSource)  =>
        Future.successful(Left(ServiceError.BadRequest("Image sources cannot be sampled")))
      case Some(ds) =>
        engine
          .loadRowsWithStats(ds, dataSourceRepo)
          .map { case (rows, stats) =>
            val capturedAt = clock.now().truncatedTo(ChronoUnit.MILLIS)
            val head       = rows.take(SourceSampleService.SampleMax)
            val (truncated, count) =
              if (stats.truncated) (true, stats.availableRowCount)
              else (rows.size > SourceSampleService.SampleMax, Some(rows.size.toLong))
            Right(
              SourceSampleResponse(
                rows = head.map(SampleRowJson.encode).toVector,
                capturedAt = capturedAt.toString,
                sourceRowCount = count,
                truncated = truncated,
                live = SourceSampleService.isLive(ds)
              )
            ): Either[ServiceError, SourceSampleResponse]
          }
          .recover {
            case _: NoSuchFileException =>
              Left(ServiceError.NotFound("Data file not found; the source may need to be re-uploaded"))
            case e: IllegalArgumentException if e.getClass == classOf[IllegalArgumentException] =>
              // The engine's curated failures: source name/id and the reason, never rows or credentials.
              Left(ServiceError.BadGateway(e.getMessage))
            case e: SampleRowJson.UnsupportedValue =>
              log.error(s"Source sample encoding failed for data source ${id.value}: ${e.getMessage}")
              Left(ServiceError.InternalError("Failed to encode source sample"))
            case NonFatal(e) =>
              log.warn(s"Source sample read failed for data source ${id.value}: ${e.getClass.getName}")
              Left(ServiceError.BadGateway("Failed to read source"))
          }
    }
}

object SourceSampleService {

  /** Rows returned, at most (owner ruling D, `head-1000-manual-refresh`). Equal to the engine's run cap. */
  val SampleMax: Int = 1000

  /** A pipeline id worth a lookup: non-blank, bounded, and free of control characters (a NUL would make Postgres
   *  raise instead of simply matching nothing). Anything else is the same 404 as an unknown pipeline. */
  def isPlausiblePipelineId(raw: String): Boolean =
    raw.nonEmpty && raw.length <= 128 && !raw.exists(c => Character.isISOControl(c) || c.isWhitespace)

  /** A non-static source: re-reads a live system on every sample (`rest_api`, `sql`, any URL-backed file kind). */
  def isLive(ds: DataSource): Boolean = ds match {
    case _: RestSource => true
    case _: SqlSource  => true
    case c: CsvSource  => c.config.sourceUrl.isDefined
    case t: TextSource => t.config.sourceUrl.isDefined
    case p: PdfSource  => p.config.sourceUrl.isDefined
    case _             => false
  }
}
