package com.helio.services.sources

import com.helio.api.protocols.sources.SourceSampleResponse
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model._
import com.helio.domain.util.{Clock, SystemClock}
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
 *  Access is owner-only (`findByIdOwned`, caller's RLS context), the same check as the source preview routes.
 *  Only after ownership is established does the engine read, with `ConnectorResolveContext.Internal`, exactly
 *  as an admitted run does, so credential handling is the run path's, unchanged. Nothing here logs rows,
 *  cell values, configs or credentials. */
final class SourceSampleService(
    dataSourceRepo: DataSourceRepository,
    fileSystem: FileSystem,
    connector: RestApiConnectorDriver,
    system: ActorSystem[_],
    resolveHost: String => Try[Array[InetAddress]],
    isBlocked: (String, InetAddress) => Boolean,
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

  def sample(id: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, SourceSampleResponse]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case None                  => Future.successful(Left(ServiceError.NotFound("Data source not found")))
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
