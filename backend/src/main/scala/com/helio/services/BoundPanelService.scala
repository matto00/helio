package com.helio.services

import com.helio.api.protocols.{
  BoundPanelRequest,
  BoundPanelResponse,
  CreatePanelRequest,
  CreatePipelineRequest,
  CreatePipelineStepRequest,
  PanelResponse,
  StaticDataSourceRequest
}
import com.helio.domain.{AuthenticatedUser, DashboardId, DataSourceId, DataTypeId, PanelType, PipelineId, ResourceAccess, SchemaField}
import com.helio.domain.PipelineAnalyzeService
import com.helio.domain.panels.PanelBindingSpec
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DataTypeRowRepository, PanelRepository}
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** Business logic for `POST /api/panels/bound` (HEL-364) — one call composing
 *  source (create-or-reuse) → pipeline+steps → synchronous run → panel
 *  create+bind, returning every id created (or reused) with rows already
 *  present.
 *
 *  Composes the existing services read-only where possible ([[DataSourceService]],
 *  [[PipelineService]], [[PipelineRunService]], [[PanelService]]) — no new
 *  tables, same DI pattern as [[DashboardContentsService]] (a repo — here
 *  [[DataSourceRepository]]/[[DataTypeRepository]]/[[DataTypeRowRepository]]/
 *  [[PanelRepository]] — alongside the services whose own construction logic
 *  is reused). See design.md for the full D1-D7 rationale; this file follows
 *  it directly. */
final class BoundPanelService(
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    pipelineRunService: PipelineRunService,
    panelService: PanelService,
    dataSourceRepo: DataSourceRepository,
    dataTypeRepo: DataTypeRepository,
    dataTypeRowRepo: DataTypeRowRepository,
    panelRepo: PanelRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  import BoundPanelService.Gate

  def create(request: BoundPanelRequest, user: AuthenticatedUser): Future[Either[ServiceError, BoundPanelResponse]] =
    validate(request, user).flatMap {
      case Left(err)   => Future.successful(Left(err))
      case Right(gate) => resolveSource(request, gate, user)
    }

  // ── Validate-before-first-write gate (design.md D3) ────────────────────────

  private def validate(request: BoundPanelRequest, user: AuthenticatedUser): Future[Either[ServiceError, Gate]] = {
    val dashboardIdOpt = Option(request.dashboardId).map(_.trim).filter(_.nonEmpty)
    val hasInline      = request.source.isDefined
    val hasExisting    = request.sourceDataSourceId.exists(_.trim.nonEmpty)

    (dashboardIdOpt, hasInline, hasExisting) match {
      case (None, _, _) =>
        Future.successful(Left(ServiceError.BadRequest("dashboardId is required")))
      case (_, true, true) =>
        Future.successful(Left(ServiceError.BadRequest("Exactly one of 'source' or 'sourceDataSourceId' is required, not both")))
      case (_, false, false) =>
        Future.successful(Left(ServiceError.BadRequest("Exactly one of 'source' or 'sourceDataSourceId' is required")))
      case (Some(dashboardIdStr), _, _) =>
        PanelType.fromString(request.panel.`type`) match {
          case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
          case Right(panelType) =>
            PanelBindingSpec.DataBindable.find(_.panelType == panelType) match {
              case None =>
                Future.successful(Left(ServiceError.BadRequest(
                  s"Panel type '${PanelType.asString(panelType)}' cannot be created via POST /api/panels/bound; use POST /api/panels directly"
                )))
              case Some(spec) =>
                val dashboardId = DashboardId(dashboardIdStr)
                accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").flatMap {
                  case Left(err)                    => Future.successful(Left(err))
                  case Right(ResourceAccess.Viewer) => Future.successful(Left(ServiceError.Forbidden()))
                  case Right(_)                     => validateBinding(request, spec, dashboardId, panelType, user)
                }
            }
        }
    }
  }

  /** Resolve the source schema (inline `source.columns`, or a read-only
   *  lookup of an existing `sourceDataSourceId`'s companion DataType),
   *  project it through `pipeline.steps` via `PipelineAnalyzeService.analyze`
   *  (pure, zero writes), and evaluate the projected schema against
   *  `spec` via the shared `PanelBindingSpec.evaluate` (task 1.2). */
  private def validateBinding(
      request: BoundPanelRequest,
      spec: PanelBindingSpec,
      dashboardId: DashboardId,
      panelType: PanelType,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Gate]] =
    resolveSourceSchema(request, user).map {
      case Left(err) => Left(err)
      case Right(sourceSchema) =>
        val projected = projectSchema(request.pipeline.steps, sourceSchema)
        val result     = PanelBindingSpec.evaluate(spec, projected)
        if (result.bindable) Right(Gate(dashboardId, panelType))
        else Left(ServiceError.BadRequest(result.message.getOrElse("Unsatisfiable panel binding")))
    }

  private def resolveSourceSchema(request: BoundPanelRequest, user: AuthenticatedUser): Future[Either[ServiceError, Vector[SchemaField]]] =
    request.source match {
      case Some(spec) =>
        Future.successful(Right(spec.columns.map(c => SchemaField(c.name, c.`type`))))
      case None =>
        val sourceId = DataSourceId(request.sourceDataSourceId.get.trim)
        dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("DataSource not found")))
          case Some(_) =>
            dataTypeRepo.findBySourceId(sourceId, user.id).map { companions =>
              companions.headOption match {
                case Some(dt) => Right(dt.fields.map(f => SchemaField(f.name, f.dataType)))
                case None     => Left(ServiceError.UnprocessableEntity("DataSource has no associated schema"))
              }
            }
        }
    }

  private def projectSchema(steps: Vector[CreatePipelineStepRequest], sourceSchema: Vector[SchemaField]): Vector[SchemaField] = {
    // HEL-412 (design.md Decision 3, boundary v): a step definition carrying
    // `enabled: false` is treated as absent, mirroring the live analyze
    // endpoint's own exclusion.
    val enabledSteps = steps.filter(_.enabled.getOrElse(true))
    val stepInputs = enabledSteps.zipWithIndex.map { case (step, idx) =>
      PipelineAnalyzeService.PipelineStepInput(id = idx.toString, position = idx, op = step.`type`, config = step.config.compactPrint)
    }
    PipelineAnalyzeService.analyze(stepInputs, sourceSchema).lastOption.map(_.outputSchema).getOrElse(sourceSchema)
  }

  // ── Execution chain (design.md D4) ─────────────────────────────────────────

  private def resolveSource(
      request: BoundPanelRequest,
      gate: Gate,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, BoundPanelResponse]] =
    request.source match {
      case Some(spec) =>
        val staticReq = StaticDataSourceRequest(name = spec.name, `type` = "static", columns = spec.columns, rows = spec.rows)
        dataSourceService.createStatic(staticReq, user).recover(unexpected).flatMap {
          case Left(err) =>
            // Stage 1 failure: nothing else exists yet (design.md D5) — no cleanup.
            Future.successful(Left(stageError("source", err)))
          case Right(source) =>
            createPipeline(request, gate, user, sourceId = source.id, inlineSource = true)
        }
      case None =>
        // Gate already confirmed this id exists and is owned by `user`.
        createPipeline(request, gate, user, sourceId = DataSourceId(request.sourceDataSourceId.get.trim), inlineSource = false)
    }

  private def createPipeline(
      request: BoundPanelRequest,
      gate: Gate,
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      inlineSource: Boolean
  ): Future[Either[ServiceError, BoundPanelResponse]] = {
    val pipelineName = request.pipeline.name.map(_.trim).filter(_.nonEmpty)
      .getOrElse(s"${request.pipeline.outputDataTypeName.trim} pipeline")
    val createReq = CreatePipelineRequest(
      name               = pipelineName,
      sourceDataSourceId = sourceId.value,
      outputDataTypeName = request.pipeline.outputDataTypeName
    )
    pipelineService.create(createReq, user).recover(unexpected).flatMap {
      case Left(err) =>
        cleanup(outputDataTypeIdOpt = None, inlineSourceIdOf(sourceId, inlineSource), user)
          .map(_ => Left(stageError("pipeline", err)))
      case Right(summary) =>
        addSteps(request, gate, user, sourceId, inlineSource, PipelineId(summary.id), DataTypeId(summary.outputDataTypeId), request.pipeline.steps)
    }
  }

  private def addSteps(
      request: BoundPanelRequest,
      gate: Gate,
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      inlineSource: Boolean,
      pipelineId: PipelineId,
      outputDataTypeId: DataTypeId,
      remaining: Vector[CreatePipelineStepRequest]
  ): Future[Either[ServiceError, BoundPanelResponse]] =
    remaining.headOption match {
      case None =>
        runPipeline(request, gate, user, sourceId, inlineSource, pipelineId, outputDataTypeId)
      case Some(step) =>
        pipelineService.addStep(pipelineId, step, user).recover(unexpected).flatMap {
          case Left(err) =>
            cleanup(Some(outputDataTypeId), inlineSourceIdOf(sourceId, inlineSource), user)
              .map(_ => Left(stageError("steps", err)))
          case Right(_) =>
            addSteps(request, gate, user, sourceId, inlineSource, pipelineId, outputDataTypeId, remaining.tail)
        }
    }

  private def runPipeline(
      request: BoundPanelRequest,
      gate: Gate,
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      inlineSource: Boolean,
      pipelineId: PipelineId,
      outputDataTypeId: DataTypeId
  ): Future[Either[ServiceError, BoundPanelResponse]] =
    // design.md D6: a zero-row `Right(...)` is success, not failure — only a
    // `Left` (engine exception, unsupported source type, etc.) triggers cleanup.
    pipelineRunService.submit(pipelineId, isDry = false, user).recover(unexpected).flatMap {
      case Left(err) =>
        cleanup(Some(outputDataTypeId), inlineSourceIdOf(sourceId, inlineSource), user)
          .map(_ => Left(stageError("run", err)))
      // HEL-570 (design.md Decision 8): a blocked first run returns `Right`
      // with no rows ever written to the output DataType — there is no
      // prior-good snapshot to fall back on for a brand-new pipeline, so this
      // is treated identically to a `Left` run failure: same cleanup path,
      // same stage-tagged error shape. Must be checked BEFORE the unguarded
      // `Right(_)` case below.
      case Right(r) if r.blocked =>
        cleanup(Some(outputDataTypeId), inlineSourceIdOf(sourceId, inlineSource), user)
          .map(_ => Left(stageError("run", ServiceError.UnprocessableEntity(
            r.blockedReason.getOrElse("Run blocked by an assertion failure")
          ))))
      case Right(_) =>
        createPanel(request, gate, user, sourceId, inlineSource, pipelineId, outputDataTypeId)
    }

  private def createPanel(
      request: BoundPanelRequest,
      gate: Gate,
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      inlineSource: Boolean,
      pipelineId: PipelineId,
      outputDataTypeId: DataTypeId
  ): Future[Either[ServiceError, BoundPanelResponse]] = {
    val config = injectBinding(request.panel.config, outputDataTypeId, request.fieldMapping)
    val createPanelReq = CreatePanelRequest(
      dashboardId = Some(gate.dashboardId.value),
      title       = Some(request.panel.title),
      `type`      = Some(request.panel.`type`),
      config      = Some(config),
      appearance  = request.panel.appearance
    )
    // buildForCreate is `private[services]` on PanelService — reuses HEL-363's
    // exact config-decode/appearance-resolve/rejectCompanionBinding path, so
    // V41 pipeline-only-binding enforcement and appearance-at-creation both
    // apply for free (design.md D4 step 5).
    panelService.buildForCreate(gate.dashboardId, createPanelReq, user).recover(unexpected).flatMap {
      case Left(err) =>
        cleanup(Some(outputDataTypeId), inlineSourceIdOf(sourceId, inlineSource), user)
          .map(_ => Left(stageError("panel", err)))
      case Right(builtPanel) =>
        panelRepo.insert(builtPanel).map { inserted =>
          Right(BoundPanelResponse(
            sourceId   = sourceId.value,
            pipelineId = pipelineId.value,
            dataTypeId = outputDataTypeId.value,
            panel      = PanelResponse.fromDomain(inserted)
          ))
        }.recover { case ex =>
          log.error("BoundPanelService: panel insert failed unexpectedly after buildForCreate succeeded", ex)
          Left(ServiceError.InternalError("[panel] Internal server error"))
        }
    }
  }

  private def inlineSourceIdOf(sourceId: DataSourceId, isInline: Boolean): Option[DataSourceId] =
    if (isInline) Some(sourceId) else None

  /** Merge the freshly created pipeline output `dataTypeId` and the top-level
   *  `fieldMapping` into the caller's `panel.config` (design.md D2) — mirrors
   *  exactly how `bindPanel` (`helio-mcp/src/helioApi.ts`) shapes
   *  `config: {dataTypeId, fieldMapping}` today. Any `dataTypeId`/`fieldMapping`
   *  already present in `panel.config` is overwritten — the server always
   *  binds to the type it just created, never something the caller guessed. */
  private def injectBinding(configOpt: Option[JsValue], dataTypeId: DataTypeId, fieldMapping: Option[JsObject]): JsValue = {
    val base       = configOpt.collect { case o: JsObject => o.fields }.getOrElse(Map.empty[String, JsValue])
    val withTypeId = base + ("dataTypeId" -> JsString(dataTypeId.value))
    JsObject(fieldMapping.fold(withTypeId)(fm => withTypeId + ("fieldMapping" -> fm)))
  }

  // ── Compensating cleanup (design.md D5) ────────────────────────────────────

  /** Best-effort cleanup of everything this call created so far, run from
   *  every failure branch of the execution chain from stage "pipeline"
   *  onward. Order matters (verified against the migrations, not assumed —
   *  see design.md D5): `data_type_rows` has no FK at all, and
   *  `data_types.source_id -> data_sources ON DELETE SET NULL` (NOT cascade)
   *  — so the companion DataType is deleted explicitly rather than relying on
   *  a cascade that would instead orphan it into looking like a fresh
   *  pipeline-output type. Every step swallows/logs its own failure (never
   *  rethrown) so a failed cleanup never masks the original error the caller
   *  needs to see. */
  private def cleanup(
      outputDataTypeIdOpt: Option[DataTypeId],
      inlineSourceIdOpt: Option[DataSourceId],
      user: AuthenticatedUser
  ): Future[Unit] = {
    val rowsCleanup: Future[Unit] = outputDataTypeIdOpt match {
      case Some(dtId) =>
        dataTypeRowRepo.overwriteRows(dtId.value, Vector.empty).recover { case ex =>
          log.warn(s"BoundPanelService cleanup: failed to clear rows for DataType ${dtId.value}", ex)
        }
      case None => Future.successful(())
    }
    rowsCleanup.flatMap { _ =>
      val outputTypeCleanup: Future[Unit] = outputDataTypeIdOpt match {
        case Some(dtId) =>
          // Cascades the Pipeline (+ its steps) per the migrations' FK.
          dataTypeRepo.delete(dtId, user).map(_ => ()).recover { case ex =>
            log.warn(s"BoundPanelService cleanup: failed to delete output DataType ${dtId.value}", ex)
          }
        case None => Future.successful(())
      }
      outputTypeCleanup.flatMap { _ =>
        inlineSourceIdOpt match {
          case None => Future.successful(())
          case Some(sourceId) =>
            dataTypeRepo.findBySourceId(sourceId, user.id).flatMap { companions =>
              Future.traverse(companions) { dt =>
                dataTypeRepo.delete(dt.id, user).map(_ => ()).recover { case ex =>
                  log.warn(s"BoundPanelService cleanup: failed to delete companion DataType ${dt.id.value}", ex)
                }
              }
            }.recover { case ex =>
              log.warn(s"BoundPanelService cleanup: failed to look up companion DataType for source ${sourceId.value}", ex)
              Vector.empty
            }.flatMap { _ =>
              dataSourceService.delete(sourceId, user).map(_ => ()).recover { case ex =>
                log.warn(s"BoundPanelService cleanup: failed to delete inline DataSource ${sourceId.value}", ex)
              }
            }
        }
      }
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Every failure branch prefixes the underlying `ServiceError`'s message
   *  with the stage that failed (`"source"|"pipeline"|"steps"|"run"|"panel"`)
   *  — the status code category is preserved, only the message is tagged, so
   *  a curated 400/404/etc. from the underlying service still reaches the
   *  caller verbatim (HEL-311 discipline), just identifiable by stage. */
  private def stageError(stage: String, err: ServiceError): ServiceError = {
    def tag(m: String): String = s"[$stage] $m"
    err match {
      case ServiceError.BadRequest(m)          => ServiceError.BadRequest(tag(m))
      case ServiceError.Unauthorized(m)        => ServiceError.Unauthorized(tag(m))
      case ServiceError.NotFound(m)            => ServiceError.NotFound(tag(m))
      case ServiceError.Forbidden(m)           => ServiceError.Forbidden(tag(m))
      case ServiceError.Conflict(m)            => ServiceError.Conflict(tag(m))
      case ServiceError.UnprocessableEntity(m) => ServiceError.UnprocessableEntity(tag(m))
      case ServiceError.BadGateway(m)          => ServiceError.BadGateway(tag(m))
      case ServiceError.InternalError(m)       => ServiceError.InternalError(tag(m))
      case ServiceError.PayloadTooLarge(m)     => ServiceError.PayloadTooLarge(tag(m))
    }
  }

  /** Converts an unexpected `Future` failure (e.g. a DB error surfacing as a
   *  failed `Future` rather than a curated `Left`) into a generic 500 —
   *  HEL-311: never echo a raw exception; log the detail server-side. The
   *  caller wraps this in `stageError(stage, _)` exactly like any curated
   *  `Left`, so an unexpected failure is still stage-tagged. */
  private def unexpected[A]: PartialFunction[Throwable, Either[ServiceError, A]] = { case ex =>
    log.error("BoundPanelService: stage failed unexpectedly", ex)
    Left(ServiceError.InternalError("Internal server error"))
  }
}

object BoundPanelService {
  /** Parsed + validated request state carried out of the gate into the
   *  execution chain — nothing here required a write to compute. Top-level
   *  (not nested in the class) so pattern matches on `Either[_, Gate]` don't
   *  need an outer-instance type test. */
  private final case class Gate(dashboardId: DashboardId, panelType: PanelType)
}
