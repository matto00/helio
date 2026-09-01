package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalApplyResponse, PipelineProposalSource, PipelineStepConfigCodec, ProposalOutputSummary, ProposalRestApiConfig}
import com.helio.api.protocols.sources.{CreateSourceRequest, CreateSourceResponse, DataSourceResponse, SqlCreateSourceRequest, StaticDataSourceRequest}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind, OutputKind, PipelineId, PipelineStep, PipelineStepKind}
import com.helio.domain.connectors.SqlConnectorDriver
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.api.protocols.pipelines.PipelineSummaryResponse

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Applies a reviewed pipeline proposal (HEL-379's schema, HEL-383's apply path).
 *
 *  Turns a `PipelineProposal` (an optionally-new source + a tree of steps +
 *  zero-or-more Outputs — HEL-907 task 1.1) into real resources by composing
 *  the EXISTING services — `SourceService`/`DataSourceService` (source, if
 *  inline) and `PipelineService` (pipeline + steps + Outputs, ONE composed
 *  transactional call, reusing P1.3/HEL-906's `POST /api/pipelines` single-
 *  call create path verbatim rather than re-deriving step/output creation
 *  here), and `PipelineRunService` (the run). It holds no persistence logic
 *  of its own: every write runs under the caller's RLS context via the
 *  composed services, and every delete during rollback goes through
 *  `DataSourceService.delete` / `PipelineService.delete` — never a raw
 *  repository call.
 *
 *  Atomicity: structural validation (mutual-exclusivity, inline-source
 *  name/config presence, the SQL read-only guardrail, step/output shape)
 *  all run up front with no side effects, mirroring
 *  `DashboardProposalService.validateStructure`. If a later step still fails
 *  (pipeline/step/output creation, or the run itself), every resource this
 *  call created is rolled back before the error is returned. Deleting the
 *  pipeline row alone is sufficient to roll back its steps AND Outputs (and
 *  any Output's placements) — both cascade via `ON DELETE CASCADE`
 *  (`pipeline_steps.pipeline_id`, V23; `outputs.pipeline_id` and
 *  `panels.output_id`, V94) — so rollback here never issues a separate
 *  Output delete the way the pre-HEL-907 single-implicit-output version did.
 *  HEL-755 exception: an inline `rest_api`/`sql` schema-fetch failure (at
 *  source-creation time) does not trigger rollback — the source is kept and
 *  it's reported as a durably-persisted `blocked` run instead (see
 *  `createPipeline`, `handleInlineCreated`). Separately, a resolved source
 *  whose kind the execution engine can't run at all
 *  (`PipelineRunService.SparkUnsupportedKinds` — currently empty, since
 *  HEL-758 made `rest_api`/`sql` both execution-supported) gets the same
 *  blocked-run-without-rollback treatment; that guard stays wired as a
 *  forward-looking extension point for a future genuinely-unrunnable kind. */
final class PipelineProposalService(
    sourceService: SourceService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    pipelineRunService: PipelineRunService,
    dataSourceRepo: DataSourceRepository,
    // HEL-907 task 1.1: used only to READ BACK the Outputs `pipelineService.create`'s
    // single transactional call already created (for the apply response / rollback
    // logging) -- never to write. Every Output write goes through `pipelineService.create`.
    outputRepo: OutputRepository
)(implicit ec: ExecutionContext) {

  import PipelineProposalService._

  /** Non-mutating structural + reference validation (HEL-662 design.md D3), required by that
   *  ticket's Hard Boundary — a `propose_pipeline` tool must never call [[apply]]. Runs the SAME
   *  [[validateStructure]] check `apply` uses, plus — ONLY for a reference to an *existing*
   *  `sourceId` — a read-only [[com.helio.infrastructure.DataSourceRepository.findByIdOwned]]
   *  existence/ownership check, mirroring `DashboardProposalService.validate`'s own "binding
   *  validation against real ids" shape. An *inline* source spec (kind=csv/rest/sql/static, no
   *  pre-existing id) gets structural validation only — resolving/creating it is exactly what
   *  [[resolveSource]] does, and a non-mutating validate cannot do that without itself becoming a
   *  mutation (accepted asymmetry, see design.md Risks). */
  def validate(proposal: PipelineProposal, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  => validateSourceReference(proposal.source, user)
    }

  private def validateSourceReference(source: PipelineProposalSource, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    source.sourceId match {
      case None => Future.successful(Right(()))
      case Some(sourceId) =>
        dataSourceRepo.findByIdOwned(DataSourceId(sourceId), user).map {
          case None    => Left(ServiceError.NotFound("Data source not found"))
          case Some(_) => Right(())
        }
    }

  def apply(
      proposal: PipelineProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineProposalApplyResponse]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        resolveSource(proposal.source, user).flatMap {
          case Left(err)       => Future.successful(Left(err))
          case Right(resolved) => createPipeline(proposal, resolved, user)
        }
    }

  // ── Structural pre-validation (design.md D1/D2) — no side effects ────────

  private[services] def validateStructure(proposal: PipelineProposal): Either[ServiceError, Unit] =
    for {
      _ <- requireNonBlank(proposal.pipelineName, "pipelineName")
      _ <- validateSourceSelector(proposal.source)
      _ <- validateSteps(proposal.steps)
      _ <- validateOutputs(proposal.outputs, proposal.steps)
    } yield ()

  private def requireNonBlank(value: String, field: String): Either[ServiceError, Unit] =
    if (value.trim.isEmpty) Left(ServiceError.BadRequest(s"$field is required")) else Right(())

  /** D1: `sourceId` and an inline `type` are mutually exclusive; exactly one
   *  of the two must be set. The `sourceId` branch's existence/ownership is
   *  checked later, at resolution time (a DB round-trip, not part of
   *  "structural" validation). */
  private def validateSourceSelector(source: PipelineProposalSource): Either[ServiceError, Unit] =
    (source.sourceId, source.`type`) match {
      case (Some(_), Some(_)) =>
        Left(ServiceError.BadRequest("source: specify either sourceId or an inline type, not both"))
      case (None, None) =>
        Left(ServiceError.BadRequest("source: sourceId or inline type is required"))
      case (Some(_), None) =>
        Right(())
      case (None, Some(kind)) =>
        validateInlineSource(kind, source)
    }

  /** D2: inline `type` must be a recognized kind; `name` and the type-matched
   *  `config` field must both be present BEFORE the `sql` query can be
   *  inspected (the query check would NPE-by-`.get` on an absent `sqlConfig`
   *  otherwise — round-3 skeptic finding). */
  private def validateInlineSource(kind: String, source: PipelineProposalSource): Either[ServiceError, Unit] =
    if (!InlineSourceKinds.contains(kind))
      Left(ServiceError.BadRequest(s"source.type must be one of ${InlineSourceKinds.toSeq.sorted.mkString(", ")}"))
    else if (source.name.forall(_.trim.isEmpty))
      Left(ServiceError.BadRequest("source.name is required for an inline source"))
    else
      kind match {
        case DataSourceKind.Csv     => requireConfig(source.csvConfig)
        case DataSourceKind.RestApi =>
          source.restConfig match {
            case None      => Left(ServiceError.BadRequest("source.config is required for an inline source"))
            case Some(cfg) => validateRestConfig(cfg)
          }
        case DataSourceKind.Static  => requireConfig(source.staticConfig)
        case DataSourceKind.Sql =>
          source.sqlConfig match {
            case None      => Left(ServiceError.BadRequest("source.config is required for an inline source"))
            case Some(cfg) => SqlConnectorDriver.checkQuery(cfg.query).left.map(ServiceError.BadRequest(_))
          }
      }

  private def requireConfig(config: Option[_]): Either[ServiceError, Unit] =
    if (config.isDefined) Right(())
    else Left(ServiceError.BadRequest("source.config is required for an inline source"))

  /** HEL-829 design.md Decision 2: exactly one of `connectorId`/`url`/
   *  `newConnector` must be present. `url` is kept (the legacy bare-URL path
   *  is still dual-supported via `SourceService.createRest`'s implicit-
   *  Connector synthesis, unchanged by this ticket). */
  private[services] def validateRestConfig(cfg: ProposalRestApiConfig): Either[ServiceError, Unit] = {
    val presentCount = Vector(cfg.connectorId, cfg.url, cfg.newConnector).count(_.isDefined)
    if (presentCount == 1) Right(())
    else Left(ServiceError.BadRequest(
      "source.config: exactly one of connectorId, url, or newConnector is required for a rest_api source"
    ))
  }

  /** Every step's `type` must be a recognized `PipelineStepKind`, its `config`
   *  must decode for that kind, `clientId` must be non-blank and unique
   *  within the proposal, and `parentStepId` (when present) must resolve to
   *  an EARLIER step's `clientId` in the same proposal (HEL-907 task 1.1 —
   *  mirrors `PipelineService.buildStepsAction`'s own transactional-create
   *  validation, kept in sync deliberately: both reject the same shapes, so
   *  a proposal that validates here is guaranteed to also pass
   *  `pipelineService.create`'s own re-validation at apply time). */
  private def validateSteps(steps: Vector[CreatePipelineTransactionalStepRequest]): Either[ServiceError, Unit] =
    steps.zipWithIndex.foldLeft[Either[ServiceError, (Set[String], Unit)]](Right((Set.empty[String], ()))) {
      case (Left(err), _) => Left(err)
      case (Right((seenClientIds, _)), (step, idx)) =>
        validateStep(step, idx, seenClientIds).map(_ => (seenClientIds + step.clientId, ()))
    }.map(_ => ())

  private def validateStep(step: CreatePipelineTransactionalStepRequest, idx: Int, seenClientIds: Set[String]): Either[ServiceError, Unit] =
    if (step.clientId.trim.isEmpty)
      Left(ServiceError.BadRequest(s"step ${idx + 1}: clientId is required"))
    else if (seenClientIds.contains(step.clientId))
      Left(ServiceError.BadRequest(s"step ${idx + 1}: duplicate clientId '${step.clientId}'"))
    else if (step.parentStepId.exists(p => !seenClientIds.contains(p)))
      Left(ServiceError.BadRequest(
        s"step ${idx + 1} ('${step.clientId}'): parentStepId '${step.parentStepId.get}' must be an earlier step's clientId in this same proposal"
      ))
    else if (!PipelineStepKind.All.contains(step.`type`))
      Left(ServiceError.BadRequest(
        s"step ${idx + 1}: invalid type '${step.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      ))
    else
      // HEL-814 D0/D2: checking only decode Success/Failure lets a wrong-shape config through,
      // because the decoder is contractually tolerant. 422 matches
      // `pipeline-step-config-rejection`'s status for a rejected config; the 400 below is kept
      // for the distinct "did not parse" case.
      PipelineStep.companionFor(step.`type`).toOption
        .flatMap(_.validateRawConfig(step.config.compactPrint)) match {
        case Some(msg) => Left(ServiceError.UnprocessableEntity(s"step ${idx + 1}: $msg"))
        case None =>
          PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
            case Success(_) => Right(())
            case Failure(_) => Left(ServiceError.BadRequest(s"step ${idx + 1}: invalid '${step.`type`}' config"))
          }
      }

  /** Every output's `name` must be non-blank, `kind` must be a recognized
   *  `OutputKind`, and `nodeStepClientId` (when present) must resolve to a
   *  `clientId` in `steps` — mirrors `PipelineService.buildOutputsAction`'s
   *  own transactional-create validation (same "kept in sync deliberately"
   *  rationale as `validateSteps`). */
  private def validateOutputs(
      outputs: Vector[CreatePipelineTransactionalOutputRequest],
      steps: Vector[CreatePipelineTransactionalStepRequest]
  ): Either[ServiceError, Unit] = {
    val stepClientIds = steps.map(_.clientId).toSet
    outputs.zipWithIndex.foldLeft[Either[ServiceError, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (output, idx)) =>
        if (output.name.trim.isEmpty)
          Left(ServiceError.BadRequest(s"output ${idx + 1}: name is required"))
        else if (output.nodeStepClientId.exists(c => !stepClientIds.contains(c)))
          Left(ServiceError.BadRequest(
            s"output ${idx + 1} ('${output.name}'): nodeStepClientId '${output.nodeStepClientId.get}' must be a step's clientId in this same proposal"
          ))
        else
          OutputKind.fromString(output.kind).left.map(ServiceError.BadRequest(_)).map(_ => ())
    }
  }

  private def resolveSource(
      source: PipelineProposalSource,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, ResolvedSource]] =
    (source.sourceId, source.`type`) match {
      case (Some(sourceId), _) =>
        resolveExistingSource(sourceId, user)
      case (None, Some(DataSourceKind.Csv)) =>
        // D3: schema-valid but apply-time-rejected — no bytes channel exists
        // in a JSON proposal for `DataSourceService.createCsv`'s upload path.
        Future.successful(Left(ServiceError.UnprocessableEntity(
          "inline csv sources are not supported by apply-proposal yet; create the CSV source separately and reference it via sourceId"
        )))
      case (None, Some(DataSourceKind.Sql))      => resolveSqlSource(source, user)
      case (None, Some(DataSourceKind.RestApi))  => resolveRestSource(source, user)
      case (None, Some(DataSourceKind.Static))   => resolveStaticSource(source, user)
      case _ =>
        // Unreachable: validateStructure already rejected every other shape.
        Future.successful(Left(ServiceError.BadRequest("source: sourceId or inline type is required")))
    }

  private def resolveExistingSource(sourceId: String, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] =
    dataSourceRepo.findByIdOwned(DataSourceId(sourceId), user).map {
      case None => Left(ServiceError.NotFound("Data source not found"))
      case Some(ds) =>
        Right(ResolvedSource(ds.id, responseForClient = None, createdByThisCall = false, kind = ds.kind))
    }

  private def resolveSqlSource(source: PipelineProposalSource, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] =
    source.sqlConfig match {
      case None => Future.successful(Left(ServiceError.BadRequest("source.config is required for an inline source")))
      case Some(cfg) =>
        sourceService.createSql(SqlCreateSourceRequest(inlineName(source), DataSourceKind.Sql, cfg), user).flatMap {
          case Left(err)  => Future.successful(Left(err))
          case Right(csr) => handleInlineCreated(csr, DataSourceKind.Sql, user)
        }
    }

  private def resolveRestSource(source: PipelineProposalSource, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] =
    source.restConfig match {
      case None => Future.successful(Left(ServiceError.BadRequest("source.config is required for an inline source")))
      case Some(cfg) =>
        sourceService
          .createRest(
            CreateSourceRequest(inlineName(source), DataSourceKind.RestApi, ProposalRestApiConfig.toRestApiConfigPayload(cfg), fieldOverrides = None),
            user
          )
          .flatMap {
            case Left(err)  => Future.successful(Left(err))
            case Right(csr) => handleInlineCreated(csr, DataSourceKind.RestApi, user)
          }
    }

  private def resolveStaticSource(source: PipelineProposalSource, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] =
    source.staticConfig match {
      case None => Future.successful(Left(ServiceError.BadRequest("source.config is required for an inline source")))
      case Some(cfg) =>
        dataSourceService
          .createStatic(StaticDataSourceRequest(inlineName(source), DataSourceKind.Static, cfg.columns, cfg.rows), user)
          .flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(ds) =>
              // HEL-904: no companion DataType to capture anymore — the inferred schema
              // lives on the source row itself, deleted automatically alongside it.
              Future.successful(Right(ResolvedSource(
                ds.id,
                responseForClient = Some(DataSourceResponse.fromDomain(ds)),
                createdByThisCall = true,
                kind              = DataSourceKind.Static
              )))
          }
    }

  /** Shared `rest_api`/`sql` post-create handling (design.md D1): a
   *  `fetchError` means schema inference failed and no inferred schema was
   *  ever populated for this source — the source is KEPT (not deleted) and
   *  the connector's curated message is threaded onto `ResolvedSource.fetchError`
   *  so `createPipeline` can surface it as a `blocked` run's `blockedReason`
   *  instead of aborting the whole apply. */
  private def handleInlineCreated(csr: CreateSourceResponse, kind: String, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] = {
    val sourceId = DataSourceId(csr.source.id)
    Future.successful(Right(ResolvedSource(
      sourceId,
      responseForClient = Some(csr.source),
      createdByThisCall = true,
      kind              = kind,
      fetchError        = csr.fetchError
    )))
  }

  private def inlineName(source: PipelineProposalSource): String =
    source.name.getOrElse("").trim


  /** Undo an already-successful `apply` result FROM OUTSIDE this service —
   *  e.g. a combined proposal (HEL-387) whose later dashboard phase fails
   *  after this service's own `apply` already succeeded. `apply`'s own
   *  `rollbackAll`/`rollbackSourceOnly` are private and only fire on
   *  `apply`'s own internal failures; this is the new, additive entry point
   *  for "this already succeeded, undo it now."
   *
   *  Deleting the pipeline cascades its steps, its Outputs, AND every
   *  Output's placements (V23/V94 `ON DELETE CASCADE`, see this class's own
   *  scaladoc) — no separate Output delete is issued. Then, if
   *  `response.source` is defined (meaning this proposal's own `apply`
   *  created it inline), the source is deleted too. Composed entirely
   *  through `pipelineService.delete`/`dataSourceService.delete` — never a
   *  raw repository call. */
  def rollback(response: PipelineProposalApplyResponse, user: AuthenticatedUser): Future[Unit] =
    pipelineService.delete(PipelineId(response.pipeline.id), user).flatMap { _ =>
      response.source match {
        case None         => Future.successful(())
        case Some(source) => dataSourceService.delete(DataSourceId(source.id), user).map(_ => ())
      }
    }

  // ── Pipeline + steps + outputs (ONE transactional call) + run, then rollback on any failure ──

  private def createPipeline(
      proposal: PipelineProposal,
      resolved: ResolvedSource,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineProposalApplyResponse]] =
    pipelineService
      .create(
        CreatePipelineRequest(
          name               = proposal.pipelineName.trim,
          sourceDataSourceId = resolved.id.value,
          tag                = None,
          steps              = proposal.steps,
          outputs            = proposal.outputs
        ),
        user
      )
      .flatMap {
        case Left(err) =>
          // Nothing pipeline-side to roll back — `create`'s transactional path is all-or-nothing,
          // so a Left here means nothing was persisted. The source (if this call created it)
          // still needs cleanup.
          rollbackSourceOnly(resolved, user).map(_ => Left(err))
        case Right(summary) =>
          val pipelineId = PipelineId(summary.id)
          outputRepo.listByPipelineInternal(pipelineId).flatMap { createdOutputs =>
            val outputSummaries = createdOutputs.map(o =>
              ProposalOutputSummary(o.id.value, o.name, OutputKind.asString(o.kind), o.node.stepId.map(_.value))
            )
            finishPipeline(pipelineId, outputSummaries, summary, resolved, user)
          }
      }

  /** Everything downstream of a successfully-created pipeline (+ steps +
   *  Outputs): the spark-unsupported/schema-fetch-failure blocked-run
   *  branch, and the real `submit` branch. */
  private def finishPipeline(
      pipelineId: PipelineId,
      outputs: Vector[ProposalOutputSummary],
      summary: PipelineSummaryResponse,
      resolved: ResolvedSource,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineProposalApplyResponse]] = {
    // design.md D2 (of HEL-755) + HEL-758 fix: TWO independent reasons never
    // reach `submit` — (a) the run engine can't execute this source kind AT
    // ALL regardless of connectivity (`SparkUnsupportedKinds`, currently
    // empty), or (b) THIS PARTICULAR inline source's schema-fetch already
    // failed at creation time (`resolved.fetchError.isDefined`). Skip
    // `submit` entirely and never roll back; the pipeline, source, and
    // Outputs are kept, and the response reports a durably-persisted
    // (design.md D3 of HEL-755) blocked run instead.
    if (PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind) || resolved.fetchError.isDefined) {
      val reason = resolved.fetchError match {
        case Some(err) =>
          s"Could not fetch from the source: $err. Fix the source configuration, then trigger a run " +
            "from the pipeline."
        case None =>
          s"${resolved.kind} sources aren't executed automatically yet — this pipeline was created without a run."
      }
      pipelineRunService.recordUnrunnable(pipelineId, reason, user).map { runResult =>
        Right(PipelineProposalApplyResponse(
          source   = resolved.responseForClient,
          pipeline = summary,
          outputs  = outputs,
          run      = runResult
        ))
      }
    } else {
      pipelineRunService.submit(pipelineId, isDry = false, user).flatMap {
        case Left(err) =>
          // D6: run failure is "a failure at any step" — full
          // rollback, not a partial success with run: null.
          rollbackAll(pipelineId, resolved, user).map(_ => Left(err))
        // HEL-570 (design.md Decision 8): a blocked run returns `Right`
        // with the Output(s) never populated — treated identically to a run
        // failure for rollback purposes, since a "success" response here
        // would point the caller at empty Outputs. Must be checked BEFORE
        // the unguarded `Right(runResult)` case.
        case Right(runResult) if runResult.blocked =>
          rollbackAll(pipelineId, resolved, user).map(_ => Left(
            ServiceError.UnprocessableEntity(runResult.blockedReason.getOrElse("Run blocked by an assertion failure"))
          ))
        case Right(runResult) =>
          Future.successful(Right(PipelineProposalApplyResponse(
            source   = resolved.responseForClient,
            pipeline = summary,
            outputs  = outputs,
            run      = runResult
          )))
      }
    }
  }

  /** Full rollback: pipeline (cascades steps/Outputs/placements/runs, see
   *  this class's own scaladoc) → the inline source (if this call created
   *  one). `sourceId` is always `None` by construction. */
  private def rollbackAll(
      pipelineId: PipelineId,
      resolved: ResolvedSource,
      user: AuthenticatedUser
  ): Future[Unit] =
    pipelineService.delete(pipelineId, user).flatMap { _ =>
      rollbackSourceOnly(resolved, user)
    }

  /** Deletes the inline source, if this call created one — its inferred schema lives
   *  inline (`data_sources.inferred_schema`), so there is no separate companion row to
   *  clean up. No-op for the `sourceId` branch (nothing was created). */
  private def rollbackSourceOnly(resolved: ResolvedSource, user: AuthenticatedUser): Future[Unit] =
    if (!resolved.createdByThisCall) Future.successful(())
    else dataSourceService.delete(resolved.id, user).map(_ => ())
}

object PipelineProposalService {

  private val InlineSourceKinds: Set[String] =
    Set(DataSourceKind.Csv, DataSourceKind.RestApi, DataSourceKind.Sql, DataSourceKind.Static)

  /** The resolved (existing or just-created) source, plus everything a later
   *  rollback needs so it never has to re-derive state that a prior delete
   *  already invalidated (design.md D5). `responseForClient` is `None` for
   *  the `sourceId` branch (nothing new to report) and `Some` for the inline
   *  branch. `kind` (design.md D2) is the resolved source's `DataSourceKind`
   *  string, populated at every resolution site — used by `createPipeline`
   *  to decide whether the run engine can execute this source at all.
   *  `fetchError` (design.md D1) carries the connector's curated message when
   *  an inline `rest_api`/`sql` schema fetch failed; `None` otherwise. */
  private[services] final case class ResolvedSource(
      id: DataSourceId,
      responseForClient: Option[DataSourceResponse],
      createdByThisCall: Boolean,
      kind: String,
      fetchError: Option[String] = None
  )
}
