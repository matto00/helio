package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.pipelines.{AggregateAnalyzeStepResponse, AnalyzeStepResponse, AssertAnalyzeStepResponse, CastAnalyzeStepResponse, ChunkByTokenCountAnalyzeStepResponse, ComputeAnalyzeStepResponse, CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineStepRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, DateBucketAnalyzeStepResponse, DeletePipelineStepResponse, DedupeAnalyzeStepResponse, ExtractHeadingsAnalyzeStepResponse, FillNullAnalyzeStepResponse, FilterAnalyzeStepResponse, GroupByAnalyzeStepResponse, JoinAnalyzeStepResponse, LimitAnalyzeStepResponse, LookupAnalyzeStepResponse, OutputAnalyzeResponse, PipelineAnalyzeProposalResponse, PipelineAnalyzeResponse, PipelineProposal, PipelineProposalSource, PipelineRootSummaryResponse, PipelineStepConfigCodec, RemovePipelineRootResponse, ProposalRestApiConfig, PipelineStepResponse, PipelineSummaryResponse, PivotAnalyzeStepResponse, RenameAnalyzeStepResponse, ReorderPipelineStepsRequest, RootSourceSchemaResponse, SchemaFieldResponse, SelectAnalyzeStepResponse, SortAnalyzeStepResponse, SourceSchemaDriftResponse, SplitTextAnalyzeStepResponse, StringOpsAnalyzeStepResponse, TypeChangedColumnResponse, UnionAnalyzeStepResponse, UnpivotAnalyzeStepResponse, UpdatePipelineRequest, UpdatePipelineStepRequest, WindowAnalyzeStepResponse}
import com.helio.api.protocols.sources.{CreateSourceRequest, RestApiConfigPayload, SqlCreateSourceRequest, SqlSourceConfigPayload, StaticDataSourceRequest}
import com.helio.api.protocols.pipelines.{ExpressionValidationResponse, NodeCapabilitiesResponse}
import com.helio.api.protocols.pipelines.{ConciseAnalyzeNode, PipelineAnalyzeConciseResponse, PipelineLaneTreeNode}
import com.helio.api.protocols.panels.{PanelCapabilityColumnResponse, PanelCapabilityResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuditSource, AuthenticatedUser, DataFieldType, DataSource, DataSourceId, DataSourceKind, EphemeralRestConfig, InferredSchema, Output, OutputKind, Pipeline, PipelineId, PipelineRootId, PipelineSchemaDrift, PipelineStep, PipelineStepId, PipelineStepKind, SchemaDrift}
import com.helio.domain.engine.{ExpressionEvaluator, InvalidGraph, LaneReferenceError, PipelineAnalyzeService, RuntimeGraphPath, SchemaField}
import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver, SqlConnectorDriver}
import com.helio.domain.{AggregateConfig, AssertConfig, CastConfig, ChunkByTokenCountConfig, ComputeConfig, DateBucketConfig, DedupeConfig, ExtractHeadingsConfig, FillNullConfig, FilterConfig, GroupByConfig, JoinConfig, LimitConfig, LookupConfig, PivotConfig, RenameConfig, SelectConfig, SortConfig, SplitTextConfig, StringOpsConfig, UnionConfig, UnpivotConfig, WindowConfig}
import com.helio.domain.steps.SecondaryInput
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import org.postgresql.util.PSQLException
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Business logic for `/api/pipelines` and `/api/pipeline-steps`.
 *
 *  Run lifecycle lives in [[PipelineRunService]] (split out in CS2c-3a). The
 *  allow-list of step kinds is sourced from [[PipelineStepKind.All]] —
 *  the sealed-trait subclasses are the single source of truth.
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
    // HEL-906 task 3.1: nullable-optional wiring mirrors connector/auditService above -- a
    // fixture that doesn't pass an OutputRepository simply can't exercise `create`'s
    // `outputs[]` branch (a non-empty `outputs[]` with no OutputRepository wired is an
    // InternalError, never silently ignored -- see `create`'s doc).
    outputRepo: OutputRepository = null,
    // HEL-913 task 7.4: nullable-optional wiring mirrors outputRepo above -- a fixture that
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

  private val log = LoggerFactory.getLogger(getClass)

  private def audit(
      action: String,
      resourceType: String,
      resourceId: Option[String],
      user: AuthenticatedUser,
      metadata: JsValue = JsObject.empty
  ): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, resourceType, resourceId, metadata)

  /** HEL-913 task 7.6a-i: the single-step counterpart to `listSteps`/reorder's bulk `rootIdsOf`
   *  map, resolving ONE step's own root via `PipelineStepRepository.rootIdOfStep` and building
   *  its wire response accordingly. Every create/update/duplicate-step response goes through
   *  this now that `PipelineStepResponse.fromDomain`'s `rootIdOfStep` default was REMOVED
   *  (7.6a-i): a call site states what it resolved, it never silently inherits `None` --
   *  `rootId: None` on the wire means "resolved, and this step genuinely has no known root" and
   *  the resolution attempt genuinely happened, not "nobody asked." */
  private def stepResponseWithRoot(pipelineId: PipelineId, step: PipelineStep): Future[PipelineStepResponse] =
    pipelineStepRepo.rootIdOfStep(pipelineId, step.id).map { rootIdOpt =>
      PipelineStepResponse.fromDomain(step, rootIdOpt.map(rid => step.id.value -> rid.value).toMap)
    }


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
   *  create-then-compensate delete (that was cycle 4's implementation; the coordinator ruled it
   *  out explicitly once the composed `DBIO` action was confirmed to run correctly as one
   *  transaction, and it has been deleted, not patched). A validation failure partway
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
        if (req.steps.isEmpty && req.outputs.isEmpty)
          // Simple-create path: every root's `sourceId`/inline spec is resolved to a
          // caller-owned DataSourceId FIRST (task 7.1a -- an inline root has no id yet for
          // `pipelineRepo.create` to validate), THEN `pipelineRepo.create` does its OWN
          // per-id R8 ownership re-check (unresolvable id -> 404-shaped Left) -- a redundant
          // but harmless second lookup for an id this same call just created, and the ONLY
          // check at all for a pre-existing `sourceId` (blank id -> 400-shaped Left, sequential,
          // refusing on the first bad entry).
          resolveRootSourceIds(req.roots, user).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(dsIds) =>
              pipelineRepo.create(req.name.trim, dsIds, user, tag).map {
                case Right(summary)                          =>
                  audit("pipeline.create", "pipeline", Some(summary.id), user)
                  Right(toSummaryResponse(summary))
                case Left(msg) if msg.contains("not found") => Left(ServiceError.NotFound(msg))
                case Left(msg)                               => Left(ServiceError.BadRequest(msg))
              }
          }
        else
          // Transactional path needs the resolved DataSource OBJECT (name/inferredSchema) for
          // EVERY root before building the composed DBIO action -- unlike the simple path, this
          // pre-validation can't be pushed down into the repo (existing architecture, unrelated
          // to this change).
          resolveRootDataSources(req.roots, user).flatMap {
            case Left(err)          => Future.successful(Left(err))
            case Right(dataSources) => createTransactional(req, dataSources, user, tag)
          }
    }
  }

  /** HEL-913 task 7.1a: simple-create-path counterpart to `resolveRootDataSources` below --
   *  resolves every root's `sourceId`/inline spec via the shared `resolveOneRootSourceId`, in
   *  request order, refusing on the FIRST invalid entry, and returns just the ids (this path
   *  never needs the DataSource object itself -- `pipelineRepo.create` re-resolves it). */
  private def resolveRootSourceIds(
      roots: Vector[CreatePipelineRootRequest],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[DataSourceId]]] = {
    def loop(remaining: List[CreatePipelineRootRequest], acc: Vector[DataSourceId]): Future[Either[ServiceError, Vector[DataSourceId]]] =
      remaining match {
        case Nil => Future.successful(Right(acc))
        case root :: rest =>
          resolveOneRootSourceId(root, user).flatMap {
            case Left(err)   => Future.successful(Left(err))
            case Right(dsId) => loop(rest, acc :+ dsId)
          }
      }
    loop(roots.toList, Vector.empty)
  }

  /** HEL-913 task 7.3 (R8), transactional-path-only: resolves EVERY root's DataSource object
   *  (needed for `dataSource.name`/`.inferredSchema` before the composed transaction is built --
   *  see `createTransactional`'s doc), in request order, refusing on the FIRST invalid entry, via
   *  the shared `resolveOneRootSourceId` (task 7.1a: existing `sourceId` OR an inline source
   *  spec) followed by an ownership re-lookup to get the full `DataSource` object. */
  private def resolveRootDataSources(
      roots: Vector[CreatePipelineRootRequest],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Vector[(DataSourceId, DataSource)]]] = {
    def loop(remaining: List[CreatePipelineRootRequest], acc: Vector[(DataSourceId, DataSource)]): Future[Either[ServiceError, Vector[(DataSourceId, DataSource)]]] =
      remaining match {
        case Nil => Future.successful(Right(acc))
        case root :: rest =>
          resolveOneRootSourceId(root, user).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(dsId) =>
              dataSourceRepo.findByIdOwned(dsId, user).flatMap {
                case None     => Future.successful(Left(ServiceError.NotFound(s"Data source not found: ${dsId.value}")))
                case Some(ds) => loop(rest, acc :+ ((dsId, ds)))
              }
          }
      }
    loop(roots.toList, Vector.empty)
  }

  /** HEL-913 task 7.3a (R13): resolves a PARENTLESS step's owning root to an INDEX into
   *  `roots` (never a real id -- the transactional path calls this OUTSIDE the DBIO chain,
   *  before any root is persisted). A step with a `parentStepId` inherits its root implicitly
   *  and must NOT also name `rootClientId` (a named 400, "both"); a parentless step with neither
   *  `parentStepId` nor `rootClientId` is fine when there is exactly one root (unambiguous,
   *  preserves the pre-multi-root single-root behavior byte-for-byte) but a named 400 ("neither")
   *  once there is more than one; an unresolvable `rootClientId` (matches no `roots[].clientId`)
   *  is a named 400 ("unresolvable"). Returns `Right(None)` for a non-parentless step (root
   *  resolution is irrelevant -- its parent supplies it). */
  private def stepAddress(idx: Int): String   = PipelineService.stepAddress(idx)
  private def outputAddress(idx: Int): String = PipelineService.outputAddress(idx)

  private def resolveStepRootIndex(
      step: CreatePipelineTransactionalStepRequest,
      stepIdx: Int,
      roots: Vector[CreatePipelineRootRequest]
  ): Either[ServiceError, Option[Int]] =
    if (step.parentStepId.isDefined) {
      if (step.rootClientId.isDefined)
        Left(ServiceError.BadRequest(
          s"${stepAddress(stepIdx)}: names both parentStepId and rootClientId -- a step with a parent inherits its root implicitly"
        ))
      else Right(None)
    } else step.rootClientId match {
      case Some(rcid) =>
        roots.indexWhere(_.clientId.contains(rcid)) match {
          case -1  => Left(ServiceError.BadRequest(s"${stepAddress(stepIdx)}: references unresolvable rootClientId '$rcid'"))
          case idx => Right(Some(idx))
        }
      case None =>
        if (roots.size > 1)
          Left(ServiceError.BadRequest(
            s"${stepAddress(stepIdx)}: is parentless with no rootClientId, and this request names ${roots.size} roots -- name one explicitly"
          ))
        else Right(Some(0))
    }

  /** HEL-913 task 7.3a-i (R13 extended to Outputs): the Output-shaped sibling of
   *  `resolveStepRootIndex` -- a step-bound Output (`nodeStepClientId` defined) inherits its
   *  step's root implicitly and must NOT also name `rootClientId`; a root-bound Output
   *  (`nodeStepClientId` absent) follows the identical neither/unresolvable rules. */
  private def resolveOutputRootIndex(
      output: CreatePipelineTransactionalOutputRequest,
      outputIdx: Int,
      roots: Vector[CreatePipelineRootRequest]
  ): Either[ServiceError, Option[Int]] =
    if (output.nodeStepClientId.isDefined) {
      if (output.rootClientId.isDefined)
        Left(ServiceError.BadRequest(
          s"${outputAddress(outputIdx)}: names both nodeStepClientId and rootClientId -- a step-bound Output's root is implied by its step"
        ))
      else Right(None)
    } else output.rootClientId match {
      case Some(rcid) =>
        roots.indexWhere(_.clientId.contains(rcid)) match {
          case -1  => Left(ServiceError.BadRequest(s"${outputAddress(outputIdx)}: references unresolvable rootClientId '$rcid'"))
          case idx => Right(Some(idx))
        }
      case None =>
        if (roots.size > 1)
          Left(ServiceError.BadRequest(
            s"${outputAddress(outputIdx)}: is root-bound with no rootClientId, and this request names ${roots.size} roots -- name one explicitly"
          ))
        else Right(Some(0))
    }

  /** The single-call transactional path (`create` above delegates here only when `steps`/
   *  `outputs` are non-empty). `dataSources` is EVERY root's already-ACL-checked
   *  `(DataSourceId, DataSource)` pair, in request order (`create` resolves and authorizes every
   *  root via `resolveRootDataSources` before this is ever called) -- HEL-907 fix, see
   *  `validateStepCrossOwnerRefs` for every join/union/lookup step's cross-referenced source)
   *  runs OUTSIDE the transaction -- read-only ACL/existence checks, not writes, so they don't
   *  need to share the write transaction's atomicity; `outputRepo`'s nullability is also checked
   *  outside the transaction (a missing collaborator is a wiring problem, not a rollback-worthy
   *  business failure).
   *
   *  HEL-913 task 7.3a/7.3a-i (R13): every step/Output's owning root is resolved to an INDEX
   *  into `dataSources` (`resolveStepRootIndex`/`resolveOutputRootIndex`) BEFORE the transaction
   *  is built, failing fast on a named/unresolvable/conflicting rootClientId with zero writes --
   *  the index is later translated to the REAL persisted root id (`rootIds`, returned by
   *  `pipelineRepo.createAction`) inside the DBIO chain, since no root has a real id until
   *  `createAction` actually inserts it. */
  private def createTransactional(
      req: CreatePipelineRequest,
      dataSources: Vector[(DataSourceId, DataSource)],
      user: AuthenticatedUser,
      tag: Option[String]
  ): Future[Either[ServiceError, PipelineSummaryResponse]] =
    if (req.outputs.nonEmpty && outputRepo == null)
      Future.successful(Left(ServiceError.InternalError("Output creation is unavailable (no OutputRepository configured)")))
    else {
      val stepRootIndices: Either[ServiceError, Vector[Option[Int]]] =
        req.steps.zipWithIndex.foldLeft[Either[ServiceError, Vector[Option[Int]]]](Right(Vector.empty)) { (accE, stepAndIdx) =>
          val (step, stepIdx) = stepAndIdx
          for {
            acc <- accE
            idx <- resolveStepRootIndex(step, stepIdx, req.roots)
          } yield acc :+ idx
        }
      val outputRootIndices: Either[ServiceError, Vector[Option[Int]]] =
        req.outputs.zipWithIndex.foldLeft[Either[ServiceError, Vector[Option[Int]]]](Right(Vector.empty)) { (accE, outputAndIdx) =>
          val (output, outputIdx) = outputAndIdx
          for {
            acc <- accE
            idx <- resolveOutputRootIndex(output, outputIdx, req.roots)
          } yield acc :+ idx
        }
      (stepRootIndices, outputRootIndices) match {
        case (Left(err), _) => Future.successful(Left(err))
        case (_, Left(err)) => Future.successful(Left(err))
        case (Right(stepRootIdxs), Right(outputRootIdxs)) =>
          validateStepCrossOwnerRefs(req.steps, user).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(()) =>
              // HEL-907 task 1.4: computed OUTSIDE the DBIO chain -- analyzeNodes is a pure,
              // in-memory function (no DB access), so there's no reason to pay for it inside the
              // transaction. `req.steps` (not the just-inserted rows) is the correct input: the
              // clientId keys this produces are exactly what `buildOutputsAction` already
              // resolves `nodeStepClientId` against. `sourceSchemasByRoot` is keyed by
              // INDEX-as-string (matching `NodeStepInput.rootId` below) since no root has a real
              // persisted id at this point in the call.
              val sourceSchemasByRoot: Map[String, Vector[SchemaField]] =
                dataSources.zipWithIndex.map { case ((_, ds), idx) => idx.toString -> ds.inferredSchema }.toMap
              val analyzedNodes = PipelineAnalyzeService.analyzeNodes(
                req.steps.zip(stepRootIdxs).zipWithIndex.map { case ((s, rootIdxOpt), idx) =>
                  PipelineAnalyzeService.NodeStepInput(
                    id           = s.clientId,
                    parentStepId = s.parentStepId,
                    position     = idx,
                    op           = s.`type`,
                    config       = s.config.compactPrint,
                    rootId       = rootIdxOpt.map(_.toString)
                  )
                },
                sourceSchemasByRoot
              )
              val action: DBIO[PipelineSummary] = for {
                createResult      <- pipelineRepo.createAction(req.name.trim, dataSources, user, tag)
                (summary, rootIds) = createResult
                stepIdMap         <- buildStepsAction(PipelineId(summary.id), req.steps, stepRootIdxs, rootIds)
                _                 <- buildOutputsAction(PipelineId(summary.id), req.outputs, outputRootIdxs, rootIds, stepIdMap, user, analyzedNodes, sourceSchemasByRoot)
              } yield summary

              pipelineRepo.runTransactionally(user.id.value)(action).map { summary =>
                audit("pipeline.create", "pipeline", Some(summary.id), user)
                Right(toSummaryResponse(summary))
              }.recover {
                case PipelineCreateValidationFailure(err) => Left(err)
                case ex                                    => Left(PipelineService.classifyDbError(ex))
              }
          }
      }
    }

  /** HEL-907: closes a real gap found while retargeting `PipelineProposalService` onto this
   *  single-call transactional path -- `addStep` (the pre-existing per-step write path) has
   *  always pre-flighted a join/union/lookup step's cross-referenced `DataSourceId` for caller
   *  ownership (HEL-278/HEL-384/HEL-386) BEFORE persisting, but `buildStepsAction` (added by
   *  HEL-906, this path's own transactional step-insert loop) never carried the same check --
   *  any caller of `POST /api/pipelines` with a non-empty `steps[]` (not just the proposal path)
   *  could otherwise reference another user's DataSource as a join/union/lookup right-source with
   *  no ownership check at all. Runs entirely OUTSIDE the write transaction (read-only), decoding
   *  each step's config the same way `buildStepsAction` will re-decode it a moment later --
   *  duplicated decode work, never duplicated behavior (both call sites route through the same
   *  `PipelineStepConfigCodec.decode`), so a config `buildStepsAction` would itself reject never
   *  reaches a cross-owner check with a bogus decoded value. An empty `Source("")`
   *  `LookupConfig.secondaryInput` (HEL-911) is a no-op here too, mirroring `addStep`'s own "an
   *  incomplete draft, not a security violation" carve-out. */
  private def validateStepCrossOwnerRefs(
      steps: Vector[CreatePipelineTransactionalStepRequest],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] = {
    // HEL-911 evaluation-1.md CR5 (cycle 2): this single-call create path never validated a
    // `lane`-kind secondaryInput's `stepId` at all -- a dangling id, an id from an EARLIER
    // clientId that isn't actually in this same request, or an id naming the step's own
    // ancestor (a cycle) all persisted silently. `PipelineService.validateLaneReference`/
    // `ancestorChainOf` operate on persisted `PipelineStep`s with real ids; this request has
    // only `clientId`s and hasn't been persisted yet, so this is a lightweight, request-scoped
    // mirror of the same three checks (exists in THIS request / not self / not an ancestor),
    // not a call-through -- the run-time defensive arm in `InProcessPipelineEngine.executeTree`
    // still backstops this once the steps ARE persisted, exactly as documented at contract
    // item 7 ("both arms required").
    val byClientId: Map[String, CreatePipelineTransactionalStepRequest] =
      steps.map(s => s.clientId -> s).toMap

    def ancestorClientIds(step: CreatePipelineTransactionalStepRequest): Set[String] = {
      def loop(cur: Option[String], acc: Set[String]): Set[String] = cur match {
        case None => acc
        case Some(parentClientId) =>
          byClientId.get(parentClientId) match {
            case Some(p) => loop(p.parentStepId, acc + parentClientId)
            case None    => acc
          }
      }
      loop(step.parentStepId, Set.empty)
    }

    def validateLane(step: CreatePipelineTransactionalStepRequest, typedConfig: Any): Either[ServiceError, Unit] =
      PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
        case None => Right(())
        case Some(dep) =>
          if (dep == step.clientId)
            Left(ServiceError.BadRequest(s"Lane reference '$dep' cannot reference the step itself."))
          else if (!byClientId.contains(dep))
            Left(ServiceError.UnprocessableEntity(s"Lane reference '$dep' does not exist in this request."))
          else if (ancestorClientIds(step).contains(dep))
            Left(ServiceError.BadRequest(s"Lane reference '$dep' would create a cycle (it is an ancestor of this step)."))
          else
            Right(())
      }

    steps.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, step) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(()) =>
          PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
            case Failure(_) => Future.successful(Right(())) // buildStepsAction will reject this; not this check's job.
            case Success(typedConfig) =>
              validateLane(step, typedConfig) match {
                case Left(err) => Future.successful(Left(err))
                case Right(()) =>
                  // HEL-950: was three hand-copied per-op arms (join unconditional -- the same
                  // unguarded-empty-id bug this change closes elsewhere -- union/lookup already
                  // `.nonEmpty`-guarded); now driven by the one shared extractor so this call site
                  // cannot drift from PipelineService.addStep/updateStep the way it already had.
                  PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
                    case Some(id) => checkOwnedSource(id, user)
                    case None     => Future.successful(Right(()))
                  }
              }
          }
      }
    }
  }

  private def checkOwnedSource(dataSourceId: String, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dataSourceRepo.findByIdOwned(DataSourceId(dataSourceId), user).map {
      case None    => Left(ServiceError.NotFound(s"Data source not found: $dataSourceId"))
      case Some(_) => Right(())
    }

  /** HEL-911 skeptic-final-1.md cycle 3: `buildStepsAction`'s counterpart to its own
   *  `parentClientIdOpt.map(clientIdMap(_))` line -- a decoded `join`/`union`/`lookup` config
   *  whose `secondaryInput` is `lane`-kind carries a REQUEST-scoped `clientId` (validated
   *  against `byClientId` by `validateStepCrossOwnerRefs`'s `validateLane`, before this
   *  action ever runs), which must be rewritten to the real, persisted `PipelineStepId`
   *  before the config is stored -- otherwise the row persists the clientId itself, which no
   *  read path can ever resolve back to a real step. `Right(typedConfig)` unchanged for every
   *  other config shape (no lane-kind secondaryInput at all). `Left(clientId)` when the
   *  referenced clientId is not yet in `clientIdMap` -- see the call site's comment for why
   *  this can legitimately happen (a forward lane reference) and why it is reported as a named
   *  failure here rather than resolved. */
  private def rewriteLaneClientId(typedConfig: Any, clientIdMap: Map[String, PipelineStepId]): Either[String, Any] = {
    def rewrite(si: SecondaryInput): Either[String, SecondaryInput] = si match {
      case SecondaryInput.Lane(clientId) =>
        clientIdMap.get(clientId) match {
          case Some(realId) => Right(SecondaryInput.Lane(realId.value))
          case None         => Left(clientId)
        }
      case source => Right(source)
    }
    typedConfig match {
      case c: JoinConfig   => rewrite(c.secondaryInput).map(si => c.copy(secondaryInput = si))
      case c: UnionConfig  => rewrite(c.secondaryInput).map(si => c.copy(secondaryInput = si))
      case c: LookupConfig => rewrite(c.secondaryInput).map(si => c.copy(secondaryInput = si))
      case other            => Right(other)
    }
  }

  /** Builds `steps` (in array order, resolving `parentStepId` against earlier `clientId`s in
   *  the SAME request) as one composed `DBIO` chain -- every insert in this chain runs inside
   *  the caller's single transaction (`createTransactional`). A validation failure (duplicate
   *  `clientId`, unknown step type, unresolvable `parentStepId`, bad config) is signalled via
   *  `DBIO.failed(PipelineCreateValidationFailure(...))`, which aborts the WHOLE transaction --
   *  there is no partial-insert state to clean up because nothing before this point has
   *  committed yet. Returns the `clientId -> real PipelineStepId` map so `buildOutputsAction`
   *  can resolve `nodeStepClientId` the same way. */
  private def buildStepsAction(
      pipelineId: PipelineId,
      steps: Vector[CreatePipelineTransactionalStepRequest],
      // HEL-913 task 7.3a: `stepRootIdxs` is `resolveStepRootIndex`'s already-validated result,
      // parallel to `steps` -- `Some(idx)` for a parentless step naming (explicitly or, with a
      // single root, unambiguously) `rootIds(idx)`; `None` for a step with a `parentStepId`
      // (its root is inherited, never resolved here). `rootIds` is the REAL persisted root id
      // per root, in the SAME order as the request's `roots[]` (`pipelineRepo.createAction`'s
      // return value) -- indices only become real ids at this point, since no root existed
      // before `createAction` ran.
      stepRootIdxs: Vector[Option[Int]],
      rootIds: Vector[PipelineRootId]
  ): DBIO[Map[String, PipelineStepId]] =
    steps.zip(stepRootIdxs).foldLeft(DBIO.successful(Map.empty[String, PipelineStepId]): DBIO[Map[String, PipelineStepId]]) { (accAction, specAndRootIdx) =>
      val (spec, rootIdx) = specAndRootIdx
      accAction.flatMap { clientIdMap =>
        if (clientIdMap.contains(spec.clientId))
          DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(s"Duplicate step clientId: ${spec.clientId}")))
        else if (!PipelineStepKind.All.contains(spec.`type`))
          DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(
            s"Invalid step type '${spec.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
          )))
        else spec.parentStepId match {
          case Some(parentClientId) if !clientIdMap.contains(parentClientId) =>
            DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(
              s"Step '${spec.clientId}' references unresolvable parentStepId '$parentClientId' -- it must be an earlier step's clientId in this same request"
            )))
          case parentClientIdOpt =>
            PipelineStepConfigCodec.decode(spec.`type`, spec.config.compactPrint) match {
              case Failure(ex) =>
                log.warn(s"create (transactional): config decode failed for step type '${spec.`type`}'", ex)
                DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(s"Invalid '${spec.`type`}' config")))
              case Success(typedConfig) =>
                val parentStepId = parentClientIdOpt.map(clientIdMap(_))
                // HEL-911 skeptic-final-1.md cycle 3: mirrors the parentStepId rewrite one
                // line above -- `validateLane` (in `validateStepCrossOwnerRefs`, run before
                // this action) validates a `lane`-kind `secondaryInput.stepId` against
                // `byClientId` (the REQUEST's clientIds), but this line used to pass
                // `typedConfig` through UNMODIFIED, persisting the clientId itself instead of
                // resolving it to the real, just-inserted `PipelineStepId` -- a pipeline that
                // validated successfully and persisted a permanently unrunnable lane reference
                // (every run 422s with `LaneReferenceError`, unrepairable since lane authoring
                // is P2.2). Rewritten here through the SAME `clientIdMap` `parentStepId` uses.
                //
                // Unlike `parentStepId` (whose own guard above already REQUIRES it to be an
                // earlier clientId, so it is always in `clientIdMap` by this point), a lane
                // reference's write-time check (`validateLane`) does NOT require the referenced
                // clientId to be earlier in the request -- contract item 6 permits naming ANY
                // node. A forward-referencing lane `stepId` therefore is NOT YET in
                // `clientIdMap` when this fold reaches it, since `buildStepsAction` inserts
                // steps strictly in request order. Rather than silently persist the unresolved
                // clientId again (the exact defect being fixed) or crash on a missing-key
                // lookup, that case fails loudly and by name -- a genuine, narrower limitation
                // than the full contract, reported rather than fixed here (out of this cycle's
                // tightly-scoped fix; forward lane references through this single-call path
                // would need a two-pass build, which is a real restructure).
                rewriteLaneClientId(typedConfig, clientIdMap) match {
                  case Left(unresolvedClientId) =>
                    DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(
                      s"Step '${spec.clientId}' has a lane secondaryInput referencing '$unresolvedClientId', " +
                        "which is not an earlier step's clientId in this same request -- a forward lane " +
                        "reference is not yet supported via this single-call create path"
                    )))
                  case Right(rewrittenConfig) =>
                    pipelineStepRepo.insertInternalAction(pipelineId, spec.`type`, rewrittenConfig, spec.enabled.getOrElse(true), parentStepId, rootIdx.map(rootIds(_)))
                      .map(step => clientIdMap + (spec.clientId -> step.id))
                }
            }
        }
      }
    }

  /** Builds `outputs` (resolving `nodeStepClientId` against `buildStepsAction`'s result map) as
   *  one composed `DBIO` chain, same "abort the whole transaction on failure" contract as
   *  `buildStepsAction`. */
  private def buildOutputsAction(
      pipelineId: PipelineId,
      outputs: Vector[CreatePipelineTransactionalOutputRequest],
      // HEL-913 task 7.3a-i: `outputRootIdxs` is `resolveOutputRootIndex`'s already-validated
      // result, parallel to `outputs` -- `Some(idx)` for a root-bound Output naming (explicitly
      // or, with a single root, unambiguously) `rootIds(idx)`; `None` for a step-bound Output
      // (its root is implied by its step, never resolved here). `rootIds` mirrors
      // `buildStepsAction`'s own parameter.
      outputRootIdxs: Vector[Option[Int]],
      rootIds: Vector[PipelineRootId],
      stepIdMap: Map[String, PipelineStepId],
      user: AuthenticatedUser,
      // HEL-907 task 1.4: `analyzedNodes`/`sourceSchemasByRoot` ground each Output's
      // `fieldMapping` against its OWN node's projected schema -- `analyzedNodes` keyed by
      // `clientId` (the SAME keys `stepIdMap` uses); `sourceSchemasByRoot` (HEL-913 task 7.3a-i,
      // keyed by INDEX-as-string, matching `NodeStepInput.rootId`'s convention) for a root-bound
      // Output (`nodeStepClientId` absent -- `analyzeNodes` never includes the source itself in
      // its map), resolved against THAT Output's OWN root, never an arbitrary/first one.
      analyzedNodes: Map[String, PipelineAnalyzeService.AnalyzedStep],
      sourceSchemasByRoot: Map[String, Vector[SchemaField]]
  ): DBIO[Unit] =
    outputs.zip(outputRootIdxs).foldLeft(DBIO.successful(()): DBIO[Unit]) { (accAction, specAndRootIdx) =>
      val (spec, rootIdx) = specAndRootIdx
      accAction.flatMap { _ =>
        spec.nodeStepClientId match {
          case Some(clientId) if !stepIdMap.contains(clientId) =>
            DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(
              s"Output '${spec.name}' references unresolvable nodeStepClientId '$clientId' -- it must be a step's clientId in this same request"
            )))
          case nodeClientIdOpt =>
            if (spec.name.trim.isEmpty)
              DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest("name is required")))
            else OutputKind.fromString(spec.kind) match {
              case Left(msg) => DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(msg)))
              case Right(kind) =>
                val config = spec.config.getOrElse(JsObject.empty)
                val nodeSchema = nodeClientIdOpt.flatMap(analyzedNodes.get).map(_.outputSchema)
                  .getOrElse(rootIdx.flatMap(idx => sourceSchemasByRoot.get(idx.toString)).getOrElse(Vector.empty))
                validateOutputFieldMapping(kind, config, nodeSchema) match {
                  case Left(err) => DBIO.failed(PipelineCreateValidationFailure(err))
                  case Right(()) =>
                    outputRepo.insertInternalAction(
                      pipelineId     = pipelineId,
                      nodeStepId     = nodeClientIdOpt.map(stepIdMap(_)),
                      ownerId        = user.id,
                      name           = spec.name.trim,
                      kind           = kind,
                      config         = config,
                      explicitRootId = rootIdx.map(rootIds(_))
                    ).map(_ => ())
                }
            }
        }
      }
    }

  /** HEL-892: mirrors `OutputService.validateFieldMapping` exactly (that class's ACL/RLS-facing
   *  copy operates against a persisted Output; this one runs pre-insert against a
   *  not-yet-existing one during single-call pipeline creation) -- duplicated rather than
   *  shared because `OutputService` and `PipelineService` have no common base and pulling one
   *  into the other's constructor purely for this one validator would be a bigger coupling
   *  change than the two-method duplication it avoids.
   *
   *  HEL-907 task 1.4: `schema` is the projected schema AT THIS OUTPUT'S OWN NODE (the caller --
   *  `buildOutputsAction` -- resolves it via `analyzeNodes`/`sourceSchema`, never the trunk's,
   *  per this ticket's own AC). Two independent checks, both run when `fieldMapping` is present:
   *  slot-name validity (`validateFieldMapping`, unchanged) THEN column-existence-at-this-node
   *  (`validateFieldMappingColumnsExist`, new this task) -- ordered so an unknown SLOT name is
   *  reported before a merely-absent COLUMN name for the same bad mapping, matching which error
   *  is more actionable first. */
  private def validateOutputFieldMapping(kind: OutputKind, config: JsObject, schema: Vector[SchemaField]): Either[ServiceError, Unit] = {
    val spec = OutputBindingSpec.All.find(_.outputKind == kind).getOrElse(
      throw new IllegalStateException(s"PipelineService: no OutputBindingSpec for kind $kind -- OutputBindingSpec.All is missing a case")
    )
    config.fields.get("fieldMapping").collect { case o: JsObject => o } match {
      case None => Right(())
      case Some(mappingObj) =>
        val mapping = mappingObj.fields.collect { case (k, JsString(v)) => k -> v }
        OutputBindingSpec.validateFieldMapping(spec, mapping) match {
          case Left(msg) => Left(ServiceError.BadRequest(msg))
          case Right(()) =>
            OutputBindingSpec.validateFieldMappingColumnsExist(mapping, schema) match {
              case Left(msg) => Left(ServiceError.BadRequest(msg))
              case Right(()) => Right(())
            }
        }
    }
  }

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

  /** HEL-913 task 7.1a (R6 "one shape, not two"): resolves ONE `CreatePipelineRootRequest` --
   *  either branch -- down to a `DataSourceId` the caller now owns. Shared by the transactional
   *  create path (`resolveRootDataSources`), the simple create path (`create`), and `addRoot`,
   *  so `roots[]` and `add_root` can never diverge in what they accept (the exact hazard R6
   *  names). Mirrors `PipelineProposalService.resolveSource`'s D1-style mutual-exclusivity
   *  check and its per-kind dispatch, but returns just the id (not a `ResolvedSource`) since
   *  root creation has no proposal-apply-style "delete the inline source if the rest of the
   *  request later fails" undo step to track. */
  private def resolveOneRootSourceId(req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSourceId]] =
    (req.sourceId.map(_.trim), req.`type`) match {
      case (Some(sid), None) if sid.nonEmpty =>
        Future.successful(Right(DataSourceId(sid)))
      case (Some(_), None) =>
        // HEL-913 R8: the HEL-950 empty-seed-id guard does not extend to roots -- a blank
        // sourceId is a hard 400, no ownership lookup performed.
        Future.successful(Left(ServiceError.BadRequest("roots: sourceId is required and must not be blank")))
      case (None, Some(kind)) =>
        resolveInlineRootSourceId(kind, req, user)
      case (Some(_), Some(_)) =>
        Future.successful(Left(ServiceError.BadRequest("roots: specify either sourceId or an inline type, not both")))
      case (None, None) =>
        Future.successful(Left(ServiceError.BadRequest("roots: sourceId or inline type is required")))
    }

  /** The inline-source branch of [[resolveOneRootSourceId]]. `sql`/`rest_api`/`static` create
   *  a brand-new caller-owned DataSource via `sourceService`/`dataSourceService` (the SAME
   *  services `POST /api/sources`/`POST /api/data-sources` use); `csv` is deliberately NOT
   *  supported here, mirroring `PipelineProposalService.resolveSource`'s own documented gap --
   *  no bytes channel exists in a JSON body for `DataSourceService.createCsv`'s upload path. */
  private def resolveInlineRootSourceId(kind: String, req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, DataSourceId]] =
    if (sourceService == null || dataSourceService == null)
      Future.successful(Left(ServiceError.InternalError("Inline root sources are unavailable (no SourceService/DataSourceService configured)")))
    else
      req.name.map(_.trim).filter(_.nonEmpty) match {
        case None => Future.successful(Left(ServiceError.BadRequest("roots: name is required for an inline source")))
        case Some(name) =>
          kind match {
            case DataSourceKind.Csv =>
              Future.successful(Left(ServiceError.UnprocessableEntity(
                "inline csv sources are not supported for pipeline roots; create the CSV source separately and reference it via sourceId"
              )))
            case DataSourceKind.Sql =>
              req.sqlConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  sourceService.createSql(SqlCreateSourceRequest(name, DataSourceKind.Sql, cfg), user).map {
                    case Left(err)  => Left(err)
                    case Right(csr) => Right(DataSourceId(csr.source.id))
                  }
              }
            case DataSourceKind.RestApi =>
              req.restConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  sourceService.createRest(CreateSourceRequest(name, DataSourceKind.RestApi, cfg, fieldOverrides = None), user).map {
                    case Left(err)  => Left(err)
                    case Right(csr) => Right(DataSourceId(csr.source.id))
                  }
              }
            case DataSourceKind.Static =>
              req.staticConfig match {
                case None      => Future.successful(Left(ServiceError.BadRequest("roots: config is required for an inline source")))
                case Some(cfg) =>
                  dataSourceService.createStatic(StaticDataSourceRequest(name, DataSourceKind.Static, cfg.columns, cfg.rows), user).map {
                    case Left(err) => Left(err)
                    case Right(ds) => Right(ds.id)
                  }
              }
            case other =>
              Future.successful(Left(ServiceError.BadRequest(s"roots: unrecognized inline type '$other'")))
          }
      }

  /** `POST /api/pipelines/:id/roots` (HEL-913 task 7.4/7.1a, R6) — appends a new root at the
   *  next available position. Requires Editor or Owner. `req` is `CreatePipelineRootRequest`,
   *  the SAME element shape `POST /api/pipelines`' `roots[]` uses -- resolved via the shared
   *  [[resolveOneRootSourceId]] (existing `sourceId` OR an inline source spec). R8: a blank
   *  `sourceId` is a 400 with NO ownership lookup; an unresolvable/unowned one is a 404. */
  def addRoot(pipelineId: PipelineId, req: CreatePipelineRootRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineRootSummaryResponse]] =
    if (pipelineRootRepo == null)
      Future.successful(Left(ServiceError.InternalError("Root creation is unavailable (no PipelineRootRepository configured)")))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(pipeline) =>
          val editorCheckF: Future[Either[ServiceError, Unit]] =
            if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
            else requireEditorAccess(pipelineId, user)
          editorCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_) =>
              resolveOneRootSourceId(req, user).flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(dsId) =>
                  dataSourceRepo.findByIdOwned(dsId, user).flatMap {
                    case None => Future.successful(Left(ServiceError.NotFound(s"Data source not found: ${dsId.value}")))
                    case Some(ds) =>
                      pipelineRootRepo.add(pipelineId, dsId, user).map { root =>
                        audit("pipeline.root.add", "pipeline", Some(pipelineId.value), user)
                        Right(PipelineRootSummaryResponse(root.id.value, ds.id.value, ds.name))
                      }
                  }
              }
          }
      }

  /** `DELETE /api/pipelines/:id/roots/:rootId` (HEL-913 task 7.4/7.5, R7) — requires Editor or
   *  Owner. **Phase 1 (refuse before touching anything):** the target root must belong to THIS
   *  pipeline (404 if not); removing the LAST root is refused (400, R1); a SURVIVING step's
   *  `lane`-kind secondary input referencing a step that would be deleted is refused (400,
   *  naming the referencing step -- engine-contract item 6a's same-pipeline-membership security
   *  boundary would otherwise be left pointing at a deleted node). **Phase 2 (one transaction):**
   *  every step descending from this root (its root-level step AND its full subtree, not just
   *  the trunk) is deleted -- `outputs`/`binary_refs` referencing those steps cascade
   *  automatically via their own FK (`ON DELETE CASCADE`); `node_snapshots` does NOT cascade
   *  (deliberately FK-free, V98's header) and is deleted EXPLICITLY
   *  (`PipelineStepRepository.removeRootCascadeAction`) -- then the root row itself, then the
   *  remaining roots' positions are compacted to `0..n-2` (R3: nothing addresses a root by
   *  position, so compaction is safe). */
  def removeRoot(pipelineId: PipelineId, rootId: PipelineRootId, user: AuthenticatedUser): Future[Either[ServiceError, RemovePipelineRootResponse]] =
    if (pipelineRootRepo == null)
      Future.successful(Left(ServiceError.InternalError("Root removal is unavailable (no PipelineRootRepository configured)")))
    // HEL-913 (skeptic-final-2.md FIX 2): FAILS CLOSED, matching `createTransactional`'s own
    // `outputRepo == null` guard at this file's Output-creation entry point exactly. The prior
    // shape (`if (outputRepo == null) Future.successful(0)` deep inside `removedOutputsF`) is
    // the round-1 CR2 mechanism reintroduced one caller over: the root removal's own CASCADE
    // (`outputs.root_id`/`outputs.node_step_id`, both `ON DELETE CASCADE`) destroys every
    // Output on this root's steps REGARDLESS of whether `outputRepo` is wired -- only the
    // REPORT of that destruction depended on it. A missing collaborator must refuse the whole
    // operation, not silently under-report real data loss as zero.
    else if (outputRepo == null)
      Future.successful(Left(ServiceError.InternalError("Root removal is unavailable (no OutputRepository configured)")))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(pipeline) =>
          val editorCheckF: Future[Either[ServiceError, Unit]] =
            if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
            else requireEditorAccess(pipelineId, user)
          editorCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_) =>
              for {
                roots        <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
                rootIdOfStep <- pipelineStepRepo.rootIdsOf(pipelineId)
                steps        <- pipelineStepRepo.listByPipelineInternal(pipelineId)
                result       <- {
                  if (!roots.exists(_._1 == rootId))
                    Future.successful(Left(ServiceError.NotFound(s"Root not found: ${rootId.value}")))
                  else if (roots.size == 1)
                    // R1/R7 phase 1 check 1: refuse to remove the last root -- named, never a
                    // silent no-op or a 500.
                    Future.successful(Left(ServiceError.BadRequest("Cannot remove the last root of a pipeline")))
                  else {
                    val rootLevelIds = rootIdOfStep.collect { case (sid, rid) if rid == rootId => sid.value }.toSet
                    val doomedIds    = PipelineService.descendantStepIds(rootLevelIds, steps)
                    // R7 phase 1 check 2: a SURVIVING step's lane secondary input referencing a
                    // step about to be deleted is refused, naming the referencing step -- a
                    // dangling lane reference is a security-boundary violation (engine-contract
                    // item 6a), not merely untidy.
                    val survivingLaneViolations = steps.filterNot(s => doomedIds.contains(s.id.value)).flatMap { s =>
                      PipelineStepConfigCodec.secondaryLaneStepId(s.configValue).filter(doomedIds.contains).map(laneId => (s, laneId))
                    }
                    survivingLaneViolations.headOption match {
                      case Some((step, laneId)) =>
                        Future.successful(Left(ServiceError.BadRequest(
                          s"Step '${step.id.value}' has a lane secondaryInput referencing '$laneId', which would be deleted with this root -- remove or repoint that reference first"
                        )))
                      case None =>
                        // Phase 2: report the placement count, then delete, atomically (R7 phase
                        // 2 steps 3-5). Outputs about to be deleted are read BEFORE the
                        // transactional delete -- a DB-level cascade would remove them without
                        // ever producing this report (design.md R7's own callout).
                        // `outputRepo` is guaranteed non-null here -- `removeRoot`'s own entry
                        // guard (this file, HEL-913 skeptic-final-2.md FIX 2) already refused the
                        // whole call otherwise.
                        val removedOutputsF: Future[Int] =
                          outputRepo.listByPipelineInternal(pipelineId).map(_.count { o =>
                            o.node.stepId.exists(sid => doomedIds.contains(sid.value)) || o.node.rootId.contains(rootId)
                          })
                        removedOutputsF.flatMap { removedOutputCount =>
                          val action = for {
                            removedStepIds <- pipelineStepRepo.removeRootCascadeAction(pipelineId, rootId)
                            _              <- pipelineRootRepo.removeAction(rootId)
                            _              <- pipelineRootRepo.compactPositions(pipelineId)
                          } yield removedStepIds
                          pipelineRepo.runTransactionally(user.id.value)(action).map { removedStepIds =>
                            audit("pipeline.root.remove", "pipeline", Some(pipelineId.value), user)
                            Right(RemovePipelineRootResponse(removedStepIds.size, removedOutputCount))
                          }.recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                        }
                    }
                  }
                }
              } yield result
          }
      }

  /** Sharing-aware analyze. Owner, editor, and viewer can analyze. */
  def analyze(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeResponse]] = {
    val summaryF  = pipelineRepo.findSummaryByIdShared(pipelineId, Some(user))
    val pipelineF = pipelineRepo.findByIdShared(pipelineId, Some(user))

    val combined = for {
      summary  <- summaryF
      pipeline <- pipelineF
    } yield (summary, pipeline)

    combined.flatMap {
      case (Some(summary), Some(pipeline)) =>
        // Safe: access confirmed by findByIdShared above.
        // HEL-412/HEL-462 merge: keep HEAD's `allSteps` naming (the unconflicted
        // `val steps = allSteps.filter(_.enabled)` below depends on it) and
        // origin/main's `.flatMap`/`deriveSourceSchema` (required by the
        // schema-drift continuation this block now returns — see the merge
        // commit body for the full rationale, including why the drift capture/
        // compare sides never need an enabled-vs-full-list decision at all).
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
          // HEL-904 4.1/4.3: the source's schema now lives inline on `data_sources
          // .inferred_schema` — no companion DataType to look up anymore.
          // HEL-913 task 7.2c (`pipeline-analyze-api` spec delta): "Analyze SHALL derive a source
          // schema PER ROOT... one source-schema entry per root, keyed by root id." The prior
          // single-`findPrimaryDataSourceIdInternal` resolution here was an unmet SHALL in this
          // change's own binding artifact -- 5.9 root-keyed the internal `analyzeNodes` grounding,
          // but nothing reshaped THIS route's response, and 7.2a/7.2b reshaped the two sibling
          // responses (`PipelineSummaryResponse`, `WorkspaceContextPipeline`) without touching
          // analyze. Mirrors the capabilities route's own root resolution (`resolveNodeSchema`
          // above) exactly: `listRootDataSourceIdsInternal` (position-ordered) + `rootIdsOf` (every
          // parentless step's owning root), pipeline access already confirmed by `findByIdShared`.
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
            rootSchemas       <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                                    dataSourceRepo.findByIdOwned(dsId, user).map { dsOpt =>
                                      (rootId.value, dsOpt.map(_.name).getOrElse(""), dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
                                    }
                                  }
          } yield (rootIdOfStep, rootSchemas)

          rootFetch.flatMap { case (rootIdOfStep, rootSchemas) =>
            val schemasByRoot = rootSchemas.map { case (rid, _, schema) => rid -> schema }.toMap
            // HEL-462's drift baseline predates multi-root and is not named by the 7.2c delta --
            // scoped here to the PRIMARY (lowest-positioned) root's schema, the same root
            // `findPrimaryDataSourceIdInternal` used to resolve alone, so existing single-root
            // baselines keep comparing against the same schema they always have.
            val primarySchema: Vector[SchemaField] = rootSchemas.headOption.map(_._3).getOrElse(Vector.empty)

            // HEL-913 task 7.2c fold-in: build `nodeInputs` from EVERY step (enabled or not),
            // never pre-filtered -- a disabled step still occupies a real position in the
            // `parentStepId` graph, and filtering it out here breaks `isReady` for any child
            // whose `parentStepId` names it (that child would never resolve and silently
            // vanish, exactly the regression this fix corrects). `analyzeNodes` itself now
            // makes a disabled node transparent (identity pass-through). HEL-412 (design.md
            // Decision 3, boundary iii) still applies to the RESPONSE: entries for enabled
            // steps only -- filtered AFTER the walk, not before it.
            val nodeInputs = allSteps.map(s =>
              PipelineAnalyzeService.NodeStepInput(
                id           = s.id.value,
                parentStepId = s.parentStepId.map(_.value),
                position     = s.position,
                op           = s.kind,
                config       = PipelineStepConfigCodec.encode(s),
                rootId       = rootIdOfStep.get(s.id).map(_.value),
                enabled      = s.enabled
              )
            )
            val projections = PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot)
            val enabledSteps = allSteps.filter(_.enabled)
            // Reassemble in the SAME order `enabledSteps` lists them; a node that never resolved
            // (unknown parentStepId, dangling lane reference) is simply absent, mirroring
            // `analyzeNodes`'s own existing tolerant-degradation contract elsewhere in this file.
            val analyzed = enabledSteps.flatMap(s => projections.get(s.id.value))

            // HEL-462: compare the current (primary-root) source schema against the baseline
            // captured on the pipeline's last successful (non-dry) run.
            pipelineRepo.findLastSourceSchema(pipelineId, user).map { baselineJson =>
              val baseline = parseBaselineSchema(pipelineId, baselineJson)
              val drift    = PipelineSchemaDrift.diff(baseline, primarySchema)

              Right(PipelineAnalyzeResponse(
                id                = summary.id,
                name              = summary.name,
                sourceSchemas     = rootSchemas.map { case (rid, dsName, schema) =>
                                      RootSourceSchemaResponse(rid, dsName, schema.map(toFieldResponse))
                                    },
                steps             = analyzed.map(toAnalyzeStepResponse),
                sourceSchemaDrift = drift.map(toDriftResponse)
              ))
            }
          }
        }
      case _ =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
    }
  }

  /** HEL-914 task 6.4 (design.md D5/D6): `GET /pipelines/:id/analyze?concise=true`'s opt-in
   *  per-node `{path, op, validationError}` projection — a wholly separate response from
   *  `analyze` above, under a byte budget `analyze`'s full response is never asked to meet.
   *  `path` reuses `RuntimeGraphPath` (the SAME builder `InProcessPipelineEngine` uses for
   *  lane-path error reporting, design.md D5's "exactly one implementation" rule) rather than
   *  a second formatter. Entries for ENABLED steps only, mirroring `analyze`'s own boundary. */
  def analyzeConcise(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeConciseResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
            rootSchemas       <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                                    dataSourceRepo.findByIdOwned(dsId, user).map { dsOpt =>
                                      rootId.value -> dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField])
                                    }
                                  }
          } yield (rootDataSourceIds.map(_._1.value), rootIdOfStep, rootSchemas.toMap)

          rootFetch.map { case (rootIds, rootIdOfStep, schemasByRoot) =>
            val rootIdOfStepStr = rootIdOfStep.map { case (sid, rid) => sid.value -> rid.value }
            val nodeInputs = allSteps.map(s =>
              PipelineAnalyzeService.NodeStepInput(
                id           = s.id.value,
                parentStepId = s.parentStepId.map(_.value),
                position     = s.position,
                op           = s.kind,
                config       = PipelineStepConfigCodec.encode(s),
                rootId       = rootIdOfStep.get(s.id).map(_.value),
                enabled      = s.enabled
              )
            )
            val projections = PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot)
            val graphPath    = RuntimeGraphPath.build(allSteps, rootIds, rootIdOfStepStr)
            val nodes = allSteps.filter(_.enabled).flatMap { s =>
              projections.get(s.id.value).map { analyzed =>
                ConciseAnalyzeNode(path = graphPath.pathOf(s), op = s.kind, validationError = analyzed.validationError)
              }
            }
            Right(PipelineAnalyzeConciseResponse(nodes))
          }
        }
    }

  /** HEL-914 task 6.6 (design.md D5/D6): the compact lane tree `WorkspaceContextService`
   *  embeds per pipeline -- id/parentId/rootId/op/boundOutputIds, no configs, no schemas, no
   *  sample rows. `rootId` reuses `RuntimeGraphPath` (never a second root-resolution walk);
   *  bound Outputs come from the SAME `outputRepo.listByPipelineInternal` fetch
   *  `WorkspaceContextService.buildPipeline` already makes for its representative-Output pick,
   *  so this adds no new query shape to that caller, only a second, cheap in-memory grouping
   *  over already-fetched rows. */
  def laneTree(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineLaneTreeNode]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
          } yield (rootDataSourceIds.map(_._1.value), rootIdOfStep)
          val outputsF =
            if (outputRepo == null) Future.successful(Vector.empty[Output])
            else outputRepo.listByPipelineInternal(pipelineId)

          for {
            (rootIds, rootIdOfStep) <- rootFetch
            outputs                 <- outputsF
          } yield {
            val rootIdOfStepStr = rootIdOfStep.map { case (sid, rid) => sid.value -> rid.value }
            val graphPath       = RuntimeGraphPath.build(allSteps, rootIds, rootIdOfStepStr)
            val outputsByStep: Map[String, Vector[String]] =
              outputs.flatMap(o => o.node.stepId.map(sid => sid.value -> o.id.value)).groupMap(_._1)(_._2)
            Right(allSteps.map { s =>
              val path   = graphPath.pathOf(s)
              val rootId = path.stripPrefix("root:").takeWhile(_ != ' ')
              PipelineLaneTreeNode(
                id        = s.id.value,
                parentId  = s.parentStepId.map(_.value),
                rootId    = rootId,
                op        = s.kind,
                outputIds = outputsByStep.getOrElse(s.id.value, Vector.empty)
              )
            })
          }
        }
    }

  /** `GET /api/pipelines/:id/capabilities?stepId=` (HEL-906 task 3.4) — evaluates
   *  `OutputBindingSpec` against the per-node projection `PipelineAnalyzeService.analyzeNodes`
   *  (task 3.3) computes for `stepId`, `None` meaning the pipeline's raw source. Sharing-aware
   *  read (owner/editor/viewer of the pipeline), mirroring `analyze` above. An unresolvable
   *  `stepId` (absent from the pipeline's own step list, or present but unreached by the tree
   *  walk) is a 404 naming the id -- never a silent fallback to the source schema. */
  def capabilitiesAtNode(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, NodeCapabilitiesResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        projectedSchemaAtNode(pipelineId, pipeline, stepId, user).map {
          case None =>
            Left(ServiceError.NotFound(s"Unknown stepId: ${stepId.map(_.value).getOrElse("")}"))
          case Some(schema) =>
            Right(buildNodeCapabilities(stepId, schema))
        }
    }

  /** `POST /api/pipelines/:id/validate-expression?stepId=` (HEL-906 cycle 7): delegates to
   *  the SAME `ExpressionEvaluator.validate` the `compute` step's own analyze-time hook uses
   *  (`PipelineAnalyzeService.inferCompute`), against the node's projected schema field names
   *  -- reuses `capabilitiesAtNode`'s node-resolution machinery (`projectedSchemaAtNode`)
   *  rather than a second schema-projection codepath. `stepId` absent means the pipeline's
   *  raw source schema. An unknown `stepId` is a 404, matching `capabilitiesAtNode`'s own
   *  convention. */
  def validateExpression(
      pipelineId: PipelineId,
      stepId: Option[PipelineStepId],
      expression: String,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, ExpressionValidationResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        projectedSchemaAtNode(pipelineId, pipeline, stepId, user).map {
          case None =>
            Left(ServiceError.NotFound(s"Unknown stepId: ${stepId.map(_.value).getOrElse("")}"))
          case Some(schema) =>
            val fieldNames = schema.map(_.name).toSet
            ExpressionEvaluator.validate(expression, fieldNames) match {
              case Right(())  => Right(ExpressionValidationResponse(valid = true, error = None))
              case Left(msg)  => Right(ExpressionValidationResponse(valid = false, error = Some(msg)))
            }
        }
    }

  /** Shared node-schema-projection resolution for `capabilitiesAtNode`/`validateExpression` --
   *  `None` (outer) means an unknown `stepId`; `Some(sourceSchema)` when `stepId` is absent. */
  private def projectedSchemaAtNode(
      pipelineId: PipelineId,
      pipeline: Pipeline,
      stepId: Option[PipelineStepId],
      user: AuthenticatedUser
  ): Future[Option[Vector[SchemaField]]] =
    pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
      // HEL-913 task 5.9: `pipeline.sourceDataSourceId` no longer exists -- resolved via EVERY
      // pipeline root (not just the lowest-positioned one), each root's schema keyed by its own
      // root id so a root-level node's projection uses THAT root's schema, not an arbitrary
      // "the" root. `rootIdsOf` gives each parentless step's owning root; `stepId absent` (the
      // caller asking for "the source schema") still resolves against the lowest-positioned
      // root, matching the pre-multi-root single-schema convention `stepId = None` has always had
      // on this endpoint (caller's pipeline access already confirmed upstream, mirroring the
      // privileged field-read `findPrimaryDataSourceIdInternal`/`listRootDataSourceIdsInternal`
      // replace).
      for {
        rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
        rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
        schemasByRoot     <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                               dataSourceRepo.findByIdOwned(dsId, user).map(ds => rootId.value -> ds.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
                             }.map(_.toMap)
      } yield {
        val primarySchema = rootDataSourceIds.headOption.map(_._1.value).flatMap(schemasByRoot.get).getOrElse(Vector.empty[SchemaField])
        val steps = allSteps.filter(_.enabled)
        val nodeInputs = steps.map(s =>
          PipelineAnalyzeService.NodeStepInput(
            id           = s.id.value,
            parentStepId = s.parentStepId.map(_.value),
            position     = s.position,
            op           = s.kind,
            config       = PipelineStepConfigCodec.encode(s),
            rootId       = rootIdOfStep.get(s.id).map(_.value)
          )
        )
        val projections = PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot)
        stepId match {
          case None      => Some(primarySchema)
          case Some(sid) => projections.get(sid.value).map(_.outputSchema)
        }
      }
    }

  private def buildNodeCapabilities(stepId: Option[PipelineStepId], schema: Vector[SchemaField]): NodeCapabilitiesResponse = {
    val columns = schema.flatMap(sf => DataFieldType.fromString(sf.`type`).map(t => PanelCapabilityColumnResponse(sf.name, DataFieldType.asString(t), nullable = false)))
    val capabilities = OutputBindingSpec.All.map { spec =>
      val result = OutputBindingSpec.evaluate(spec, schema)
      OutputKind.asString(spec.outputKind) -> PanelCapabilityResponse(
        bindable        = result.bindable,
        requiredSlots   = spec.requiredSlots,
        optionalSlots   = spec.optionalSlots,
        eligibleColumns = result.eligibleColumns,
        reason          = result.reason,
        message         = result.message
      )
    }.toMap
    NodeCapabilitiesResponse(stepId.map(_.value), columns, capabilities)
  }

  /** Tolerant-parse of the persisted `last_source_schema` baseline (design
   *  D5): malformed or legacy JSON is treated as "no baseline" (never a hard
   *  analyze failure), with a warn-level log naming the pipeline. `None`
   *  (never a successful run) is the ordinary first-run case and is not
   *  logged. */
  private def parseBaselineSchema(pipelineId: PipelineId, baselineJson: Option[String]): Option[Vector[SchemaField]] =
    baselineJson.flatMap { json =>
      Try(json.parseJson.convertTo[Vector[SchemaField]]) match {
        case Success(schema) => Some(schema)
        case Failure(ex) =>
          log.warn(s"HEL-462: failed to parse last_source_schema baseline for pipeline ${pipelineId.value}", ex)
          None
      }
    }

  private def toDriftResponse(drift: SchemaDrift): SourceSchemaDriftResponse =
    SourceSchemaDriftResponse(
      addedColumns       = drift.addedColumns.map(toFieldResponse),
      removedColumns     = drift.removedColumns.map(toFieldResponse),
      typeChangedColumns = drift.typeChangedColumns.map(c =>
        TypeChangedColumnResponse(c.name, previousType = c.previousType, currentType = c.currentType)
      )
    )

  /** Dry-analyze a not-yet-created `PipelineProposal` (HEL-381): resolve/derive the
   *  source schema, fold the proposed steps through the same `PipelineAnalyzeService`
   *  engine `analyze` above uses, and return the projected schema — no persistence,
   *  no run (design.md D1).
   *
   *  Validates every step's `type` against `PipelineStepKind.All` *before* resolving
   *  the source or building `stepInputs` — mirroring `addStep`'s existing guard above
   *  — and short-circuits with `ServiceError.BadRequest` for an unrecognized kind.
   *  Unlike an in-schema-range "bad config" (surfaced as a per-step `validationError`
   *  in a `200`, see `toAnalyzeStepResponse`'s tolerant decode), an unrecognized `type`
   *  has no corresponding `AnalyzeStepResponse` subtype to construct at all — the
   *  response union is closed over registered kinds — so a hard `400` for the whole
   *  proposal (not a per-step field) is the only representable outcome. Without this
   *  guard, an unregistered `type` would flow through `PipelineAnalyzeService.analyze`
   *  harmlessly (it degrades to a per-step "Unknown op" validationError there) only to
   *  then throw inside `toAnalyzeStepResponse`'s `PipelineStepConfigCodec.decode`
   *  re-decode — an uncaught `IllegalStateException` surfacing as an unhandled `500`,
   *  since `schemas/pipelines/pipeline-proposal.schema.json` deliberately leaves step `type`
   *  unconstrained (checked at apply time, not by this schema) and no
   *  `ExceptionHandler` is registered anywhere in the backend. */
  /** HEL-914 task 3.6/D4: projects PER NODE across lanes, reusing the same `analyzeNodes`
   *  multi-root/lane projection the persisted-pipeline `analyze` route uses above — never a
   *  second, un-applied-proposal-specific projection. Each proposed root gets a stable key
   *  (its own `clientId` when given, else its request index as a string) so a step's
   *  `rootClientId` (or, for a single-root proposal, the implicit root) resolves against the
   *  right root's schema, and a rejoin node's schema derives from BOTH incoming lanes. */
  def analyzeProposal(proposal: PipelineProposal, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeProposalResponse]] =
    validateStepKinds(proposal.steps) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        resolveAllProposalRootSchemas(proposal, user).map {
          case Left(err) => Left(err)
          case Right(rootSchemas) =>
            val rootKeys = proposal.roots.zipWithIndex.map { case (root, idx) => root.clientId.getOrElse(idx.toString) }
            val schemasByRoot: Map[String, Vector[SchemaField]] =
              rootKeys.zip(rootSchemas.map(_._2)).toMap
            val defaultRootKey = rootKeys.head

            // HEL-412 (design.md Decision 3, boundary iv): a proposal step
            // carrying `enabled: false` is treated as absent, matching what
            // the live analyze endpoint would report once applied.
            val nodeInputs = proposal.steps.zipWithIndex.map { case (req, i) =>
              PipelineAnalyzeService.NodeStepInput(
                id           = req.clientId,
                parentStepId = req.parentStepId,
                position     = i,
                op           = req.`type`,
                config       = req.config.compactPrint,
                rootId       = Some(req.rootClientId.filter(_.trim.nonEmpty).getOrElse(defaultRootKey)),
                enabled      = req.enabled.getOrElse(true)
              )
            }
            val projections  = PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot)
            val enabledSteps = proposal.steps.filter(_.enabled.getOrElse(true))
            val analyzed     = enabledSteps.flatMap(s => projections.get(s.clientId))

            resolveProposalOutputAnalyses(proposal.outputs, proposal.steps, rootKeys, schemasByRoot, projections) match {
              case Left(err) => Left(err)
              case Right(outputAnalyses) =>
                Right(PipelineAnalyzeProposalResponse(
                  sourceSchemas = rootSchemas.zip(rootKeys).map { case ((name, schema), key) =>
                    RootSourceSchemaResponse(key, name, schema.map(toFieldResponse))
                  },
                  steps   = analyzed.map(toAnalyzeStepResponse),
                  outputs = outputAnalyses
                ))
            }
        }
    }

  /** HEL-914 task 6b.4a: every proposed Output's fieldMapping is validated grounded at that
   *  Output's OWN node -- a step-bound Output against `projections`' `outputSchema` (which,
   *  for a rejoin/`join`-kind node, `PipelineAnalyzeService.analyzeNodes` already derives from
   *  BOTH incoming lanes, not just the parent lane -- reused here verbatim, never re-derived);
   *  a root-bound Output against that root's own schema, resolved the same
   *  `nodeStepClientId`-absent/`rootClientId`-present/single-root-implicit rules
   *  `resolveOutputRootIndex` enforces for the real (persisting) create path -- kept as a
   *  parallel, proposal-scoped resolver here since `resolveOutputRootIndex` operates over
   *  `CreatePipelineRootRequest`, not `PipelineProposalSource`. */
  private def resolveProposalOutputAnalyses(
      outputs:       Vector[CreatePipelineTransactionalOutputRequest],
      steps:         Vector[CreatePipelineTransactionalStepRequest],
      rootKeys:      Vector[String],
      schemasByRoot: Map[String, Vector[SchemaField]],
      projections:   Map[String, PipelineAnalyzeService.AnalyzedStep]
  ): Either[ServiceError, Vector[OutputAnalyzeResponse]] = {
    val stepClientIds = steps.map(_.clientId).toSet
    outputs.zipWithIndex.foldLeft[Either[ServiceError, Vector[OutputAnalyzeResponse]]](Right(Vector.empty)) {
      case (Left(err), _) => Left(err)
      case (Right(acc), (output, idx)) =>
        resolveOneProposalOutputAnalysis(output, idx, stepClientIds, rootKeys, schemasByRoot, projections).map(acc :+ _)
    }
  }

  private def resolveOneProposalOutputAnalysis(
      output:        CreatePipelineTransactionalOutputRequest,
      idx:           Int,
      stepClientIds: Set[String],
      rootKeys:      Vector[String],
      schemasByRoot: Map[String, Vector[SchemaField]],
      projections:   Map[String, PipelineAnalyzeService.AnalyzedStep]
  ): Either[ServiceError, OutputAnalyzeResponse] = {
    val address = outputAddress(idx)
    output.nodeStepClientId match {
      case Some(clientId) if !stepClientIds.contains(clientId) =>
        Left(ServiceError.BadRequest(
          s"$address: references unresolvable nodeStepClientId '$clientId' -- it must be a step's clientId in this same request"
        ))
      case nodeClientIdOpt =>
        OutputKind.fromString(output.kind) match {
          case Left(msg) => Left(ServiceError.BadRequest(msg))
          case Right(kind) =>
            resolveProposalOutputNodeSchema(output, idx, nodeClientIdOpt, rootKeys, schemasByRoot, projections).map { nodeSchema =>
              val config = output.config.getOrElse(JsObject.empty)
              val validationError = validateOutputFieldMapping(kind, config, nodeSchema) match {
                case Left(err) => Some(err.message)
                case Right(()) => None
              }
              OutputAnalyzeResponse(output.name, output.kind, validationError)
            }
        }
    }
  }

  /** Mirrors `resolveOutputRootIndex`'s mutual-exclusion/single-root-implicit rules, but resolves
   *  directly to that root's SCHEMA (never an index into a `CreatePipelineRootRequest` vector,
   *  which a proposal's `roots` -- `PipelineProposalSource` -- is not). */
  private def resolveProposalOutputNodeSchema(
      output:        CreatePipelineTransactionalOutputRequest,
      idx:           Int,
      nodeClientIdOpt: Option[String],
      rootKeys:      Vector[String],
      schemasByRoot: Map[String, Vector[SchemaField]],
      projections:   Map[String, PipelineAnalyzeService.AnalyzedStep]
  ): Either[ServiceError, Vector[SchemaField]] = {
    val address = outputAddress(idx)
    nodeClientIdOpt match {
      case Some(clientId) =>
        if (output.rootClientId.isDefined)
          Left(ServiceError.BadRequest(
            s"$address: names both nodeStepClientId and rootClientId -- a step-bound Output's root is implied by its step"
          ))
        else
          Right(projections.get(clientId).map(_.outputSchema).getOrElse(Vector.empty))
      case None =>
        output.rootClientId match {
          case Some(rcid) =>
            rootKeys.indexOf(rcid) match {
              case -1  => Left(ServiceError.BadRequest(s"$address: references unresolvable rootClientId '$rcid'"))
              case idx => Right(schemasByRoot.getOrElse(rootKeys(idx), Vector.empty))
            }
          case None =>
            if (rootKeys.size > 1)
              Left(ServiceError.BadRequest(
                s"$address: is root-bound with no rootClientId, and this request names ${rootKeys.size} roots -- name one explicitly"
              ))
            else
              Right(schemasByRoot.getOrElse(rootKeys.head, Vector.empty))
        }
    }
  }

  /** Resolves EVERY root's schema, in request order — a failure names the offending root's
   *  address (task 6b.4a). */
  private def resolveAllProposalRootSchemas(
      proposal: PipelineProposal,
      user:     AuthenticatedUser
  ): Future[Either[ServiceError, Vector[(String, Vector[SchemaField])]]] =
    proposal.roots.zipWithIndex.foldLeft(Future.successful[Either[ServiceError, Vector[(String, Vector[SchemaField])]]](Right(Vector.empty))) {
      case (acc, (root, idx)) =>
        acc.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(soFar) =>
            resolveOneProposalRootSchema(root, idx, proposal.pipelineName, user).map {
              case Left(err)       => Left(err)
              case Right(resolved) => Right(soFar :+ resolved)
            }
        }
    }

  private def resolveOneProposalRootSchema(
      source:       PipelineProposalSource,
      idx:          Int,
      fallbackName: String,
      user:         AuthenticatedUser
  ): Future[Either[ServiceError, (String, Vector[SchemaField])]] = {
    val address = PipelineService.rootAddress(idx)
    source.sourceId match {
      case Some(id) =>
        dataSourceRepo.findByIdOwned(DataSourceId(id), user).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"$address: data source not found: $id")))
          case Some(ds) =>
            // HEL-904 4.1/4.3: no companion DataType to look up — the schema lives inline.
            Future.successful(Right((ds.name, ds.inferredSchema)))
        }
      case None =>
        resolveInlineSourceSchema(source, fallbackName, user)
    }
  }

  /** Same allow-list check `addStep` already performs (`PipelineStepKind.All.contains`)
   *  before a single step write — generalized here to every entry in a proposal's
   *  `steps` array, since `analyzeProposal` is the first caller to feed
   *  `toAnalyzeStepResponse` steps that never passed through that per-write gate. */
  private def validateStepKinds(steps: Vector[CreatePipelineTransactionalStepRequest]): Either[ServiceError, Unit] =
    steps.find(s => !PipelineStepKind.All.contains(s.`type`)) match {
      case Some(bad) =>
        Left(ServiceError.BadRequest(
          s"Invalid step type '${bad.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
        ))
      case None => Right(())
    }

  /** Inline-source branch of `resolveOneProposalRootSchema` (design.md D2). Every
   *  connector-backed case (`sql`/`rest_api`/`static`) checks its matching config
   *  `Option` for `None` *before* touching the config value — a recognized `type`
   *  with an absent `config` is a proven-reachable, structurally-valid-per-schema
   *  wire state (`PipelineProposalProtocol`'s hand-written reader independently maps
   *  an absent `"config"` key to `None` per branch), never a `.get`/unguarded match
   *  that would throw and surface as an unhandled 500. */
  private def resolveInlineSourceSchema(
      source:       PipelineProposalSource,
      fallbackName: String,
      user:         AuthenticatedUser
  ): Future[Either[ServiceError, (String, Vector[SchemaField])]] = {
    val name = source.name.getOrElse(fallbackName)
    source.`type` match {
      case Some(DataSourceKind.Sql) =>
        source.sqlConfig match {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("inline 'sql' source requires a 'config' object")))
          case Some(payload) =>
            val domainConfig = SqlSourceConfigPayload.toDomain(payload)
            SqlConnectorDriver.checkQuery(domainConfig.query) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(_) =>
                SqlConnectorDriver.inferSchema(domainConfig, ConnectorResolveContext.Internal).map {
                  case Left(err)     => Left(ServiceError.BadGateway(err))
                  case Right(schema) => Right((name, toSchemaFields(schema)))
                }
            }
        }
      case Some(DataSourceKind.RestApi) =>
        // HEL-822 design.md Decision 1c revised (round-3 CR3): a bare `url` resolves
        // ephemerally (never persists a Connector — a pipeline proposal is provisional); a
        // `connectorId` resolves the real Connector, ownership-scoped to the acting user.
        // HEL-829: `source.restConfig` is now `ProposalRestApiConfig` (task 1.1) — it has no
        // `auth` field at all (structurally incapable of carrying one, unlike the old
        // `RestApiConfigPayload`), so the `auth`-rejection guard that used to be needed here is
        // now enforced by the type itself. `RestApiConfigPayload.toDomain` still requires the
        // old shape, so the `connectorId`-branch payload is converted via
        // `ProposalRestApiConfig.toRestApiConfigPayload` first.
        source.restConfig match {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("inline 'rest_api' source requires a 'config' object")))
          case Some(payload) =>
            Option(connector) match {
              case None =>
                Future.successful(Left(ServiceError.InternalError("REST connector not configured")))
              case Some(c) =>
                (payload.connectorId, payload.url) match {
                  case (Some(_), Some(_)) =>
                    Future.successful(Left(ServiceError.BadRequest("provide exactly one of connectorId or url")))
                  case (None, None) =>
                    Future.successful(Left(ServiceError.BadRequest("Missing required fields: connectorId or url")))
                  case (Some(_), None) =>
                    RestApiConfigPayload.toDomain(ProposalRestApiConfig.toRestApiConfigPayload(payload)) match {
                      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
                      case Right(domainConfig) =>
                        c.inferSchema(domainConfig, ConnectorResolveContext.Owned(user)).map {
                          case Left(err)     => Left(ServiceError.BadGateway(err))
                          case Right(schema) => Right((name, toSchemaFields(schema)))
                        }
                    }
                  case (None, Some(url)) =>
                    val ephemeral = EphemeralRestConfig(
                      url             = url,
                      method          = payload.method.getOrElse("GET"),
                      headers         = payload.headers.getOrElse(Map.empty),
                      body            = payload.body,
                      bodyContentType = payload.bodyContentType,
                      rootSelector    = payload.rootSelector
                    )
                    c.inferSchemaEphemeral(ephemeral).map {
                      case Left(err)     => Left(ServiceError.BadGateway(err))
                      case Right(schema) => Right((name, toSchemaFields(schema)))
                    }
                }
            }
        }
      case Some(DataSourceKind.Static) =>
        source.staticConfig match {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("inline 'static' source requires a 'config' object")))
          case Some(payload) =>
            // HEL-906 cycle 4 (evaluation-3.md CR2): `c.type` is caller-supplied inline config
            // over the wire (analyze-proposal's inline static-source dry-analyze path) --
            // canonicalize before it becomes part of the projected schema, same as
            // DataSourceService.createStatic and PipelineAnalyzeService's producers.
            Future.successful(Right((name, payload.columns.map(c => SchemaField(c.name, DataFieldType.canonicalizeLegacy(c.`type`))))))
        }
      case Some(DataSourceKind.Csv) =>
        Future.successful(Left(ServiceError.BadRequest(
          "inline csv sources cannot be dry-analyzed — upload the file first (create the source) or reference its sourceId"
        )))
      case _ =>
        Future.successful(Left(ServiceError.BadRequest("source must reference an existing sourceId or declare an inline type")))
    }
  }

  private def toSchemaFields(schema: InferredSchema): Vector[SchemaField] =
    schema.fields.map(f => SchemaField(f.name, DataFieldType.asString(f.dataType))).toVector

  /** Map the analyze service's stringly-typed step output back into the
   *  discriminated-union wire shape by re-decoding the config blob into its
   *  typed `*Config` and constructing the appropriate per-subtype response. */
  private def toAnalyzeStepResponse(s: PipelineAnalyzeService.AnalyzedStep): AnalyzeStepResponse = {
    val inSchema  = s.inputSchema.map(toFieldResponse)
    val outSchema = s.outputSchema.map(toFieldResponse)
    PipelineStepConfigCodec.decode(s.op, s.config) match {
      case Success(cfg: RenameConfig)    => RenameAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: FilterConfig)    => FilterAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: JoinConfig)      => JoinAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: ComputeConfig)   => ComputeAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: GroupByConfig)   => GroupByAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: CastConfig)      => CastAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: SelectConfig)    => SelectAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: LimitConfig)     => LimitAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: SortConfig)      => SortAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: AggregateConfig) => AggregateAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: SplitTextConfig) => SplitTextAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: ExtractHeadingsConfig) => ExtractHeadingsAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: ChunkByTokenCountConfig) => ChunkByTokenCountAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: DateBucketConfig) => DateBucketAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: PivotConfig) => PivotAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: WindowConfig) => WindowAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: UnpivotConfig) => UnpivotAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: DedupeConfig) => DedupeAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: FillNullConfig) => FillNullAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: StringOpsConfig) => StringOpsAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: UnionConfig) => UnionAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: LookupConfig) => LookupAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: AssertConfig) => AssertAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(other) =>
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: codec returned unexpected config type ${other.getClass.getName} for op '${s.op}'"
        )
      // HEL-814: under D1 a caller-supplied config whose key is present but of
      // the wrong JSON type no longer decodes. On the PROPOSAL analyze
      // surface that config is right there in the request, and the shipped
      // `pipeline-step-config-validation` requirement is explicit that this
      // surface must REPORT the offending key rather than fail opaquely — the
      // whole point of driving it from the raw config text.
      //
      // `validateStepConfig` has already put that message in
      // `s.validationError` (it reads the raw config and returns the problem
      // instead of throwing, precisely so it survives the decode failure), so
      // the response is built from the kind's DEFAULT config with the real
      // information carried in `validationError`. Nothing is degraded
      // silently: the config shown is the type-correct empty one, the error
      // names the key, and nothing is executed or stored.
      //
      // A decode failure with NO validationError to explain it — malformed
      // JSON, an unknown op — still throws, exactly as before. Falling back
      // there would be the silent degradation this ticket exists to close.
      case Failure(ex) if s.validationError.nonEmpty =>
        PipelineStepConfigCodec.decode(s.op, "{}") match {
          case Success(_) =>
            toAnalyzeStepResponse(s.copy(config = "{}"))
          case Failure(_) =>
            throw new IllegalStateException(
              s"PipelineService.toAnalyzeStepResponse: failed to decode config for analyze step ${s.id}: ${ex.getMessage}",
              ex
            )
        }
      case Failure(ex) =>
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: failed to decode persisted config for analyze step ${s.id}: ${ex.getMessage}",
          ex
        )
    }
  }


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
  def addStep(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    // HEL-860: strict write-path check runs before the tolerant decode below,
    // so a mistyped `cast`/`rename` config is rejected instead of silently
    // persisted as a no-op. `None` (unregistered kind, or a kind that hasn't
    // opted in) falls through to the decode as before.
    val rawConfigError: Option[String] =
      PipelineStep.companionFor(req.`type`).toOption.flatMap(_.validateRawConfig(req.config.compactPrint))
    if (!PipelineStepKind.All.contains(req.`type`))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      )))
    else if (rawConfigError.isDefined)
      Future.successful(Left(ServiceError.UnprocessableEntity(rawConfigError.get)))
    else
      PipelineStepConfigCodec.decode(req.`type`, req.config.compactPrint) match {
        case Failure(ex) =>
          // HEL-311: keep the curated "Invalid '<type>' config" prefix, drop
          // the raw decode-exception tail; log the detail server-side.
          log.warn(s"addStep: config decode failed for step type '${req.`type`}'", ex)
          Future.successful(Left(ServiceError.BadRequest(
            s"Invalid '${req.`type`}' config"
          )))
        case Success(typedConfig) =>
          // Pre-flight ACL: the second, separately-owned DataSource a join/union/lookup
          // config references must be caller-owned (HEL-278/HEL-384/HEL-386). An EMPTY
          // second-source id (the picker's own defaultConfigFor seed value) is an
          // incomplete draft, not a security violation — nothing to leak against an
          // unset id, so `secondaryDataSourceId` returns `None` for it and the check is
          // skipped, same as for a config kind with no second source at all (HEL-620,
          // HEL-950: one shared extractor for all three ops, replacing three
          // hand-copied per-op blocks that had drifted out of sync).
          val aclCheckF: Future[Either[ServiceError, Unit]] =
            PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
              case Some(id) =>
                dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
                  case None    => Left(ServiceError.NotFound(s"Data source not found: $id"))
                  case Some(_) => Right(())
                }
              case None => Future.successful(Right(()))
            }
          // HEL-911 (design.md Engine contract items 6a/7, write-time arm): a `lane`-kind
          // secondaryInput must name an existing step of THIS pipeline that is not this
          // new step's own prospective ancestor. Computed against the current step list --
          // `req.parentStepId` takes precedence (mirrors `persistNewStep`'s own anchor
          // resolution) else falls back to trunk-last, the same default `persistNewStep`
          // uses for a bare append. `selfId = None`: the new step has no id yet.
          val laneCheckF: Future[Either[ServiceError, Unit]] =
            PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
              case None => Future.successful(Right(()))
              case Some(_) =>
                pipelineStepRepo.listByPipelineInternal(pipelineId).map { current =>
                  // HEL-911 evaluation-1.md CR2 (cycle 2): `trunkOf(current).lastOption` is
                  // the SAME deterministic "first position-0 child at each level" anchor
                  // `trunkOf`'s own scaladoc documents -- used here ONLY as the fallback when
                  // `req.parentStepId` is absent, exactly mirroring `persistNewStep`'s real
                  // placement logic below (`spliceInsertAtInternal`'s own no-explicit-parent
                  // branch), so the ancestor chain this cycle-check is computed against is
                  // always the SAME node the step will actually be anchored to -- never a
                  // silently different one.
                  val prospectiveParent: Option[PipelineStepId] =
                    req.parentStepId.map(PipelineStepId(_))
                      .orElse(pipelineStepRepo.trunkOf(current).lastOption.map(_.id))
                  val ancestors = PipelineService.ancestorChainOf(prospectiveParent, current)
                  PipelineService.validateLaneReference(typedConfig, current, ancestors, selfId = None)
                }
            }
          aclCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_)  =>
              laneCheckF.flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(_)  =>
                  pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
                    case None =>
                      Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
                    case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
                      // Grantee path — findByIdShared returned Some, so caller has viewer or editor access.
                      // Distinguish editor from viewer via requireEditorAccess before allowing mutation.
                      requireEditorAccess(pipelineId, user).flatMap {
                        case Left(err) => Future.successful(Left(err))
                        case Right(_) =>
                          // Safe: editor access confirmed. Use internal insert (no owner-JOIN).
                          persistNewStep(pipelineId, req, typedConfig, user)
                      }
                    case Some(_) =>
                      // Owner path — use internal insert (same as before, owner already confirmed)
                      persistNewStep(pipelineId, req, typedConfig, user)
                  }
              }
          }
      }
  }

  /** Shared persist branch for `addStep` (HEL-410) — called only after the
    * caller's editor-or-owner access has been confirmed by both branches
    * above. `req.position` absent keeps the pre-existing append behavior
    * (`insertInternal`, untouched); present validates it as a list index
    * (`0 <= position <= count`, count read fresh immediately before the
    * insert) and, if in range, splices via `spliceInsertAtInternal` (HEL-904
    * cycle-7 fix — see that method's doc for why a plain sibling-scoped
    * `insertAtInternal` call is not equivalent). Out-of-range values return
    * 422 with nothing persisted — the same
    * ServiceError variant `reorderSteps` uses for its own staleness check. */
  private def persistNewStep(
      pipelineId:  PipelineId,
      req:         CreatePipelineStepRequest,
      typedConfig: Any,
      user:        AuthenticatedUser
  ): Future[Either[ServiceError, PipelineStepResponse]] = {
    // HEL-412: absent `enabled` creates an enabled step (the pre-existing
    // implicit behavior, made explicit).
    val enabled = req.enabled.getOrElse(true)
    (req.parentStepId, req.rootId) match {
      case (Some(_), Some(_)) =>
        // HEL-913 task 7.3b: a step with a parent already has an implicit root -- naming
        // rootId too is contradictory, mirroring the identical rule the single-call
        // transactional create path enforces (resolveStepRootIndex's "both" case).
        Future.successful(Left(ServiceError.BadRequest(
          "Cannot name both parentStepId and rootId -- a step with a parent inherits its root implicitly"
        )))
      case (None, Some(rootIdRaw)) =>
        // HEL-913 task 7.3b: rootId is the alternative anchor to parentStepId -- the new step
        // becomes a trunk-continuation of THAT root, never the pipeline's first/lowest-
        // positioned root by silent default. Validated against this pipeline's OWN roots
        // (mirroring parentStepId's "must belong to this pipeline" check) before splicing.
        pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { roots =>
          roots.find(_._1.value == rootIdRaw) match {
            case None =>
              Future.successful(Left(ServiceError.UnprocessableEntity(s"rootId '$rootIdRaw' is not a root of this pipeline")))
            case Some((rootId, _)) =>
              pipelineStepRepo.spliceInsertAtInternal(pipelineId, req.`type`, typedConfig, None, enabled, explicitRootId = Some(rootId))
                .flatMap { step =>
                  audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                  stepResponseWithRoot(pipelineId, step).map(resp => Right(resp))
                }
                .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
          }
        }
      case (Some(parentStepIdRaw), None) =>
        // HEL-906 cycle 7 (task 3.2): an explicit parentStepId takes precedence over
        // `position` (documented on the request type) -- validate it belongs to THIS
        // pipeline before splicing, so a caller cannot anchor a new step onto an unrelated
        // pipeline's step id.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          if (!current.exists(_.id.value == parentStepIdRaw))
            Future.successful(Left(ServiceError.UnprocessableEntity(
              s"parentStepId '$parentStepIdRaw' is not a step of this pipeline"
            )))
          else {
            // HEL-908: `attachAsTail = true` uses the branch-attach primitive (new sibling,
            // no reparenting) instead of the default splice (insert-directly-after, reparenting
            // the anchor's existing children) -- see CreatePipelineStepRequest's doc comment.
            val persistF =
              if (req.attachAsTail.getOrElse(false))
                pipelineStepRepo.attachTailInternal(pipelineId, req.`type`, typedConfig, PipelineStepId(parentStepIdRaw), enabled)
              else
                // A parentStepId anchor makes `explicitRootId` irrelevant to the repo (root is
                // derived from the parent) -- see `spliceInsertAtInternal`'s own
                // `(Some(_), _) => None` branch. `None` here is exactly correct, not a
                // reintroduced silent default (task 7.3e).
                pipelineStepRepo.spliceInsertAtInternal(pipelineId, req.`type`, typedConfig, Some(PipelineStepId(parentStepIdRaw)), enabled, explicitRootId = None)
            persistF
              .flatMap { step =>
                audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                stepResponseWithRoot(pipelineId, step).map(resp => Right(resp))
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
          }
        }
      case (None, None) =>
        // HEL-913 task 7.3b: a parentless step naming NEITHER parentStepId nor rootId is
        // unambiguous (and byte-identical to pre-multi-root behavior) only when this pipeline
        // has exactly one root -- with more than one, "extend the trunk" doesn't say which
        // root's trunk, and that ambiguity is a named 400 rather than a silent default to the
        // pipeline's first/lowest-positioned root (the same rule `resolveStepRootIndex`'s
        // "neither" case enforces on the single-call transactional create path).
        pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { roots =>
          if (roots.size > 1)
            Future.successful(Left(ServiceError.BadRequest(
              s"This pipeline has ${roots.size} roots -- name one via rootId, or anchor via parentStepId"
            )))
          else req.position match {
      case None =>
        // HEL-904 cycle-9 fix (round-6 skeptic Finding 1): the no-`position`
        // default must extend the TRUNK, not create a root sibling.
        // `insertInternal`'s bare `parentStepId = None` default (still used
        // by test seeding and the standalone `insert` method) makes every
        // step after the first a root-level tail — `trunkOf` then returns
        // only the first step, so `PipelineRunService`'s node key
        // (`trunkOf(steps).lastOption`) and `PipelineProposalService`'s
        // Output binding (`createdSteps.lastOption`) diverge on the primary,
        // default step-creation path. Resolve the current trunk's last step
        // as the anchor and splice via `spliceInsertAtInternal` — the same
        // trunk-continuation primitive the explicit-`position`-at-end branch
        // below already uses. NOTE (round-8 correction): "no position" and
        // "position == count" are equivalent ONLY when the trunk-last step
        // has no existing tails. `executionOrder` emits a node's tails
        // immediately after that node and BEFORE its trunk continuation, so
        // on a tail-bearing pipeline `current(count - 1)` (used below) is a
        // tail, not trunk-last —
        // `position == count` then anchors on that tail, while the
        // no-`position` default here always anchors on trunk-last.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          val anchorParentId = pipelineStepRepo.trunkOf(current).lastOption.map(_.id)
          pipelineStepRepo.spliceInsertAtInternal(pipelineId, req.`type`, typedConfig, anchorParentId, enabled, explicitRootId = None)
            .flatMap { step =>
              audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
              stepResponseWithRoot(pipelineId, step).map(resp => Right(resp))
            }
            .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
        }
      case Some(index) =>
        // Safe: editor/owner access confirmed by the caller. Use internal list
        // (no owner-JOIN) so editor grantees are not blocked by the V35
        // pipeline_steps RLS owner-JOIN policy. Read close to the insert below.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          val count = current.size
          if (index < 0 || index > count) {
            Future.successful(Left(ServiceError.UnprocessableEntity(
              s"position must be between 0 and $count (the pipeline's current step count)"
            )))
          } else {
            // HEL-904 cycle-7 fix (round-4 skeptic Finding 1): `current` is
            // execution order (trunk/tail), not a flat root-sibling list --
            // `index` is a WHOLE-PIPELINE slot, not a sibling-scoped one.
            // Translate it into "splice in directly after the step at
            // index-1" (or at the pipeline root when index == 0) via
            // spliceInsertAtInternal, which re-parents whatever already
            // occupies that trunk slot rather than mis-renumbering a
            // sibling group that `insertAtInternal` would silently no-op
            // on for migrated (parent-chained) pipelines.
            val anchorParentId = if (index == 0) None else Some(current(index - 1).id)
            pipelineStepRepo.spliceInsertAtInternal(pipelineId, req.`type`, typedConfig, anchorParentId, enabled, explicitRootId = None)
              .flatMap { step =>
                audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                stepResponseWithRoot(pipelineId, step).map(resp => Right(resp))
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
          }
        }
          }
        }
    }
  }

  /** Step update — requires Editor or Owner. Viewer grantees get 403. */
  def updateStep(stepId: PipelineStepId, req: UpdatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    // Use internal findById (no owner-JOIN) since we only want to verify the step exists
    // and the type matches. The ACL check happens at the pipeline level below.
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        // Verify the caller has pipeline access (at least viewer) by finding the parent pipeline.
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            // Caller can't see the pipeline — step doesn't exist from their perspective.
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            // Check for editor/owner — viewers get 403.
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                req.`type` match {
                  case Some(t) if t != existing.kind =>
                    Future.successful(Left(ServiceError.BadRequest(
                      s"Cannot change step type from '${existing.kind}' to '$t'. " +
                        "Delete the step and create a new one instead."
                    )))
                  case _ =>
                    req.config match {
                      case None =>
                        // Safe: editor/owner access confirmed. Use internal update.
                        pipelineStepRepo.updateInternal(stepId, config = None, position = req.position, enabled = req.enabled)
                          .flatMap {
                            case Some(step) =>
                              audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                              stepResponseWithRoot(existing.pipelineId, step).map(resp => Right(resp))
                            case None       => Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
                          }
                          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                      case Some(cfgJson) =>
                        // HEL-860: strict write-path check runs before the tolerant
                        // decode below, mirroring addStep — see comment there.
                        val rawConfigError: Option[String] =
                          PipelineStep.companionFor(existing.kind).toOption.flatMap(_.validateRawConfig(cfgJson.compactPrint))
                        if (rawConfigError.isDefined)
                          Future.successful(Left(ServiceError.UnprocessableEntity(rawConfigError.get)))
                        else
                        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
                          case Failure(ex) =>
                            // HEL-311: keep the curated "Invalid '<type>' config" prefix,
                            // drop the raw decode-exception tail; log the detail server-side.
                            log.warn(s"updateStep: config decode failed for step type '${existing.kind}'", ex)
                            Future.successful(Left(ServiceError.BadRequest(
                              s"Invalid '${existing.kind}' config"
                            )))
                          case Success(typedConfig) =>
                            // Pre-flight ACL: the second, separately-owned DataSource a
                            // join/union/lookup config references must be caller-owned
                            // (HEL-278/HEL-384/HEL-386). An EMPTY second-source id is an
                            // incomplete draft, not a security violation — see the
                            // identical guard + rationale in addStep above (HEL-620,
                            // HEL-950: one shared extractor replacing three hand-copied
                            // per-op blocks).
                            val aclCheckF: Future[Either[ServiceError, Unit]] =
                              PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
                                case Some(id) =>
                                  dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
                                    case None    => Left(ServiceError.NotFound(s"Data source not found: $id"))
                                    case Some(_) => Right(())
                                  }
                                case None => Future.successful(Right(()))
                              }
                            // HEL-911 (design.md Engine contract items 6a/7, write-time arm):
                            // same check as `addStep`, but against the EXISTING step's actual
                            // parent chain and its own id (a step cannot reference itself).
                            val laneCheckF: Future[Either[ServiceError, Unit]] =
                              PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
                                case None => Future.successful(Right(()))
                                case Some(_) =>
                                  pipelineStepRepo.listByPipelineInternal(PipelineId(existing.pipelineId.value)).map { current =>
                                    val ancestors = PipelineService.ancestorChainOf(existing.parentStepId, current)
                                    PipelineService.validateLaneReference(typedConfig, current, ancestors, selfId = Some(existing.id.value))
                                  }
                              }
                            aclCheckF.flatMap {
                              case Left(err) => Future.successful(Left(err))
                              case Right(_)  =>
                                laneCheckF.flatMap {
                                  case Left(err) => Future.successful(Left(err))
                                  case Right(_)  =>
                                    // Safe: editor/owner access confirmed. Use internal update.
                                    pipelineStepRepo.updateInternal(stepId, config = Some(typedConfig), position = req.position, enabled = req.enabled)
                                      .flatMap {
                                        case Some(step) =>
                                          audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                                          stepResponseWithRoot(existing.pipelineId, step).map(resp => Right(resp))
                                        case None       => Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
                                      }
                                      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
  }

  /** Step delete — requires Editor or Owner. Viewer grantees get 403. */
  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, DeletePipelineStepResponse]] =
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                // Safe: editor/owner access confirmed. Use internal delete.
                // HEL-904 task 1.6 / HEL-906 cycle 7 (task 3.2): deleteInternal returns
                // Option[Int] (Some(removedTailStepCount) on success, None if the step
                // didn't exist) -- now surfaced to the caller as a splice-on-delete report,
                // instead of being discarded.
                pipelineStepRepo.deleteInternal(stepId).map {
                  case Some(removedTailStepCount) =>
                    audit("pipeline.step.delete", "pipeline_step", Some(stepId.value), user)
                    Right(DeletePipelineStepResponse(removedTailStepCount))
                  case None => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                }
            }
        }
    }

  /** Atomic TRUNK reorder (HEL-407, request-shape contract revised HEL-908 design.md decision
   *  15) — requires Editor or Owner. Viewer grantees get 403. `req.stepIds` must be exactly the
   *  pipeline's CURRENT TRUNK step ids (via `PipelineStepRepository.trunkOf`), in the desired
   *  new order — no tail ids, no missing/duplicate trunk ids; otherwise 422 with a message
   *  naming the specific violation (`PipelineStepRepository.reorderTrunkInternal`'s own
   *  validation, re-derived from a fresh read rather than trusted from this pre-check, so a
   *  race cannot silently corrupt structure). Per the human's ruling on trunk-to-trunk reorder
   *  ("the tail follows its trunk step"), a moved trunk node's tail travels with it automatically
   *  — no tail row is touched by this operation. */
  def reorderSteps(pipelineId: PipelineId, req: ReorderPipelineStepsRequest, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        val editorCheckF: Future[Either[ServiceError, Unit]] =
          if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
          else requireEditorAccess(pipeline.id, user)

        editorCheckF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            // HEL-913 task 7.3d-i (coordinator ruling): `reorderTrunkInternal`'s notion of "the
            // trunk" (`PipelineStepRepository.trunkOf`) is root-unaware, and its `idx == 0`
            // update writes `root_id` from `firstRootIdAction` (the pipeline's lowest-positioned
            // root) UNCONDITIONALLY -- on a multi-root pipeline this can silently reassign a
            // step from root B's trunk onto root A, a silent cross-root corruption, not merely
            // an ambiguity. Fenced closed here rather than left reachable: a named 400 when the
            // pipeline has more than one root, the same posture 7.3b takes for an ambiguous
            // parentless step. The actual multi-root reorder semantics (per-root vs. whole-
            // pipeline-interleaved) are HEL-973, blocked by this ticket -- not resolved here.
            pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { roots =>
              if (roots.size > 1)
                Future.successful(Left(ServiceError.BadRequest(
                  s"This pipeline has ${roots.size} roots -- reordering a multi-root pipeline's steps is not yet supported (HEL-973)"
                )))
              else
            // Safe: editor/owner access confirmed above. Use internal reorder — trunk-only
            // contract enforced inside reorderTrunkInternal against a fresh read, not trusted
            // from a pre-check here.
            pipelineStepRepo.reorderTrunkInternal(pipelineId, req.stepIds.map(PipelineStepId(_)))
              .flatMap {
                case Left(err) => Future.successful(Left(ServiceError.UnprocessableEntity(err)))
                case Right(steps) =>
                  // HEL-477 skeptic-final-1 round 1 (design.md Decision 7): ONE row per call,
                  // not one per step — metadata carries the resulting ordered step ids.
                  audit(
                    "pipeline.step.reorder",
                    "pipeline",
                    Some(pipelineId.value),
                    user,
                    JsObject("stepIds" -> JsArray(steps.map(s => JsString(s.id.value)).toVector))
                  )
                  // HEL-913 task 7.6a: `rootIdsOf` resolved once and threaded into every step's
                  // response, so the reordered response carries each step's real root id.
                  pipelineStepRepo.rootIdsOf(pipelineId).map { rootIdOfStep =>
                    Right(steps.map(s => PipelineStepResponse.fromDomain(s, rootIdOfStep.map { case (k, v) => k.value -> v.value })))
                  }
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
            }
        }
    }

  /** Duplicate a step (HEL-412) — requires Editor or Owner. Viewer grantees
   *  get 403; an unknown or invisible step masks as 404 (design.md
   *  Decision 4, the `updateStep` ACL pattern verbatim). Clones `kind`,
   *  `config`, and `enabled`, and inserts the clone directly after the
   *  original via `spliceInsertAtInternal` (HEL-904 cycle-7 fix: a real
   *  re-parenting splice, not a sibling-scoped renumber -- see that
   *  method's doc). */
  def duplicateStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] =
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
      case Some(existing) =>
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
          case Some(pipeline) =>
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)

            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  =>
                // design.md Decision 5: round-trip the persisted config through
                // the same typed encode/decode `addStep` uses — an unparseable
                // legacy row fails loudly (500-classified) rather than cloning
                // garbage.
                PipelineStepConfigCodec.decode(existing.kind, PipelineStepConfigCodec.encode(existing)) match {
                  case Failure(ex) =>
                    log.error(s"duplicateStep: config round-trip failed for step ${stepId.value} (kind='${existing.kind}')", ex)
                    Future.successful(Left(ServiceError.InternalError(s"Invalid '${existing.kind}' config")))
                  case Success(typedConfig) =>
                    // HEL-904 cycle-7 fix (round-4 skeptic Finding 1):
                    // `existing.id` IS the anchor -- the clone must become
                    // `existing`'s own trunk-continuation child so it lands
                    // directly after the original in executionOrder, with
                    // whatever `existing` used to continue to re-parented
                    // one hop further down by spliceInsertAtInternal.
                    // `insertAtInternal` (sibling-scoped renumber only) is
                    // NOT equivalent here: on a migrated (parent-chained)
                    // pipeline it silently appended the clone to the very
                    // end instead of splicing it in after the original --
                    // see spliceInsertAtInternal's doc for why.
                    // `Some(existing.id)` anchor makes `explicitRootId` irrelevant to the repo,
                    // same as every other parentStepId-anchored call site (task 7.3e).
                    pipelineStepRepo
                      .spliceInsertAtInternal(pipeline.id, existing.kind, typedConfig, Some(existing.id), existing.enabled, explicitRootId = None)
                      .flatMap { step =>
                        // HEL-477 skeptic-final-1 round 1: mirrors PanelService.duplicate's
                        // one-row-per-call convention; metadata carries the source stepId.
                        audit(
                          "pipeline.step.duplicate",
                          "pipeline_step",
                          Some(step.id.value),
                          user,
                          JsObject("sourceStepId" -> JsString(stepId.value))
                        )
                        stepResponseWithRoot(pipeline.id, step).map(resp => Right(resp))
                      }
                      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                }
            }
        }
    }


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

  private def toSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag
    )

  private def toFieldResponse(sf: SchemaField): SchemaFieldResponse =
    SchemaFieldResponse(sf.name, sf.`type`)
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
    case invalid: InvalidGraph =>
      log.warn(s"Pipeline step graph is invalid: ${invalid.message}")
      ServiceError.UnprocessableEntity(invalid.message)
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
