package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.ServiceError.StaleTarget
import com.helio.services.auth.AccessChecker
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.{OutputService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.patchsets.{EditOutcome, PatchSet, PatchSetApplyResponse}
import com.helio.domain.panels.PanelConfigCodec
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, OutputId, PatchSetApplicationId, PipelineId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.sources.SourceService
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import PatchSetApplicationRepository.{JournaledCreatedChildren, JournaledCreatedDataset, JournaledEdit, JournaledInlineSource, PatchSetApplicationRecord}
import org.slf4j.LoggerFactory
import spray.json.{JsValue, JsonParser}

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try
import scala.util.control.NonFatal

/** Applies a reviewed `PatchSet` (HEL-403's schema/protocol) atomically — N
 *  targeted edits (update/delete/create) across EXISTING resources either
 *  all succeed or none do (ticket.md). The mutation analogue of
 *  `DashboardProposalService`/`PipelineProposalService`'s compose-existing-
 *  services-then-rollback-on-failure shape, extended to `update`/`delete`
 *  edits that mutate resources predating this call (design.md Context).
 *
 *  Two phases, no direct repository writes anywhere in this ticket:
 *
 *   1. Pre-validation ([[PatchSetApplyResolvers]], design.md D2/D2a) —
 *      every edit's target, AND any embedded cross-resource reference inside
 *      its `patch`/`createPatch`, is authorized and decoded BEFORE any
 *      mutation, using each kind's REAL per-op access rule (not merely a
 *      same-named repo lookup). A single failure here fails the whole call;
 *      nothing changes (ticket.md AC2).
 *   2. Forward-apply ([[PatchSetApplyForward]], design.md D1) in the
 *      caller's given order, via the matching EXISTING per-resource service
 *      method only. On a mid-set failure, the edits already applied are
 *      compensated in reverse order ([[PatchSetApplyRollback]], design.md
 *      D3/D3a) and the response reports each edit's outcome honestly —
 *      never silently overclaiming a rollback that couldn't fully restore
 *      the resource (design.md D1's "unrecoverable"/"recreated" tiers). */
// HEL-904 task 3.3: `dataTypeService` REMOVED outright -- `dataType` is no
// longer a valid target.kind, so forward-apply/rollback never invoke it.
final class PatchSetApplyService(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    accessChecker: AccessChecker,
    // HEL-413 design.md D2: journals a successful (no `failure`) apply so a
    // later `PatchSetUndoService.undo` can restore it. Written synchronously,
    // inside this class's own terminal success branch — never fire-and-forget,
    // since the response's `applicationId` field depends on it.
    applicationRepo: PatchSetApplicationRepository,
    // HEL-1239: required (no `= null` default) -- see `PatchSetApplyContext.outputRepo`.
    outputRepo: OutputRepository,
    outputService: OutputService = null,
    // HEL-1638 D1b: resolves an inline rest/sql pipeline-create root's schema for the create dry run (never charged here).
    sourceService: SourceService = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private[services] val context: PatchSetApplyContext =
    PatchSetApplyContext.buildUncharged(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, accessChecker, outputRepo, sourceService)

  private val services: PatchSetApplyServices =
    PatchSetApplyServices(panelService, dashboardService, dataSourceService, pipelineService, outputService)

  def apply(patchSet: PatchSet, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetApplyResponse]] =
    patchSet.proposalId.filterNot(isUuid) match {
      case Some(_) => Future.successful(Left(ServiceError.BadRequest("proposalId must be a UUID")))
      case None =>
        PatchSetApplyResolvers.resolveAll(patchSet.edits, user, context).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(resolved) =>
            // HEL-1458: after authorization (a 403/404 wins, so a fingerprint never reveals existence) and before any write.
            staleTargets(patchSet, resolved, user).flatMap {
              case stale if stale.nonEmpty => Future.successful(Left(PatchSetStaleMessage.error(stale)))
              case _                       => PatchSetApplyOnce.run(applicationRepo, patchSet.proposalId, user)(applyResolved(resolved, user))
            }
        }
    }

  private def isUuid(value: String): Boolean = Try(UUID.fromString(value)).isSuccess

  /** Every edit whose supplied fingerprint no longer matches its target's current editable state; edits that
   *  supplied none are not checked. */
  private def staleTargets(patchSet: PatchSet, resolved: Vector[ResolvedEdit], user: AuthenticatedUser): Future[Vector[StaleTarget]] =
    Future.sequence(resolved.zip(patchSet.edits).collect { case (edit, original) if original.target.fingerprint.isDefined =>
      PatchSetTargetFingerprint.forEdit(edit, user, context).map { current =>
        if (current == original.target.fingerprint) None
        else Some(StaleTarget(edit.index, edit.kind, original.target.id.getOrElse("")))
      }
    }).map(_.flatten)

  /** Applies every resolved edit in order, short-circuiting the walk (not
   *  the whole call) on the first failure so [[PatchSetApplyRollback]] can
   *  compensate exactly the edits that already succeeded. Unlike
   *  pre-validation's failure (a plain `Left(ServiceError)`, mapped to an
   *  HTTP error status by the route), a MID-SET failure still returns
   *  `Right` — the request's atomicity guarantee was honored (nothing was
   *  left partially applied) even though the caller's requested changes
   *  didn't take effect, so the caller gets a normal response body
   *  reporting exactly what was rolled back and why (design.md D4).
   *
   *  Alongside `applied` (unchanged — the exact 2-tuple shape
   *  `PatchSetApplyRollback.rollback`'s failure-path call already expects,
   *  never widened), the loop also builds a SEPARATE, `edit.index`-keyed
   *  `rawConfigs` accumulator (design.md D2a) — populated only for a panel
   *  `update` edit's just-persisted raw config, via one bare
   *  `panelRepo.findByIdInternal` fetch right after that edit's `applyOne`
   *  call succeeds. Only the terminal SUCCESS branch reads it, to journal
   *  the application (design.md D2); the failure path never touches it. */
  private def applyResolved(
      resolved: Vector[ResolvedEdit],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PatchSetApplyResponse]] = {
    // HEL-1796: what each `dataSource` create made, keyed by edit index (written once per edit, read at journaling).
    val createdDatasets = new ConcurrentHashMap[Int, JournaledCreatedDataset]()
    def loop(
        remaining: Vector[ResolvedEdit],
        applied: Vector[(ResolvedEdit, EditOutcome)],
        rawConfigs: Map[Int, JsValue],
        createdByRef: Map[String, String],
        children: Map[Int, JournaledCreatedChildren]
    ): Future[Either[(ServiceError, Vector[(ResolvedEdit, EditOutcome)]), (Vector[(ResolvedEdit, EditOutcome)], Map[Int, JsValue], Map[Int, JournaledCreatedChildren])]] =
      remaining.headOption match {
        case None => Future.successful(Right((applied, rawConfigs, children)))
        case Some(declared) =>
          // HEL-1639 D2: a panel create bound by `$ref` gets the real id of the Output an earlier edit just created.
          PatchSetRefs.substitute(declared, createdByRef) match {
            case Left(err) => Future.successful(Left((err, applied)))
            case Right(edit) =>
              PatchSetApplyForward.applyOne(edit, user, services).flatMap {
                case Left(err) => Future.successful(Left((err, applied)))
                case Right(outcome) =>
                  for {
                    rawConfigOpt <- captureRawPanelConfig(edit)
                    childrenOpt  <- captureCreatedChildren(edit, outcome)
                    datasetOpt   <- captureCreatedDataset(edit, outcome, user)
                    next <- {
                      datasetOpt.foreach(d => createdDatasets.put(edit.index, d))
                      val nextChildren   = childrenOpt.fold(children)(c => children + (edit.index -> c))
                      val nextRawConfigs = rawConfigOpt.fold(rawConfigs)(json => rawConfigs + (edit.index -> json))
                      val nextCreated = (edit.ref, edit.action, outcome.newId) match {
                        case (Some(ref), _: ResolvedAction.OutputCreate, Some(id)) => createdByRef + (ref -> id)
                        case _                                                      => createdByRef
                      }
                      loop(remaining.tail, applied :+ (edit -> outcome), nextRawConfigs, nextCreated, nextChildren)
                    }
                  } yield next
              }
          }
      }

    loop(resolved, Vector.empty, Map.empty, Map.empty, Map.empty).flatMap {
      case Right((appliedAll, rawConfigs, children)) =>
        // HEL-1639 D2: created Outputs are backfilled only now that the whole set has applied, so a rolled-back set
        // never triggers one.
        if (services.outputService != null)
          services.outputService.backfillCreated(
            appliedAll.collect { case (e, o) if e.action.isInstanceOf[ResolvedAction.OutputCreate] => o.newId }.flatten.map(OutputId(_)),
            user
          )
        journalSuccess(appliedAll, rawConfigs, children, createdDatasets, user).map { applicationId =>
          Right(PatchSetApplyResponse(appliedAll.map(_._2), failure = None, applicationId = Some(applicationId)))
        }
      case Left((err, appliedSoFar)) =>
        PatchSetApplyRollback.rollback(appliedSoFar, user, services).map { rolledBack =>
          Right(PatchSetApplyResponse(rolledBack, failure = Some(err.message), applicationId = None))
        }
    }
  }

  /** design.md D2a: a panel `update` edit's forward apply already persisted
   *  the RAW config (`PanelPatchApplier.apply`'s `panelRepo.replace`, ahead
   *  of `resolveSingleBinding`'s materialization) — this re-reads that SAME
   *  row via `findByIdInternal`, the identical unmaterialized path
   *  `priorState` already uses, so the captured snapshot is genuinely raw
   *  even for a bound `MetricPanel`. A `create` edit needs no fetch
   *  (`PanelService.create` never materializes); every other kind is `None`. */
  private def captureRawPanelConfig(edit: ResolvedEdit): Future[Option[JsValue]] =
    edit.action match {
      case ResolvedAction.PanelUpdate(id, _, _) =>
        panelRepo.findByIdInternal(id).map(_.map(PanelConfigCodec.encodeConfig))
      case _ => Future.successful(None)
    }

  /** HEL-1795: for a `pipeline` `create` edit, the ids of the steps and Outputs that create itself made, read through
   *  internal reads right after it returned (the pipeline is milliseconds old and its id is known only to this call, so
   *  the listing is exactly what the create made). `None` for every other edit; also `None`, with a warning, when the
   *  read fails, so undo falls back to its legacy rule rather than the apply failing. */
  private def captureCreatedChildren(edit: ResolvedEdit, outcome: EditOutcome): Future[Option[JournaledCreatedChildren]] =
    (edit.action, outcome.newId) match {
      case (_: ResolvedAction.PipelineCreate, Some(id)) =>
        val pid = PipelineId(id)
        val read = for {
          steps   <- pipelineStepRepo.listByPipelineInternal(pid)
          outputs <- outputRepo.listByPipelineInternal(pid)
          roots   <- pipelineRepo.listRootDataSourceIdsInternal(pid)
        } yield Option(JournaledCreatedChildren(steps.map(_.id.value), outputs.map(_.id.value), Some(roots.map(_._1.value))))
        read.recover { case NonFatal(ex) =>
          log.warn(s"edit ${edit.index}: could not record the steps and Outputs the pipeline create made: ${ex.getClass.getSimpleName}")
          None
        }
      case _ => Future.successful(None)
    }

  /** HEL-1796: for a `dataSource` `create` edit, the stored `created_at` (the row watermark) and declared schema of the
   *  source it made, read back from the database on the applier's own context right after the create returned. `None` for
   *  every other edit, and, with a warning, when the read fails, so undo falls back to `appliedAt` rather than the apply
   *  failing. */
  private def captureCreatedDataset(edit: ResolvedEdit, outcome: EditOutcome, user: AuthenticatedUser): Future[Option[JournaledCreatedDataset]] =
    (edit.action, outcome.newId) match {
      case (_: ResolvedAction.DataSourceCreate, Some(id)) =>
        dataSourceRepo.readCreatedDatasetStamp(DataSourceId(id), user).map {
          case Some((createdAt, schemaText)) => Some(JournaledCreatedDataset(Some(createdAt), schemaText.map(JsonParser(_))))
          case None =>
            log.warn(s"edit ${edit.index}: could not read back the data source the create made; undo will fall back to the apply time")
            None
        }.recover { case NonFatal(ex) =>
          log.warn(s"edit ${edit.index}: could not record the dataset the data source create made: ${ex.getClass.getSimpleName}")
          None
        }
      case _ => Future.successful(None)
    }

  /** HEL-1493: the inline root sources a `pipeline` `create` edit made, journaled so undo can remove them. `None` for
   *  every other edit, and for a create whose roots cannot be lined up with the created pipeline's (nothing is
   *  recorded rather than guessed, so undo keeps today's behaviour). An inline root without a reported id is left
   *  out with a warning, as rollback does. */
  private def journaledInlineSources(edit: ResolvedEdit, outcome: EditOutcome): Option[Vector[JournaledInlineSource]] =
    edit.action match {
      case ResolvedAction.PipelineCreate(request) =>
        InlineRootPairing.pair(request, outcome.resultingState) match {
          case InlineRootPairing.NoInlineRoots => Some(Vector.empty)
          case InlineRootPairing.CountMismatch(requestRoots, summaryRoots) =>
            log.warn(s"edit ${edit.index} journals no inline sources: the request has $requestRoots roots but the created pipeline reported $summaryRoots")
            None
          case InlineRootPairing.Paired(targets, unpaired) =>
            if (unpaired > 0)
              log.warn(s"edit ${edit.index}: $unpaired inline root(s) had no dataSourceId in the created pipeline's summary and are not journaled")
            Some(targets.map { case (id, implicitConnector) => JournaledInlineSource(id.value, implicitConnector) })
        }
      case _ => None
    }

  /** design.md D2: journals the application ONLY once every edit has
   *  applied cleanly (this method is only ever reached from the loop's
   *  success branch) — a partially-rolled-back apply never reaches here.
   *  `targetKind`/`op` are threaded from each edit's own `ResolvedEdit`
   *  (`EditOutcome` itself doesn't carry them); `rawResultingConfig` comes
   *  from the separate accumulator, keyed by the same `edit.index`. */
  private def journalSuccess(
      appliedAll: Vector[(ResolvedEdit, EditOutcome)],
      rawConfigs: Map[Int, JsValue],
      children: Map[Int, JournaledCreatedChildren],
      createdDatasets: ConcurrentHashMap[Int, JournaledCreatedDataset],
      user: AuthenticatedUser
  ): Future[String] =
    Future.traverse(appliedAll) { case (edit, outcome) =>
      withInlineStamps(journaledInlineSources(edit, outcome), user).map { inline =>
        JournaledEdit(
          index              = edit.index,
          targetKind         = edit.kind,
          op                 = edit.op,
          priorState         = outcome.priorState,
          resultingState     = outcome.resultingState,
          newId              = outcome.newId,
          rawResultingConfig = rawConfigs.get(edit.index),
          inlineSources      = inline,
          createdChildren    = children.get(edit.index),
          createdDataset     = Option(createdDatasets.get(edit.index))
        )
      }
    }.flatMap { journaledEdits =>
      val now = Instant.now()
      val record = PatchSetApplicationRecord(
        id        = PatchSetApplicationId(UUID.randomUUID().toString),
        ownerId   = user.id,
        appliedAt = now,
        edits     = journaledEdits,
        createdAt = now
      )
      applicationRepo.create(record).map(_.id.value)
    }

  /** HEL-1796: each dataset-kind inline root source gets the same read-back a `dataSource` create does (stored
   *  `created_at` plus declared schema), per source, so undo can tell later rows from the ones the apply made. A source
   *  with no declared schema (not a dataset) or a failed read is left without one (undo then falls back to `appliedAt`);
   *  it never fails the apply. */
  private def withInlineStamps(sources: Option[Vector[JournaledInlineSource]], user: AuthenticatedUser): Future[Option[Vector[JournaledInlineSource]]] =
    sources match {
      case Some(list) if list.nonEmpty =>
        Future.traverse(list) { source =>
          dataSourceRepo.readCreatedDatasetStamp(DataSourceId(source.id), user).map {
            case Some((createdAt, Some(schemaText))) =>
              source.copy(createdDataset = Some(JournaledCreatedDataset(Some(createdAt), Some(JsonParser(schemaText)))))
            case _ => source
          }.recover { case NonFatal(ex) =>
            log.warn(s"could not record the dataset an inline root source made: ${ex.getClass.getSimpleName}")
            source
          }
        }.map(Some(_))
      case other => Future.successful(other)
    }
}
