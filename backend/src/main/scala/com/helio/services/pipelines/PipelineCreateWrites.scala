package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.sources.DataSourceService
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, PipelineSummaryResponse}
import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, DataSourceKind}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import org.slf4j.LoggerFactory

import scala.collection.mutable.ArrayBuffer
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** The create path of `PipelineService.create`: request-only root checks, inline-root creation with compensation. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineCreateWrites(
    pipelineRepo: PipelineRepository,
    dataSourceRepo: DataSourceRepository,
    dataSourceService: DataSourceService,
    support: PipelineServiceSupport,
    rootWrites: PipelineRootWrites,
    createTransaction: PipelineCreateTransaction
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  import support.{audit, toSummaryResponse}
  import rootWrites.resolveOneRootSourceId
  import createTransaction.{createTransactional, validateStepCrossOwnerRefs}

  /** `req.steps`/`req.outputs` absent or empty (the pre-existing shape) is unchanged --
   *  a single `pipelineRepo.create` call, exactly as before. HEL-906 task 3.1 (single-call
   *  transactional creation, coordinator ruling D3): when either is non-empty, the pipeline row,
   *  every step (respecting `parentStepId`, resolved against `clientId`s in `req.steps` -- an
   *  unresolvable reference fails the whole call), and every Output (respecting
   *  `nodeStepClientId`, same resolution rule; an invalid `kind`, `DataFieldType.fromString`
   *  rejection, or a `fieldMapping` slot-name violation all fail the whole call) are built inside
   *  ONE Slick transaction (`PipelineRepository.runTransactionally`, `DbContext.withUserContext`
   *  under the hood -- cycle 7's empirical RLS experiment confirmed the composed action runs
   *  correctly under the RLS-enforced app pool, not just the privileged pool cycle 5-6 used) --
   *  a genuine `.transactionally` spanning `PipelineRepository.createAction`/
   *  `PipelineStepRepository.insertInternalAction`/`OutputRepository.insertInternalAction`, not a
   *  create-then-compensate delete for those rows (that was cycle 4's implementation; the coordinator
   *  ruled it out explicitly once the composed `DBIO` action was confirmed to run correctly as one
   *  transaction, and it has been deleted, not patched). HEL-1469's one exception: INLINE ROOT SOURCES
   *  are created by `SourceService`/`DataSourceService` as their own committed writes (with network
   *  I/O after the insert), so they cannot join that transaction; they are created only after every
   *  request-only check has passed and are deleted by [[compensatingInlineSources]] if a later
   *  step fails. A validation failure partway
   *  through is signalled by throwing `PipelineCreateValidationFailure` from inside the composed
   *  `DBIO` chain (`DBIO.failed`) -- Slick's `.transactionally` rolls back the ENTIRE transaction
   *  on any failed action in the chain, so a bad step 3 of 5 genuinely leaves zero rows behind,
   *  not "steps 1-2 committed, then a separate delete." The exception is caught once, after the
   *  transaction completes, and converted back to the `ServiceError` it carries. */
  def create(req: CreatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (req.roots.isEmpty)
      // HEL-913 R8/task 7.1: an empty `roots` array is a hard 400 -- there is no default
      // (design.md decision 11 "no deprecation"), and never a silent single-implicit-root
      // pipeline the way an absent field once was.
      Future.successful(Left(ServiceError.BadRequest("roots must be a non-empty array")))
    else RequestValidation.validateTag(req.tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(tag) =>
        checkedCreate(req, tag, user)
    }
  }

  /** The write ordering of single-call create (HEL-1469). Nothing is written until every check that needs
   *  only the request (plus read-only ownership lookups) has passed: (1) root pass (a) -- root shape and
   *  existing-`sourceId` ownership; (2) transactional path only -- [[PipelineCreatePreflight.run]] and the
   *  ownership half of `validateStepCrossOwnerRefs`; (3) only then are inline root sources created, and from
   *  there every `Left` or failed Future deletes the inline sources this call created
   *  ([[compensatingInlineSources]]). */
  private def checkedCreate(req: CreatePipelineRequest, tag: Option[String], user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    val transactional = req.steps.nonEmpty || req.outputs.nonEmpty
    checkRootsReadOnly(req.roots, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(()) =>
        val preflight: Either[ServiceError, Option[PipelineCreatePreflight.RootIndices]] =
          if (transactional) PipelineCreatePreflight.run(req).map(Some(_)) else Right(None)
        preflight match {
          case Left(err) => Future.successful(Left(err))
          case Right(indices) =>
            val ownership = if (transactional) validateStepCrossOwnerRefs(req.steps, user) else Future.successful(Right(()))
            ownership.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(()) => createWithInlineRoots(req, indices, tag, user)
            }
        }
    }
  }

  /** Root pass (a), read-only and in request order: each root's shape (`sourceId` xor inline `type`, blank id,
   *  inline `name`/config/kind) and, for an existing `sourceId`, caller ownership (404). Writes nothing. */
  private def checkRootsReadOnly(roots: Vector[CreatePipelineRootRequest], user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    roots.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, root) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(()) =>
          rootShapeProblem(root) match {
            case Some(err) => Future.successful(Left(err))
            case None =>
              root.sourceId.map(_.trim) match {
                case Some(sid) =>
                  dataSourceRepo.findByIdOwned(DataSourceId(sid), user).map {
                    case None    => Left(ServiceError.NotFound(s"Data source not found: $sid"))
                    case Some(_) => Right(())
                  }
                case None => Future.successful(Right(()))
              }
          }
      }
    }

  /** The request-only shape errors [[PipelineRootWrites.resolveOneRootSourceId]] would raise, with the same messages and statuses,
   *  so they surface before any sibling root's inline source is created. The null-service check stays at
   *  creation time. */
  private def rootShapeProblem(req: CreatePipelineRootRequest): Option[ServiceError] =
    (req.sourceId.map(_.trim), req.`type`) match {
      case (Some(sid), None) if sid.nonEmpty => None
      case (Some(_), None)  => Some(ServiceError.BadRequest("roots: sourceId is required and must not be blank"))
      case (Some(_), Some(_)) => Some(ServiceError.BadRequest("roots: specify either sourceId or an inline type, not both"))
      case (None, None)     => Some(ServiceError.BadRequest("roots: sourceId or inline type is required"))
      case (None, Some(kind)) =>
        if (req.name.map(_.trim).forall(_.isEmpty)) Some(ServiceError.BadRequest("roots: name is required for an inline source"))
        else {
          val missingConfig = Some(ServiceError.BadRequest("roots: config is required for an inline source"))
          DataSourceKind.canonicalize(kind) match {
            case DataSourceKind.Csv =>
              Some(ServiceError.UnprocessableEntity(
                "inline csv sources are not supported for pipeline roots; create the CSV source separately and reference it via sourceId"
              ))
            case DataSourceKind.Sql     => if (req.sqlConfig.isEmpty) missingConfig else None
            case DataSourceKind.RestApi => if (req.restConfig.isEmpty) missingConfig else None
            case DataSourceKind.Dataset => if (req.staticConfig.isEmpty) missingConfig else None
            case other                  => Some(ServiceError.BadRequest(s"roots: unrecognized inline type '$other'"))
          }
        }
    }

  /** Root pass (b) and everything after it, under [[compensatingInlineSources]]. */
  private def createWithInlineRoots(
      req: CreatePipelineRequest,
      indices: Option[PipelineCreatePreflight.RootIndices],
      tag: Option[String],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    val created = ArrayBuffer.empty[DataSourceId]
    compensatingInlineSources(created, user) {
      createRootSources(req.roots, user, created).flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(dsIds) =>
          indices match {
            case None =>
              // Simple-create path: `pipelineRepo.create` re-checks each id's ownership itself.
              pipelineRepo.create(req.name.trim, dsIds, user, tag).map {
                case Right(summary)                         =>
                  audit("pipeline.create", "pipeline", Some(summary.id), user)
                  Right(toSummaryResponse(summary))
                case Left(msg) if msg.contains("not found") => Left(ServiceError.NotFound(msg))
                case Left(msg)                               => Left(ServiceError.BadRequest(msg))
              }
            case Some(rootIndices) =>
              // The transactional path needs every root's DataSource OBJECT (name/inferredSchema).
              lookupOwnedRoots(dsIds, user).flatMap {
                case Left(err)          => Future.successful(Left(err))
                case Right(dataSources) => createTransactional(req, dataSources, rootIndices, user, tag)
              }
          }
      }
    }
  }

  /** Root pass (b): resolves each root in request order via [[PipelineRootWrites.resolveOneRootSourceId]], recording the id of
   *  every inline source it creates in `created` (sequential, so no synchronization is needed). */
  private def createRootSources(
      roots: Vector[CreatePipelineRootRequest],
      user: AuthenticatedUser,
      created: ArrayBuffer[DataSourceId]
  ): Future[Either[ServiceError, Vector[DataSourceId]]] =
    roots.foldLeft(Future.successful[Either[ServiceError, Vector[DataSourceId]]](Right(Vector.empty))) { (accF, root) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(acc) =>
          resolveOneRootSourceId(root, user).map(_.map { dsId =>
            if (root.`type`.isDefined) created += dsId
            acc :+ dsId
          })
      }
    }

  private def lookupOwnedRoots(dsIds: Vector[DataSourceId], user: AuthenticatedUser): Future[Either[ServiceError, Vector[(DataSourceId, DataSource)]]] =
    dsIds.foldLeft(Future.successful[Either[ServiceError, Vector[(DataSourceId, DataSource)]]](Right(Vector.empty))) { (accF, dsId) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(acc) =>
          dataSourceRepo.findByIdOwned(dsId, user).map {
            case None     => Left(ServiceError.NotFound(s"Data source not found: ${dsId.value}"))
            case Some(ds) => Right(acc :+ ((dsId, ds)))
          }
      }
    }

  /** HEL-1469: inline root sources are created by `SourceService`/`DataSourceService` as their own committed
   *  writes, outside the pipeline's Slick transaction, so a failure after creation cannot roll them back. On a
   *  `Left` or a failed Future from `body`, delete every id in `created` (through `DataSourceService.delete`,
   *  as the user -- C3) BEFORE returning the ORIGINAL `Left` or re-raising the ORIGINAL exception. A cleanup
   *  failure is logged and never replaces the original error. Not crash-atomic: a process death between
   *  creation and the delete leaves the source behind (see design.md Risks). */
  private def compensatingInlineSources[T](
      created: ArrayBuffer[DataSourceId],
      user: AuthenticatedUser
  )(body: => Future[Either[ServiceError, T]]): Future[Either[ServiceError, T]] =
    Future.unit.flatMap(_ => body).transformWith {
      case Success(right @ Right(_)) => Future.successful(right)
      case Success(left)             => deleteInlineSources(created.toVector, user).map(_ => left)
      case Failure(ex)               => deleteInlineSources(created.toVector, user).flatMap(_ => Future.failed(ex))
    }

  private def deleteInlineSources(ids: Vector[DataSourceId], user: AuthenticatedUser): Future[Unit] =
    ids.foldLeft(Future.unit) { (accF, id) =>
      accF.flatMap { _ =>
        Future.unit.flatMap(_ => dataSourceService.delete(id, user)).map {
          case Left(e)  => log.warn(s"create cleanup could not delete inline source ${id.value}: ${e.err.message}")
          case Right(_) => ()
        }.recover { case ex => log.warn(s"create cleanup failed to delete inline source ${id.value}: ${ex.getMessage}") }
      }
    }
}
