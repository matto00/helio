package com.helio.services.pipelines

import com.helio.domain.model.{PipelineId, PipelineRunId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository.{RunNoLongerOpen, RunState}
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal
import scala.util.{Failure, Success}

/** HEL-1564 (owner ruling): once a real run's own `succeeded` terminal write has won, a later delete of its pipeline must
 *  not change the answer. Wraps the unblocked success chain ([[PipelineRunSucceededWrites]]) and decides, when that chain
 *  fails, from two facts only: did the run's OWN terminal write win, and does the pipeline still exist (privileged,
 *  read-only lookup of the id `submit` already authorized -- the same pattern `lateFinisher` uses).
 *
 *  - won AND pipeline gone: the failure is the delete's (a node guard seeing the run Missing, or an un-guarded
 *    post-fold write such as a binary reference hitting a foreign key) -> recover to success. Remaining writes were
 *    skipped, never re-created.
 *  - lost AND pipeline gone AND the failure is not already [[RunNoLongerOpen]] (HEL-1518 D7, mirror image): re-fail as
 *    `RunNoLongerOpen(Missing)`, so the lost write answers 404 and publishes nothing.
 *  - anything else (pipeline still exists, the terminal write itself failed, ...): the ORIGINAL failure propagates.
 *
 *  Sibling eager writes are awaited (outcome ignored) before the answer, on both recovering paths, so `succeeded` is
 *  still published only after the chain's writes settled (HEL-1366). Accepted limit: existence is checked when the
 *  recovery runs, so an unrelated failure on a live pipeline deleted just before that check also recovers -- the run's
 *  write had won and the pipeline is gone, which is exactly the ruling's state. */
private[pipelines] final class PipelineRunDeletedRecovery(pipelineRepo: PipelineRepository)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])

  def recover(
      pipelineId: PipelineId, runId: PipelineRunId, chain: Future[Option[String]], won: Future[Boolean], siblings: Seq[Future[Any]]
  ): Future[Option[String]] =
    chain.recoverWith {
      case NonFatal(original) =>
        settle(siblings).flatMap(_ =>
          won.transformWith {
            case Failure(_)     => Future.failed(original)
            case Success(isWon) =>
              pipelineRepo.findByIdInternal(pipelineId).transformWith {
                case Success(None) if isWon =>
                  log.warn(s"HEL-1564: pipeline ${pipelineId.value} was deleted after run ${runId.value}'s succeeded write won; " +
                    s"kept the outcome as success and skipped the remaining writes (${original.getClass.getSimpleName}: ${original.getMessage})")
                  Future.successful(None)
                case Success(None) =>
                  original match {
                    case _: RunNoLongerOpen => Future.failed(original)
                    case _                  => Future.failed(RunNoLongerOpen(RunState.Missing))
                  }
                case _ => Future.failed(original)
              }
          }
        )
    }

  private def settle(fs: Seq[Future[Any]]): Future[Unit] =
    Future.sequence(fs.map(_.transform(_ => Success(())))).map(_ => ())
}
