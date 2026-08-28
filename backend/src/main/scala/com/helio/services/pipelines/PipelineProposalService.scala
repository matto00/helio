package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineStepRequest, PipelineProposal, PipelineProposalApplyResponse, PipelineProposalSource, PipelineStepConfigCodec, ProposalRestApiConfig}
import com.helio.api.protocols.sources.{CreateSourceRequest, CreateSourceResponse, DataSourceResponse, SqlCreateSourceRequest, StaticDataSourceRequest}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind, DataTypeId, PipelineId, PipelineStepKind}
import com.helio.domain.connectors.SqlConnectorDriver
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Applies a reviewed pipeline proposal (HEL-379's schema, HEL-383's apply path).
 *
 *  Turns a `PipelineProposal` (an optionally-new source + ordered steps + an
 *  output DataType contract) into real resources by composing the EXISTING
 *  services — `SourceService`/`DataSourceService` (source, if inline),
 *  `PipelineService` (pipeline + steps), and `PipelineRunService` (the run).
 *  It holds no persistence logic of its own: every write runs under the
 *  caller's RLS context via the composed services, and every delete during
 *  rollback goes through `DataSourceService.delete` / `DataTypeService.delete`
 *  / `PipelineService.delete` — never a raw repository call.
 *
 *  Atomicity: structural validation (mutual-exclusivity, inline-source
 *  name/config presence, the SQL read-only guardrail, step type/config
 *  decoding) all run up front with no side effects, mirroring
 *  `DashboardProposalService.validateStructure`. If a later step still fails
 *  (step creation or the run itself), every resource this call created is
 *  rolled back before the error is returned — see design.md D5 (of HEL-383)
 *  for why the deletion order (pipeline → output DataType → source →
 *  companion DataType) is the only order that's actually safe given the
 *  FK-cascade asymmetries documented there. HEL-755 exception: an inline
 *  `rest_api`/`sql` schema-fetch failure (at source-creation time) does not
 *  trigger rollback — the source is kept and it's reported as a durably-
 *  persisted `blocked` run instead (see `createPipeline`, `handleInlineCreated`).
 *  Separately, a resolved source whose kind the execution engine can't run at
 *  all (`PipelineRunService.SparkUnsupportedKinds` — currently empty, since
 *  HEL-758 made `rest_api`/`sql` both execution-supported) gets the same
 *  blocked-run-without-rollback treatment; that guard stays wired as a
 *  forward-looking extension point for a future genuinely-unrunnable kind. */
final class PipelineProposalService(
    sourceService: SourceService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    pipelineRunService: PipelineRunService,
    dataTypeService: DataTypeService,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository
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
      _ <- requireNonBlank(proposal.outputDataTypeName, "outputDataTypeName")
      _ <- validateSourceSelector(proposal.source)
      _ <- validateSteps(proposal.steps)
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

  /** Every step's `type` must be a recognized `PipelineStepKind`, and its
   *  `config` must decode for that kind — catches malformed step configs
   *  before creation begins (mirrors `preValidateBindings`'s "fail before any
   *  side effect" contract). */
  private def validateSteps(steps: Vector[CreatePipelineStepRequest]): Either[ServiceError, Unit] =
    steps.zipWithIndex.foldLeft[Either[ServiceError, Unit]](Right(())) {
      case (Left(err), _)           => Left(err)
      case (Right(_), (step, idx))  => validateStep(step, idx)
    }

  private def validateStep(step: CreatePipelineStepRequest, idx: Int): Either[ServiceError, Unit] =
    if (!PipelineStepKind.All.contains(step.`type`))
      Left(ServiceError.BadRequest(
        s"step ${idx + 1}: invalid type '${step.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      ))
    else
      PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
        case Success(_) => Right(())
        case Failure(_) => Left(ServiceError.BadRequest(s"step ${idx + 1}: invalid '${step.`type`}' config"))
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
        Right(ResolvedSource(ds.id, responseForClient = None, createdByThisCall = false, companionDataTypeIds = Vector.empty, kind = ds.kind))
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
              // No CreateSourceResponse envelope for static (DataSourceService.createStatic
              // returns the bare DataSource) — capture the companion DataType's id NOW,
              // while the source still exists, so a later rollback never has to
              // re-derive it via findBySourceId after the source is already gone
              // (design.md D5 — that query would return nothing post-delete).
              dataTypeRepo.findBySourceId(ds.id, user.id).map { companions =>
                Right(ResolvedSource(
                  ds.id,
                  responseForClient    = Some(DataSourceResponse.fromDomain(ds)),
                  createdByThisCall    = true,
                  companionDataTypeIds = companions.map(_.id),
                  kind                 = DataSourceKind.Static
                ))
              }
          }
    }

  /** Shared `rest_api`/`sql` post-create handling (design.md D1): a
   *  `fetchError` means schema inference failed and no DataType was ever
   *  inserted for this source (`CreateSourceEnvelope`'s `Left` path never
   *  calls `dataTypeRepo.insert`) — the source is KEPT (not deleted) and the
   *  connector's curated message is threaded onto `ResolvedSource.fetchError`
   *  so `createPipeline` can surface it as a `blocked` run's `blockedReason`
   *  instead of aborting the whole apply. Otherwise capture the companion
   *  DataType id created alongside the source, directly off the response (no
   *  extra query needed). */
  private def handleInlineCreated(csr: CreateSourceResponse, kind: String, user: AuthenticatedUser): Future[Either[ServiceError, ResolvedSource]] = {
    val sourceId = DataSourceId(csr.source.id)
    val companionIds = csr.dataType.map(dt => DataTypeId(dt.id)).toVector
    Future.successful(Right(ResolvedSource(
      sourceId,
      responseForClient    = Some(csr.source),
      createdByThisCall    = true,
      companionDataTypeIds = companionIds,
      kind                 = kind,
      fetchError           = csr.fetchError
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
   *  Same delete order as `rollbackAll`: pipeline (cascades steps/runs) →
   *  output DataType → (if `response.source` is defined, meaning this
   *  proposal's own `apply` created it inline) the source → its companion
   *  DataType(s). Since `rollback` runs BEFORE any of ITS OWN deletes have
   *  happened yet, a fresh `dataTypeRepo.findBySourceId` read here is safe —
   *  unlike inside `apply`'s rollback, where that query would return nothing
   *  once issued after the source delete (design.md D5). Composed entirely
   *  through `pipelineService.delete`/`dataTypeService.delete`/
   *  `dataSourceService.delete` — never a raw repository call. No existing
   *  method in this file is modified. */
  def rollback(response: PipelineProposalApplyResponse, user: AuthenticatedUser): Future[Unit] =
    pipelineService.delete(PipelineId(response.pipeline.id), user).flatMap { _ =>
      dataTypeService.delete(DataTypeId(response.outputDataTypeId), user).flatMap { _ =>
        response.source match {
          case None => Future.successful(())
          case Some(source) =>
            val sourceId = DataSourceId(source.id)
            dataTypeRepo.findBySourceId(sourceId, user.id).flatMap { companions =>
              dataSourceService.delete(sourceId, user).flatMap { _ =>
                Future.sequence(companions.map(dt => dataTypeService.delete(dt.id, user))).map(_ => ())
              }
            }
        }
      }
    }

  // ── Pipeline + steps + run, then rollback on any failure (design.md D5/D6) ─

  private def createPipeline(
      proposal: PipelineProposal,
      resolved: ResolvedSource,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, PipelineProposalApplyResponse]] =
    pipelineService
      .create(CreatePipelineRequest(proposal.pipelineName.trim, resolved.id.value, proposal.outputDataTypeName.trim), user)
      .flatMap {
        case Left(err) =>
          // Nothing pipeline-side to roll back yet; the source (if this call
          // created it) still needs cleanup.
          rollbackSourceOnly(resolved, user).map(_ => Left(err))
        case Right(summary) =>
          val pipelineId = PipelineId(summary.id)
          addSteps(pipelineId, proposal.steps, user).flatMap {
            case Left(err) =>
              rollbackAll(pipelineId, summary.outputDataTypeId, resolved, user).map(_ => Left(err))
            // design.md D2 (of HEL-755) + HEL-758 fix: TWO independent reasons
            // never reach `submit` — (a) the run engine can't execute this
            // source kind AT ALL regardless of connectivity
            // (`SparkUnsupportedKinds`, currently empty), or (b) THIS
            // PARTICULAR inline source's schema-fetch already failed at
            // creation time (`resolved.fetchError.isDefined`). (b) is
            // unconditional on kind and is NOT superseded by HEL-758 — the
            // base `pipeline-proposal-apply` spec's "Source-fetch failure is a
            // structured, rolled-back error" requirement is untouched by this
            // change (not in its MODIFIED Requirements) and the ticket's own
            // acceptance criteria are explicit that this fail-safe path must
            // stay intact for a genuinely unreachable/misconfigured source.
            // Emptying `SparkUnsupportedKinds` alone would have silently
            // dropped (b) for rest_api/sql, since both were previously gated
            // by the SAME single condition — caught by PipelineApplyProposal-
            // RollbackSpec's schema-fetch-failure tests actually failing
            // (422/rollback instead of 201/blocked) once (a) alone was used.
            // Skip `submit` entirely and never roll back; the pipeline and
            // source are kept, and the response reports a durably-persisted
            // (design.md D3 of HEL-755) blocked run instead. Must be checked
            // BEFORE the unguarded `Right(_)` case below.
            case Right(_) if PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind) || resolved.fetchError.isDefined =>
              val reason = resolved.fetchError match {
                // HEL-758: dropped the old "...once ${resolved.kind} execution
                // is supported" tail — rest_api/sql execution IS supported now
                // (SparkUnsupportedKinds is empty); this specific source
                // instance is what's unreachable, not the kind.
                case Some(err) =>
                  s"Could not fetch from the source: $err. Fix the source configuration, then trigger a run " +
                    "from the pipeline."
                case None =>
                  s"${resolved.kind} sources aren't executed automatically yet — this pipeline was created without a run."
              }
              pipelineRunService.recordUnrunnable(pipelineId, reason, user).map { runResult =>
                Right(PipelineProposalApplyResponse(
                  source           = resolved.responseForClient,
                  pipeline         = summary,
                  outputDataTypeId = summary.outputDataTypeId,
                  run              = runResult
                ))
              }
            case Right(_) =>
              // This case now reaches `submit` for every source kind the
              // engine can execute — `static`/`csv`/`text`/`pdf`/`image`, and
              // (HEL-758) a HEALTHY `rest_api`/`sql` source (fetchError =
              // None), since `runPipeline` no longer hardcodes a rejection
              // for the latter two. The guarded case above intercepts either
              // a kind listed in the (currently empty) `SparkUnsupportedKinds`
              // set, or any inline source whose schema-fetch already failed.
              pipelineRunService.submit(pipelineId, isDry = false, user).flatMap {
                case Left(err) =>
                  // D6: run failure is "a failure at any step" — full
                  // rollback, not a partial success with run: null.
                  rollbackAll(pipelineId, summary.outputDataTypeId, resolved, user).map(_ => Left(err))
                // HEL-570 (design.md Decision 8): a blocked run returns `Right`
                // with the output DataType never populated — treated identically
                // to a run failure for rollback purposes, since a "success"
                // response here would point the caller at an empty DataType.
                // Must be checked BEFORE the unguarded `Right(runResult)` case.
                case Right(runResult) if runResult.blocked =>
                  rollbackAll(pipelineId, summary.outputDataTypeId, resolved, user).map(_ => Left(
                    ServiceError.UnprocessableEntity(runResult.blockedReason.getOrElse("Run blocked by an assertion failure"))
                  ))
                case Right(runResult) =>
                  Future.successful(Right(PipelineProposalApplyResponse(
                    source            = resolved.responseForClient,
                    pipeline          = summary,
                    outputDataTypeId  = summary.outputDataTypeId,
                    run               = runResult
                  )))
              }
          }
      }

  /** Create steps in proposal order, short-circuiting on the first failure. */
  private def addSteps(
      pipelineId: PipelineId,
      steps: Vector[CreatePipelineStepRequest],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    steps.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, step) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(_)  => pipelineService.addStep(pipelineId, step, user).map(_.map(_ => ()))
      }
    }

  /** design.md D5's full rollback order: pipeline (cascades steps/runs) →
   *  pipeline's output DataType (`sourceId` is always `None` by construction,
   *  so `checkSourceLink` passes trivially) → the inline source (if this call
   *  created it) → its companion DataType(s), using the id(s) already
   *  captured at creation time — never re-queried after the source is gone. */
  private def rollbackAll(
      pipelineId: PipelineId,
      outputDataTypeId: String,
      resolved: ResolvedSource,
      user: AuthenticatedUser
  ): Future[Unit] =
    pipelineService.delete(pipelineId, user).flatMap { _ =>
      dataTypeService.delete(DataTypeId(outputDataTypeId), user).flatMap { _ =>
        rollbackSourceOnly(resolved, user)
      }
    }

  /** Deletes the inline source FIRST (nulls the companion DataType's
   *  `sourceId` via `ON DELETE SET NULL`), then the companion DataType(s) —
   *  `checkSourceLink` would reject the companion delete if run before the
   *  source is gone. No-op for the `sourceId` branch (nothing was created). */
  private def rollbackSourceOnly(resolved: ResolvedSource, user: AuthenticatedUser): Future[Unit] =
    if (!resolved.createdByThisCall) Future.successful(())
    else
      dataSourceService.delete(resolved.id, user).flatMap { _ =>
        Future.sequence(resolved.companionDataTypeIds.map(id => dataTypeService.delete(id, user))).map(_ => ())
      }
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
      companionDataTypeIds: Vector[DataTypeId],
      kind: String,
      fetchError: Option[String] = None
  )
}
