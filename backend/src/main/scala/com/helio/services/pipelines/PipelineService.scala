package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, DeletePipelineStepResponse, PipelineAnalyzeProposalResponse, PipelineAnalyzeResponse, PipelineProposal, PipelineRootSummaryResponse, PipelineStepConfigCodec, RemovePipelineRootResponse, PipelineStepResponse, PipelineSummaryResponse, ReorderPipelineStepsRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.pipelines.{ExpressionValidationResponse, NodeCapabilitiesResponse}
import com.helio.api.protocols.pipelines.{PipelineAnalyzeConciseResponse, PipelineLaneTreeNode}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, Output, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.domain.engine.{InvalidGraph, LaneReferenceError}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineCycleGuard, PipelineRepository, PipelineRootRepository, PipelineStepRepository, ReparentRejected}
import org.postgresql.util.PSQLException
import org.slf4j.LoggerFactory

import scala.annotation.tailrec
import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `/api/pipelines` and `/api/pipeline-steps`.
 *
 *  Run lifecycle lives in [[PipelineRunService]] (split out in CS2c-3a). The
 *  allow-list of step kinds is sourced from [[PipelineStepKind.All]], which
 *  derives from [[PipelineStep.Registry]] (the step trait is not sealed). It
 *  is not the only kind list — see [[PipelineStepKind.All]].
 *
 *  HEL-279: sharing-aware ACL threading.
 *  - Read paths (findSummaryById, listSteps, analyze) use findByIdShared —
 *    owner and grantees (editor + viewer) can read.
 *  - Owner-only mutation paths (delete, updateName) use findByIdOwned —
 *    grantees and cross-user callers receive 404 (no existence leak).
 *  - Step mutations (addStep, updateStep, deleteStep) require Editor or Owner;
 *    viewer grantees receive 403. Internal step repo methods (no owner-JOIN) are
 *    used after access is confirmed so editor grantees are not blocked by the
 *    V35 pipeline_steps RLS policy. */
final class PipelineService(
    pipelineRepo:     PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo:   DataSourceRepository,
    // HEL-381: nullable-optional wiring mirrors the many other optional
    // collaborators ApiRoutes.scala threads (e.g. binaryRefRepo/imageUploadRepo) —
    // fixtures that don't pass a RestApiConnectorDriver simply can't dry-analyze an
    // analyzeProposal request whose inline source is `rest_api` (every other
    // branch — existing sourceId, inline sql, inline static — never touches
    // it). ApiRoutes itself always threads the real, non-null connector (the
    // same instance SourceService already receives).
    connector: RestApiConnectorDriver = null,
    // HEL-477: nullable-optional wiring mirrors connector above.
    auditService: AuditService = null,
    // HEL-906 task 3.1: backs `create`'s `outputs[]` branch and `removeRoot`'s Output report.
    // HEL-1295: required, never null (enforced by the `require` in the class body).
    outputRepo: OutputRepository,
    // HEL-913 task 7.4: nullable-optional wiring mirrors auditService above -- a fixture that
    // doesn't pass a PipelineRootRepository simply can't exercise addRoot/removeRoot (both
    // InternalError, never silently no-op, when null).
    pipelineRootRepo: PipelineRootRepository = null,
    // HEL-913 task 7.1a: nullable-optional wiring mirrors pipelineRootRepo above -- needed only
    // by `addRoot`'s inline-source branch (R6's "one shape, not two": `roots[]` at create time
    // and `add_root` share the SAME `CreatePipelineRootRequest` inline fields, so this same
    // wiring covers both). Reuses `SourceService.createRest`/`createSql` and
    // `DataSourceService.createStatic` exactly as `PipelineProposalService.resolveSource` does
    // for the proposal-apply path -- same inline kinds supported (rest_api/sql/static), csv
    // deliberately NOT supported inline here either (mirrors that precedent's own documented
    // gap: "inline csv sources are not supported ... create the CSV source separately").
    sourceService:     SourceService = null,
    dataSourceService: DataSourceService = null
)(implicit ec: ExecutionContext) {

  require(outputRepo != null, "PipelineService requires an OutputRepository")

  private val log = LoggerFactory.getLogger(getClass)

  // HEL-1093 (design.md Decision 2a): shared with `AutoRunTriggerService` -- `analyze` below
  // supplies its own ACL-scoped `resolveRoot` (`findByIdOwned`), unchanged from this file's
  // pre-existing inline behavior; only the gathering plumbing itself moved out.
  private val costInputGathering = new PipelineCostInputGathering(pipelineRepo, dataSourceRepo)

  private val support = new PipelineServiceSupport(pipelineStepRepo, dataSourceRepo, auditService)
  private val analyzeReads = new PipelineAnalyzeReads(pipelineRepo, pipelineStepRepo, dataSourceRepo, costInputGathering, support)
  private val nodeReads = new PipelineNodeReads(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo, support)
  private val proposalAnalyze = new PipelineProposalAnalyze(dataSourceRepo, connector, sourceService, support)
  private val rootWrites = new PipelineRootWrites(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo, pipelineRootRepo, sourceService, dataSourceService, support, requireEditorAccess)
  private val createTransaction = new PipelineCreateTransaction(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo, support)
  private val createWrites = new PipelineCreateWrites(pipelineRepo, dataSourceRepo, dataSourceService, support, rootWrites, createTransaction)
  private val stepCreate = new PipelineStepCreate(pipelineRepo, pipelineStepRepo, dataSourceRepo, support, requireEditorAccess)
  private val stepWrites = new PipelineStepWrites(pipelineRepo, pipelineStepRepo, dataSourceRepo, support, requireEditorAccess)

  import support.{audit, toSummaryResponse}

  /** `tag`, when given, exact-matches (HEL-366 tasks.md 2.5) — `None` is the
   *  pre-existing unfiltered behavior. */
  def listSummaries(user: AuthenticatedUser, tag: Option[String] = None): Future[Vector[PipelineSummaryResponse]] =
    pipelineRepo.listSummaries(user, tag).map(_.map(toSummaryResponse))

  /** Sharing-aware read. Owner, editor, and viewer grantees can read. */
  def findSummaryById(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    pipelineRepo.findSummaryByIdShared(pipelineId, Some(user)).map {
      case Some(summary) => Right(toSummaryResponse(summary))
      case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
    }

  def create(req: CreatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    createWrites.create(req, user)

  /** Owner-only rename. Grantees (editor or viewer) receive 403 because
   *  findByIdOwned returns None for non-owners, surfaced as NotFound (no existence leak). */
  def updateName(pipelineId: PipelineId, req: UpdatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] =
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name must not be empty")))
    else
      pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(_) =>
          pipelineRepo.updateName(pipelineId, req.name.trim, user).map {
            case Some(summary) =>
              audit("pipeline.update", "pipeline", Some(pipelineId.value), user)
              Right(toSummaryResponse(summary))
            case None          => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
          }
      }

  /** Owner-only delete. Grantees (editor or viewer) receive 403 because
   *  findByIdOwned returns None for non-owners, surfaced as NotFound (no existence leak). */
  def delete(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    pipelineRepo.findByIdOwned(pipelineId, user).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        pipelineRepo.delete(pipelineId, user).map {
          case true  =>
            audit("pipeline.delete", "pipeline", Some(pipelineId.value), user)
            Right(())
          case false => Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}"))
        }
    }

  def addRoot(pipelineId: PipelineId, req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineRootSummaryResponse]] =
    rootWrites.addRoot(pipelineId, req, user)

  def removeRoot(pipelineId: PipelineId, rootId: PipelineRootId, user: AuthenticatedUser): Future[Either[ServiceError, RemovePipelineRootResponse]] =
    rootWrites.removeRoot(pipelineId, rootId, user)

  def analyze(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeResponse]] =
    analyzeReads.analyze(pipelineId, user)

  def analyzeConcise(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeConciseResponse]] =
    analyzeReads.analyzeConcise(pipelineId, user)

  def laneTree(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineLaneTreeNode]]] =
    nodeReads.laneTree(pipelineId, user)

  private[services] def laneTreeGiven(
      pipelineId: PipelineId,
      allSteps: Vector[PipelineStep],
      outputsAlreadyFetchedForThisPipeline: Vector[Output]
  ): Future[Vector[PipelineLaneTreeNode]] =
    nodeReads.laneTreeGiven(pipelineId, allSteps, outputsAlreadyFetchedForThisPipeline)

  private[services] def listRootDataSourceIdsInternalBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Vector[(PipelineRootId, DataSourceId)]]] =
    nodeReads.listRootDataSourceIdsInternalBatch(pipelineIds)

  private[services] def rootIdsOfBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Map[PipelineStepId, PipelineRootId]]] =
    nodeReads.rootIdsOfBatch(pipelineIds)

  private[services] def listByPipelineInternalBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Vector[PipelineStep]]] =
    nodeReads.listByPipelineInternalBatch(pipelineIds)

  private[services] def laneTreeFromRoots(
      allSteps: Vector[PipelineStep],
      outputsAlreadyFetchedForThisPipeline: Vector[Output],
      rootDataSourceIds: Vector[String],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId]
  ): Vector[PipelineLaneTreeNode] =
    nodeReads.laneTreeFromRoots(allSteps, outputsAlreadyFetchedForThisPipeline, rootDataSourceIds, rootIdOfStep)

  def capabilitiesAtNode(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, NodeCapabilitiesResponse]] =
    nodeReads.capabilitiesAtNode(pipelineId, stepId, user)

  def validateExpression(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      expression: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, ExpressionValidationResponse]] =
    nodeReads.validateExpression(pipelineId, stepId, expression, user)

  def analyzeProposal(proposal: PipelineProposal, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeProposalResponse]] =
    proposalAnalyze.analyzeProposal(proposal, user)

  /** Sharing-aware step list. Owner, editor, and viewer can list steps. */
  def listSteps(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        // Safe: access confirmed by findByIdShared above. Use internal variant
        // so editor/viewer grantees are not blocked by the V35 pipeline_steps
        // RLS owner-JOIN policy.
        // HEL-913 task 7.6a: `rootIdsOf` resolved ONCE for this list call and threaded into
        // every step's response, so `GET /api/pipelines/:id/steps` carries each step's real
        // root id, not a silently-absent field.
        val listF: Future[Either[ServiceError, Vector[PipelineStepResponse]]] = for {
          steps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
          rootIdOfStep <- pipelineStepRepo.rootIdsOf(pipelineId)
        } yield Right(steps.map(s => PipelineStepResponse.fromDomain(s, rootIdOfStep.map { case (k, v) => k.value -> v.value })))
        listF
          // HEL-911: executionOrder no longer raises InvalidGraph (the Phase-1 fence it
          // enforced is deleted) -- classifyDbError still runs here as a general DB-exception
          // classifier (PSQLException etc.), mapping an unexpected failure to a curated
          // ServiceError instead of letting it fall through to the top-level handler's
          // generic 500.
          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
    }

  /** Step creation — requires Editor or Owner. Viewer grantees get 403. */
  def addStep(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] =
    addStepReporting(pipelineId, req, user).map(_.map(_._1))

  def addStepReporting(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, (PipelineStepResponse, Seq[String])]] =
    stepCreate.addStepReporting(pipelineId, req, user)

  def updateStep(stepId: PipelineStepId, req: UpdatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] =
    stepWrites.updateStep(stepId, req, user)

  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, DeletePipelineStepResponse]] =
    stepWrites.deleteStep(stepId, user)

  def reorderSteps(pipelineId: PipelineId, req: ReorderPipelineStepsRequest, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    stepWrites.reorderSteps(pipelineId, req, user)

  def duplicateStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] =
    stepWrites.duplicateStep(stepId, user)

  /** Verifies that the caller has editor (not just viewer) access to the pipeline.
   *  Called only when the caller is NOT the owner (i.e. they have a grant).
   *  Returns Right(()) for editor grantees; Left(Forbidden) for viewer grantees. */
  private def requireEditorAccess(
      pipelineId: PipelineId,
      user:       AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    // We know caller != owner and findByIdShared returned Some, so they have a grant.
    // Query the grant role to distinguish editor from viewer.
    pipelineRepo.findGrantRole(pipelineId, user).map {
      case Some("editor") => Right(())
      case _              => Left(ServiceError.Forbidden("Forbidden"))
    }

}

/** Carries a `ServiceError` out of a composed `DBIO` chain via `DBIO.failed` (HEL-906 task 3.1,
 *  coordinator ruling D3) -- `PipelineService.createTransactional`'s single transaction has no
 *  other channel for a mid-chain business-validation failure (a bad step config, an unresolvable
 *  `clientId` reference, an invalid Output kind/`fieldMapping`) to abort the whole transaction
 *  AND report a specific, typed error back to the caller. Thrown inside `buildStepsAction`/
 *  `buildOutputsAction`; caught exactly once, in `createTransactional`'s `.recover`, after the
 *  transaction (already rolled back by Slick at that point) completes. */
private final case class PipelineCreateValidationFailure(error: ServiceError) extends RuntimeException(error.message)

object PipelineService {

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-913 task 7.3c (R14): the request-address format THIS change emits for create-time
   *  validation errors -- `roots[<i>]`/`steps[<i>]`/`outputs[<i>]` addressing the request's OWN
   *  arrays by index (the only stable address at this point: nothing has a real persisted id
   *  yet), joined by `" › "` (U+203A) when a message needs to name more than one array
   *  position. HEL-914 inherits this format rather than defining a second one.
   *
   *  On the companion object (not the instance) and `private[pipelines]` so
   *  `PipelineServiceAddressFormatSpec` can prove the joined form directly -- no failure case in
   *  THIS change's own resolvers currently reaches it (each fails BEFORE a valid root index
   *  exists to pair with the step/Output index), so without a direct unit test the joined form
   *  would be "defined and never executed," a format HEL-914 inherits with no evidence it
   *  actually produces the right string. */
  private[pipelines] def rootAddress(idx: Int): String   = s"roots[$idx]"
  private[pipelines] def stepAddress(idx: Int): String   = s"steps[$idx]"
  private[pipelines] def outputAddress(idx: Int): String = s"outputs[$idx]"
  private[pipelines] def joinAddress(parts: String*): String = parts.mkString(" › ")

  /** Classify a DB exception into the appropriate ServiceError variant.
   *
   *  HEL-311: the raw PSQLException/JDBC message (which can include table,
   *  column, and constraint names) and any other exception's raw message
   *  must never reach the client body. The full exception is logged
   *  server-side; only a generic, curated message per category is returned.
   */
  private[services] def classifyDbError(ex: Throwable): ServiceError = ex match {
    // HEL-911 (design.md Engine contract items 6a/7): the run-time defensive arm of
    // cycle/membership rejection -- `PipelineService.validateLaneReference` already
    // rejects a bad lane reference at write time with a 400, so this only fires for
    // data that reached the table by some other path (e.g. a pre-this-ticket row, or a
    // future direct-DB write). Classified 422, mirroring the (now-unreachable, kept for
    // wire-shape compatibility per `InvalidGraph`'s own doc) invariant-violation arm
    // this repurposes.
    case invalid: LaneReferenceError =>
      log.warn(s"Pipeline lane reference is invalid: ${invalid.message}")
      ServiceError.UnprocessableEntity(invalid.message)
    // HEL-1069: an opted-in `rejectIfReparents` insert that would have moved existing steps.
    case rejected: ReparentRejected =>
      ServiceError.UnprocessableEntity(rejected.getMessage)
    case invalid: InvalidGraph =>
      log.warn(s"Pipeline step graph is invalid: ${invalid.message}")
      ServiceError.UnprocessableEntity(invalid.message)
    // HEL-1102 (backend fix, cycle 2): every DB-level write path that recovers through this
    // shared classifier -- not just the two call sites (:374/:818) that already caught this
    // locally -- must map a cycle rejection to a named 400, never fall through to the generic
    // `case other` 500 below. Added here once rather than duplicated at each of the ~9 other
    // `.recover { case ex => Left(classifyDbError(ex)) }` sites so every current AND future
    // call site gets it uniformly.
    case PipelineCycleGuard.PipelineCycleRejected(msg) =>
      ServiceError.BadRequest(msg)
    case e: PSQLException =>
      classifyPsqlException(e)
    case other =>
      log.error("Pipeline step operation failed with unexpected error", other)
      ServiceError.InternalError("Internal server error")
  }

  /** HEL-911 (design.md Engine contract items 6a/7, write-time arm): reject a
   *  `lane`-kind `secondaryInput` naming a step that does not exist, belongs to a
   *  DIFFERENT pipeline (including another user's -- this is the security boundary
   *  Engine contract item 10's ACL skip is justified by, per round-1 skeptic CR2), or
   *  is the referencing step itself / one of its own ancestors (a cycle, item 7). `None`
   *  means the config has no lane reference to validate (every other step kind, or a
   *  `source`-kind secondary input) -- nothing to check.
   *
   *  `pipelineSteps` MUST already be scoped to the referencing pipeline (callers pass
   *  `pipelineStepRepo.listByPipelineInternal(pipelineId)`'s result) -- membership is
   *  then simply "present in this list", the same shape the run-time defensive check in
   *  `InProcessPipelineEngine.executeTree` uses. `ancestorChainIds` is the set of step
   *  ids on the referencing step's own path back to the pipeline root (its OWN id
   *  included only when validating an update to an EXISTING step, via `selfId`). */
  private[pipelines] def validateLaneReference(
      typedConfig: Any,
      pipelineSteps: Vector[PipelineStep],
      ancestorChainIds: Set[String],
      selfId: Option[String]
  ): Either[ServiceError, Unit] =
    PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
      case None => Right(())
      case Some(dep) =>
        if (selfId.contains(dep))
          Left(ServiceError.BadRequest(s"Lane reference '$dep' cannot reference the step itself."))
        else if (!pipelineSteps.exists(_.id.value == dep))
          Left(ServiceError.UnprocessableEntity(s"Lane reference '$dep' does not exist in this pipeline."))
        else if (ancestorChainIds.contains(dep))
          Left(ServiceError.BadRequest(s"Lane reference '$dep' would create a cycle (it is an ancestor of this step)."))
        else
          Right(())
    }

  /** HEL-1345 (design D1/D3): the splice anchor for a `rootId` create, as an index into THAT root's
   *  trunk. Pure -- shared by `persistNewStep`'s rootId arm and `addStep`'s lane pre-check so the
   *  two never disagree.
   *
   *  The root's trunk: its head is the lowest-`position` root-level step of the root (ties keep
   *  `steps`' execution order, `sortBy` being stable), then each step's first `position == 0` child.
   *  When the root has a `position == 0` root-level step this equals `trunkOfRoot`; it also covers
   *  a root whose root-level steps all have `position != 0` (legacy tails left after the head was
   *  deleted) the way the editor renders it.
   *
   *  `position` absent -> the trunk-last step (`None` for an empty trunk); `0` -> `None` (the new
   *  step becomes that root's head); `0 < k <= trunk.size` -> `trunk(k - 1)`; else a 422 naming the
   *  root's trunk length. */
  private[pipelines] def resolveRootTrunkAnchor(
      steps: Vector[PipelineStep],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId],
      rootId: PipelineRootId,
      position: Option[Int]
  ): Either[ServiceError, Option[PipelineStepId]] = {
    val head = steps
      .filter(s => s.parentStepId.isEmpty && rootIdOfStep.get(s.id).contains(rootId))
      .sortBy(_.position)
      .headOption
    @tailrec
    def walk(cur: Option[PipelineStep], acc: Vector[PipelineStep]): Vector[PipelineStep] = cur match {
      case Some(step) if acc.size < steps.size =>
        walk(steps.filter(c => c.parentStepId.contains(step.id) && c.position == 0).sortBy(_.position).headOption, acc :+ step)
      case _ => acc
    }
    val trunk = walk(head, Vector.empty)
    position match {
      case None                                      => Right(trunk.lastOption.map(_.id))
      case Some(0)                                   => Right(None)
      case Some(k) if k > 0 && k <= trunk.size       => Right(Some(trunk(k - 1).id))
      case Some(_) =>
        Left(ServiceError.UnprocessableEntity(
          s"position must be between 0 and ${trunk.size} (this root's trunk length)"
        ))
    }
  }

  /** The ancestor-id chain (root-ward) starting at `parentStepId`, walked via
   *  `pipelineSteps`' own `parentStepId` links. Pure -- shared by both `addStep` (the
   *  new step's PROSPECTIVE parent, since it has no id yet) and `updateStep` (the
   *  existing step's actual parent). */
  private[pipelines] def ancestorChainOf(parentStepId: Option[PipelineStepId], pipelineSteps: Vector[PipelineStep]): Set[String] = {
    val byId = pipelineSteps.map(s => s.id.value -> s).toMap
    def loop(cur: Option[PipelineStepId], acc: Set[String]): Set[String] = cur match {
      case None => acc
      case Some(pid) =>
        byId.get(pid.value) match {
          case Some(p) => loop(p.parentStepId, acc + p.id.value)
          case None    => acc
        }
    }
    loop(parentStepId, Set.empty)
  }

  /** HEL-913 task 7.5 (R7 phase 1's lane-reference refusal): every step id descending from
   *  `rootLevelIds` (a root's own root-level step ids), walked via `parentStepId` -- the
   *  SERVICE-layer twin of `PipelineStepRepository.descendantsOfRoot` (which operates on raw
   *  `PipelineStepRow`s inside the repo; this operates on domain `PipelineStep`s, since that's
   *  what `removeRoot`'s lane-reference check already has in hand from `listByPipelineInternal`
   *  -- no reason to make a second DB round-trip for the same shape of computation). */
  private[pipelines] def descendantStepIds(rootLevelIds: Set[String], steps: Vector[PipelineStep]): Set[String] = {
    def expand(frontier: Set[String], acc: Set[String]): Set[String] = {
      val children = steps.filter(s => s.parentStepId.exists(p => frontier.contains(p.value))).map(_.id.value).toSet
      val newOnes  = children -- acc
      if (newOnes.isEmpty) acc else expand(newOnes, acc ++ newOnes)
    }
    expand(rootLevelIds, rootLevelIds)
  }

  private def classifyPsqlException(e: PSQLException): ServiceError = {
    val msg = Option(e.getMessage).getOrElse(e.getClass.getName)
    log.error("Pipeline step DB operation failed", e)
    if (msg.contains("violates foreign key constraint"))
      ServiceError.NotFound("Referenced resource not found")
    else if (msg.contains("violates check constraint"))
      ServiceError.BadRequest("Request violates a data constraint")
    else
      ServiceError.InternalError("Internal server error")
  }
}
