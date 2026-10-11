package com.helio.services.sources

import com.helio.api.protocols.pipelines.CreatePipelineRootRequest
import com.helio.domain.model.{AuthenticatedUser, ConnectorId, DataSourceId, DataSourceKind, RestSource}
import com.helio.services.ServiceError
import com.helio.infrastructure.persistence.sources.{ConnectorHasDependents, ConnectorRepository, DataSourceRepository}
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}

/** Deletes the implicit "Auto: <source name>" Connector that `SourceService.createRest` synthesizes for a bare-`url`
 *  REST source (HEL-822), once the source it was made for is gone. Two independent safeguards keep it from ever
 *  deleting a Connector it did not create: the name must be exactly `Auto: <source name>`, and the delete goes
 *  through the dependents-guarded `ConnectorRepository.delete` with the REAL referencing-source count (never the
 *  repository's always-zero default), so a Connector another source still references is refused and kept.
 *
 *  Never throws: every failure is logged (ids and the error message only) and reported as `false`, so a cleanup
 *  can never replace the error that triggered it. A deliberate keep (name mismatch, still referenced, already gone)
 *  is not a failure and reports `true`. */
private[services] final class ImplicitConnectorCleanup(
    dataSourceRepo: DataSourceRepository,
    connectorRepo: ConnectorRepository
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[ImplicitConnectorCleanup])

  def deleteIfAuto(connectorId: ConnectorId, sourceName: String, user: AuthenticatedUser, context: String): Future[Boolean] =
    Future.unit.flatMap(_ => connectorRepo.findByIdOwned(connectorId, user)).flatMap {
      case None => Future.successful(true)
      case Some(connector) if connector.name != ImplicitConnectorCleanup.autoName(sourceName) =>
        log.warn(s"$context kept connector ${connectorId.value}: its name is not the implicit-Connector name for the deleted source")
        Future.successful(true)
      case Some(_) =>
        connectorRepo.delete(connectorId, user, id => dataSourceRepo.countRestSourcesReferencing(id)).map {
          case Right(_) => true
          case Left(ConnectorHasDependents) =>
            log.info(s"$context kept connector ${connectorId.value}: another source still references it")
            true
        }
    }.recover { case ex =>
      log.warn(s"$context failed to delete implicit connector ${connectorId.value}: ${ex.getMessage}")
      false
    }
}

private[services] object ImplicitConnectorCleanup {
  def autoName(sourceName: String): String = s"Auto: $sourceName"
}

/** The shared "delete what this call created" step for an inline pipeline-root source (HEL-1475): deletes the source
 *  through `DataSourceService.delete` as the user (RLS and the HEL-989 reference check preserved) and, when the
 *  caller says the root was a bare-`url` REST root, then the implicit Connector that creation synthesized.
 *
 *  `implicitConnector` is decided by the CALLER from the request shape alone (a `rest_api` root with `url` and no
 *  `connectorId`, which always makes `createRest` synthesize a new Connector), so a request that named its own
 *  `connectorId` can never get that Connector deleted here. The source is read before it is deleted, because its
 *  config is the only place the Connector id is recorded; the Connector is deleted only after the source is gone,
 *  since the dependents guard would refuse while the source still references it.
 *
 *  NOT crash-atomic: the source delete and the Connector delete are separate commits, and the whole step runs after
 *  the creation committed. A process death between creation and cleanup (or between the two deletes) leaves the
 *  source and/or Connector behind. Closing that would need one transaction spanning creation (with network I/O after
 *  the insert) and cleanup, which HEL-1469 rejected for the same reasons.
 *
 *  Never throws and returns `true` only if every delete it attempted succeeded. */
private[services] final class InlineSourceCleanup(
    dataSourceRepo: DataSourceRepository,
    dataSourceService: DataSourceService,
    connectorRepo: ConnectorRepository
)(implicit ec: ExecutionContext) {

  private val log              = LoggerFactory.getLogger(classOf[InlineSourceCleanup])
  private val connectorCleanup = if (connectorRepo == null) null else new ImplicitConnectorCleanup(dataSourceRepo, connectorRepo)

  def deleteCallCreated(id: DataSourceId, implicitConnector: Boolean, user: AuthenticatedUser, context: String): Future[Boolean] =
    captureImplicitConnector(id, implicitConnector, user, context).flatMap { captured =>
      Future.unit.flatMap(_ => dataSourceService.delete(id, user)).flatMap {
        case Left(e) =>
          log.warn(s"$context could not delete inline source ${id.value}: ${e.err.message}")
          Future.successful(false)
        case Right(_) =>
          captured match {
            case Some((connectorId, sourceName)) => connectorCleanup.deleteIfAuto(connectorId, sourceName, user, context)
            case None                            => Future.successful(true)
          }
      }.recover { case ex =>
        log.warn(s"$context failed to delete inline source ${id.value}: ${ex.getMessage}")
        false
      }
    }

  /** Undo of an applied pipeline create (HEL-1493): removes the source the apply created if nothing references it, then
   *  its implicit Connector, and says which of the four things happened. The reference guard is
   *  `DataSourceService.delete`'s own 409, so a source bound to anything since the apply is kept. A Connector that
   *  cannot be deleted is logged and does not undo the source's removal. Never throws. */
  def deleteIfUnreferenced(id: DataSourceId, implicitConnector: Boolean, user: AuthenticatedUser, context: String): Future[InlineSourceDeleteResult] = {
    val outcome = Future.unit.flatMap(_ => dataSourceRepo.findByIdOwned(id, user)).flatMap {
      case None => Future.successful(InlineSourceDeleteResult.AlreadyGone)
      case Some(source) =>
        val name = Some(source.name)
        val captured: Option[(ConnectorId, String)] = source match {
          case r: RestSource if implicitConnector && connectorCleanup != null => Some((ConnectorId(r.config.connectorId), r.name))
          case _                                                              => None
        }
        if (implicitConnector && connectorCleanup == null)
          log.warn(s"$context cannot delete the implicit connector of source ${id.value}: no connector repository configured")
        dataSourceService.delete(id, user).flatMap {
          case Left(e) =>
            e.conflict match {
              case Some(conflict) => Future.successful(InlineSourceDeleteResult.KeptReferenced(name, InlineSourceCleanup.inUseReason(conflict)))
              case None if e.err.isInstanceOf[ServiceError.NotFound] => Future.successful(InlineSourceDeleteResult.AlreadyGone)
              case None =>
                log.warn(s"$context could not delete inline source ${id.value}: ${e.err.message}")
                Future.successful(InlineSourceDeleteResult.Failed(name))
            }
          case Right(_) =>
            val connectorStep = captured match {
              case Some((connectorId, sourceName)) => connectorCleanup.deleteIfAuto(connectorId, sourceName, user, context)
              case None                            => Future.successful(true)
            }
            connectorStep.map(_ => InlineSourceDeleteResult.Removed(name))
        }.recover { case ex =>
          log.warn(s"$context failed to delete inline source ${id.value}: ${ex.getMessage}")
          InlineSourceDeleteResult.Failed(name)
        }
    }
    outcome.recover { case ex =>
      log.warn(s"$context failed to delete inline source ${id.value}: ${ex.getMessage}")
      InlineSourceDeleteResult.Failed(None)
    }
  }

  private def captureImplicitConnector(id: DataSourceId, implicitConnector: Boolean, user: AuthenticatedUser, context: String): Future[Option[(ConnectorId, String)]] =
    if (!implicitConnector) Future.successful(None)
    else if (connectorCleanup == null) {
      log.warn(s"$context cannot delete the implicit connector of source ${id.value}: no connector repository configured")
      Future.successful(None)
    } else
      Future.unit.flatMap(_ => dataSourceRepo.findByIdOwned(id, user)).map {
        case Some(r: RestSource) => Some((ConnectorId(r.config.connectorId), r.name))
        case _                   => None
      }.recover { case ex =>
        log.warn(s"$context could not read source ${id.value} to find its implicit connector: ${ex.getMessage}")
        None
      }
}

/** What [[InlineSourceCleanup.deleteIfUnreferenced]] did. `name` is the source's name when it could be read first. */
private[services] sealed trait InlineSourceDeleteResult

private[services] object InlineSourceDeleteResult {
  final case class Removed(name: Option[String])                       extends InlineSourceDeleteResult
  /** Kept because something still references it; `reason` is UI-safe text built by [[InlineSourceCleanup.inUseReason]]. */
  final case class KeptReferenced(name: Option[String], reason: String) extends InlineSourceDeleteResult
  case object AlreadyGone                                              extends InlineSourceDeleteResult
  final case class Failed(name: Option[String])                        extends InlineSourceDeleteResult
}

private[services] object InlineSourceCleanup {

  /** Most referencers named in a [[inUseReason]]; the rest are summed into "N more". */
  private val MaxNamedReferencers = 3

  /** UI-safe text for a source kept because it is still referenced (HEL-1493): the visible referencers by name, the
   *  ones the caller cannot see as counts only (HEL-1252), no id, and none of the delete flow's "remove each
   *  reference first" advice, which would tell the user to dismantle what they built since the apply. The 409's own
   *  `reason` is agent-oriented and is deliberately not reused. */
  def inUseReason(conflict: DataSourceDeleteConflict): String = {
    val named  = conflict.pipelines.map(p => s"""pipeline "${p.name}"""") ++ conflict.panels.map(p => s"""form panel "${p.title}"""")
    val hidden = conflict.hiddenPipelineCount + conflict.hiddenPanelCount
    val shown  = named.take(MaxNamedReferencers)
    val more   = named.size - shown.size
    val parts  = shown ++ (if (more > 0) Vector(s"$more more") else Vector.empty) ++
      (if (hidden > 0) Vector(s"$hidden you cannot access") else Vector.empty)
    if (parts.isEmpty) "still in use." else s"still used by ${parts.mkString(", ")}."
  }

  /** True for an inline `rest_api` root given as a bare `url` with no `connectorId`: the one request shape for which
   *  `SourceService.createRest` always synthesizes a new implicit Connector. */
  def isImplicitConnectorRoot(root: CreatePipelineRootRequest): Boolean =
    root.`type`.exists(kind => DataSourceKind.canonicalize(kind) == DataSourceKind.RestApi) &&
      root.restConfig.exists(cfg => cfg.url.isDefined && cfg.connectorId.isEmpty)
}
