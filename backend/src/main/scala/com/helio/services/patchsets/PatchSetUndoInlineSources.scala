package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.InlineSourceUndoOutcome
import com.helio.domain.model.{AuthenticatedUser, DataSourceId}
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledInlineSource
import com.helio.services.sources.{InlineSourceCleanup, InlineSourceDeleteResult}
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** The inline-source half of undoing a `pipeline` `create` (HEL-1493, owner option B): after the pipeline is gone,
 *  each inline root source the apply journaled is removed if nothing references it, and reported either way. Sources
 *  are handled one after another. Never throws: every failure becomes a `kept` entry with a fixed reason. */
private[services] object PatchSetUndoInlineSources {

  /** The `reason` of a `kept` entry whose removal failed for any cause other than a reference conflict. A reason never
   *  carries an exception message, an id or SQL text. */
  val ReasonFailed: String = "The data source could not be removed."

  /** The `reason` of a `kept` entry when no source-cleanup helper is wired, so nothing was attempted. */
  val ReasonUnavailable: String = "The data source was not removed: source cleanup is unavailable."

  private val log = LoggerFactory.getLogger(getClass)

  def cleanup(
      sources: Vector[JournaledInlineSource],
      helper: InlineSourceCleanup,
      user: AuthenticatedUser,
      context: String
  )(implicit ec: ExecutionContext): Future[Vector[InlineSourceUndoOutcome]] = {
    if (helper == null && sources.nonEmpty)
      log.warn(s"$context kept ${sources.size} inline source(s): no inline-source cleanup is wired")
    sources.foldLeft(Future.successful(Vector.empty[InlineSourceUndoOutcome])) { (accF, source) =>
      accF.flatMap(acc => removeOne(source, helper, user, context).map(acc :+ _))
    }
  }

  private def removeOne(source: JournaledInlineSource, helper: InlineSourceCleanup, user: AuthenticatedUser, context: String)(implicit ec: ExecutionContext): Future[InlineSourceUndoOutcome] =
    if (helper == null) Future.successful(kept(source.id, None, ReasonUnavailable))
    else
      Future.unit.flatMap(_ => helper.deleteIfUnreferenced(DataSourceId(source.id), source.implicitConnector, user, context))
        .map(result => toOutcome(source.id, result))
        .recover { case NonFatal(ex) =>
          log.warn(s"$context failed to remove inline source ${source.id}: ${ex.getMessage}")
          kept(source.id, None, ReasonFailed)
        }

  private[patchsets] def toOutcome(id: String, result: InlineSourceDeleteResult): InlineSourceUndoOutcome = result match {
    case InlineSourceDeleteResult.Removed(name)                => InlineSourceUndoOutcome(id, name, "removed", None)
    case InlineSourceDeleteResult.AlreadyGone                  => InlineSourceUndoOutcome(id, None, "alreadyGone", None)
    case InlineSourceDeleteResult.KeptReferenced(name, reason) => kept(id, name, reason)
    case InlineSourceDeleteResult.Failed(name)                 => kept(id, name, ReasonFailed)
  }

  private def kept(id: String, name: Option[String], reason: String): InlineSourceUndoOutcome =
    InlineSourceUndoOutcome(id, name, "kept", Some(reason))
}
