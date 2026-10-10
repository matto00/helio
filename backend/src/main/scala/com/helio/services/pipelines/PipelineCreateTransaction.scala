package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineStepConfigCodec, PipelineSummaryResponse}
import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, PipelineId, PipelineRootId, PipelineStepId}
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.{JoinConfig, LookupConfig, UnionConfig}
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineCycleGuard, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import spray.json._
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** The single-call transactional create (`createTransactional`) and the DBIO builders it composes. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineCreateTransaction(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    outputRepo: OutputRepository,
    support: PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  import support.{audit, validateOutputFieldMapping, resolveSecondarySourceSchemas, upsertOwnershipCheckF, toSummaryResponse}

  /** The single-call transactional path (`PipelineCreateWrites.create` delegates here only when `steps`/
   *  `outputs` are non-empty). `dataSources` is EVERY root's already-ACL-checked
   *  `(DataSourceId, DataSource)` pair, in request order (`create` resolves and authorizes every
   *  root via `resolveRootDataSources` before this is ever called) -- HEL-907 fix, see
   *  `validateStepCrossOwnerRefs` for every join/union/lookup step's cross-referenced source)
   *  runs OUTSIDE the transaction -- read-only ACL/existence checks, not writes, so they don't
   *  need to share the write transaction's atomicity.
   *
   *  HEL-913 task 7.3a/7.3a-i (R13): every step/Output's owning root is resolved to an INDEX
   *  into `dataSources` (`resolveStepRootIndex`/`resolveOutputRootIndex`) BEFORE the transaction
   *  is built, failing fast on a named/unresolvable/conflicting rootClientId with zero writes --
   *  the index is later translated to the REAL persisted root id (`rootIds`, returned by
   *  `pipelineRepo.createAction`) inside the DBIO chain, since no root has a real id until
   *  `createAction` actually inserts it. */
  private[pipelines] def createTransactional(
      req: CreatePipelineRequest,
      dataSources: Vector[(DataSourceId, DataSource)],
      rootIndices: PipelineCreatePreflight.RootIndices,
      user: AuthenticatedUser,
      tag: Option[String]
  ): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    val stepRootIdxs   = rootIndices.steps
    val outputRootIdxs = rootIndices.outputs
    // HEL-907 task 1.4: computed OUTSIDE the DBIO chain -- analyzeNodes is a pure,
    // in-memory function (no DB access), so there's no reason to pay for it inside the
    // transaction. `req.steps` (not the just-inserted rows) is the correct input: the
    // clientId keys this produces are exactly what `buildOutputsAction` already
    // resolves `nodeStepClientId` against. `sourceSchemasByRoot` is keyed by
    // INDEX-as-string (matching `NodeStepInput.rootId` below) since no root has a real
    // persisted id at this point in the call.
    val sourceSchemasByRoot: Map[String, Vector[SchemaField]] =
      dataSources.zipWithIndex.map { case ((_, ds), idx) => idx.toString -> ds.inferredSchema }.toMap
    val nodeInputsForAnalyze =
      req.steps.zip(stepRootIdxs).zipWithIndex.map { case ((s, rootIdxOpt), idx) =>
        PipelineAnalyzeService.NodeStepInput(
          id           = s.clientId,
          parentStepId = s.parentStepId,
          position     = idx,
          op           = s.`type`,
          config       = s.config.compactPrint,
          rootId       = rootIdxOpt.map(_.toString)
        )
      }
    // HEL-1236: cross-referenced sources already passed `validateStepCrossOwnerRefs` (run by `checkedCreate`).
    resolveSecondarySourceSchemas(nodeInputsForAnalyze.map(n => n.op -> n.config), dataSourceRepo.findByIdInternal).flatMap { secondarySchemas =>
      val analyzedNodes = PipelineAnalyzeService.analyzeNodes(nodeInputsForAnalyze, sourceSchemasByRoot, secondarySchemas)
      val action: DBIO[PipelineSummary] = for {
        createResult      <- pipelineRepo.createAction(req.name.trim, dataSources, user, tag)
        (summary, rootIds) = createResult
        stepIdMap         <- buildStepsAction(PipelineId(summary.id), req.steps, stepRootIdxs, rootIds, user.id.value)
        _                 <- buildOutputsAction(PipelineId(summary.id), req.outputs, outputRootIdxs, rootIds, stepIdMap, user, analyzedNodes, sourceSchemasByRoot)
      } yield summary

      pipelineRepo.runTransactionally(user.id.value)(action).map { summary =>
        audit("pipeline.create", "pipeline", Some(summary.id), user)
        Right(toSummaryResponse(summary))
      }.recover {
        case PipelineCreateValidationFailure(err)         => Left(err)
        case PipelineCycleGuard.PipelineCycleRejected(msg) => Left(ServiceError.BadRequest(msg))
        case ex                                            => Left(PipelineService.classifyDbError(ex))
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
  private[pipelines] def validateStepCrossOwnerRefs(
      steps: Vector[CreatePipelineTransactionalStepRequest],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] = {
    // HEL-1469: the request-scoped lane checks (HEL-911 CR5) moved to `PipelineCreatePreflight.laneChecks`,
    // which runs for every step BEFORE this ownership pass; only the read-only ownership lookups remain here.
    steps.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, step) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(()) =>
          PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
            case Failure(_) => Future.successful(Right(())) // buildStepsAction will reject this; not this check's job.
            case Success(typedConfig) =>
              // HEL-950: was three hand-copied per-op arms (join unconditional -- the same
              // unguarded-empty-id bug this change closes elsewhere -- union/lookup already
              // `.nonEmpty`-guarded); now driven by the one shared extractor so this call site
              // cannot drift from PipelineService.addStep/updateStep the way it already had.
              val crossOwnerF: Future[Either[ServiceError, Unit]] = PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
                case Some(id) => checkOwnedSource(id, user)
                case None     => Future.successful(Right(()))
              }
              crossOwnerF.flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(()) =>
                  // HEL-1100 (design.md Decision 1): `create()`'s caller IS the new pipeline's
                  // owner (there is no grantee at creation time), so `user.id` already IS
                  // `pipeline.ownerId` here -- unlike addStep/updateStep, no separate pipeline
                  // fetch is needed to know the owner.
                  upsertOwnershipCheckF(typedConfig, user.id, user)
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
      rootIds: Vector[PipelineRootId],
      // HEL-1101 skeptic-final-1.md CR1: threaded down to `insertInternalAction`'s own
      // `actingUserId` param -- the create path's cycle check (a new pipeline's roots + any
      // `upsertsource` step in this same request) needs the real acting caller, not the
      // insert-shaped default.
      actingUserId: String
  ): DBIO[Map[String, PipelineStepId]] =
    steps.zip(stepRootIdxs).foldLeft(DBIO.successful(Map.empty[String, PipelineStepId]): DBIO[Map[String, PipelineStepId]]) { (accAction, specAndRootIdx) =>
      val (spec, rootIdx) = specAndRootIdx
      accAction.flatMap { clientIdMap =>
        // HEL-1469: the request-only checks (duplicate clientId, type, parentStepId, strict config, decode,
        // forward lane reference) live in `PipelineCreatePreflight.checkStep`, which `create` has already run
        // for the whole request before any write; they run again here as defense in depth, with identical
        // messages and statuses by construction.
        PipelineCreatePreflight.checkStep(spec, clientIdMap.keySet) match {
          case Left(err) => DBIO.failed(PipelineCreateValidationFailure(err))
          case Right(typedConfig) =>
            val parentStepId = spec.parentStepId.map(clientIdMap(_))
            // HEL-911 skeptic-final-1.md cycle 3: a decoded `lane`-kind `secondaryInput.stepId` carries a
            // REQUEST-scoped clientId (validated by `PipelineCreatePreflight.laneChecks`), which must be
            // rewritten to the real, just-inserted `PipelineStepId` through the SAME `clientIdMap`
            // `parentStepId` uses -- otherwise the row persists a clientId no read path can resolve.
            // `checkStep` already refused a FORWARD lane reference (not yet in `clientIdMap`, since steps
            // are inserted strictly in request order), so the `Left` arm is unreachable defense.
            rewriteLaneClientId(typedConfig, clientIdMap) match {
              case Left(unresolvedClientId) =>
                DBIO.failed(PipelineCreateValidationFailure(ServiceError.BadRequest(
                  PipelineCreatePreflight.forwardLaneMessage(spec.clientId, unresolvedClientId)
                )))
              case Right(rewrittenConfig) =>
                pipelineStepRepo.insertInternalAction(pipelineId, spec.`type`, rewrittenConfig, spec.enabled.getOrElse(true), parentStepId, rootIdx.map(rootIds(_)), actingUserId)
                  .map(step => clientIdMap + (spec.clientId -> step.id))
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
        // HEL-1469: nodeStepClientId / name / kind / config-only checks are `PipelineCreatePreflight.checkOutput`
        // (already run for the whole request before any write; repeated here as defense in depth).
        PipelineCreatePreflight.checkOutput(spec, stepIdMap.keySet) match {
          case Left(err) => DBIO.failed(PipelineCreateValidationFailure(err))
          case Right(kind) =>
            val config = spec.config.getOrElse(JsObject.empty)
            val nodeSchema = spec.nodeStepClientId.flatMap(analyzedNodes.get).map(_.outputSchema)
              .getOrElse(rootIdx.flatMap(idx => sourceSchemasByRoot.get(idx.toString)).getOrElse(Vector.empty))
            validateOutputFieldMapping(kind, config, nodeSchema) match {
              case Left(err) => DBIO.failed(PipelineCreateValidationFailure(err))
              case Right(()) =>
                outputRepo.insertInternalAction(
                  pipelineId     = pipelineId,
                  nodeStepId     = spec.nodeStepClientId.map(stepIdMap(_)),
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
