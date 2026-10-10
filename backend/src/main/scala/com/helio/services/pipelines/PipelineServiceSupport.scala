package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.protocols.pipelines.{AggregateAnalyzeStepResponse, AnalyzeStepResponse, AnalyzeWarningResponse, AnalyzeWithAiAnalyzeStepResponse, AssertAnalyzeStepResponse, CastAnalyzeStepResponse, ChunkByTokenCountAnalyzeStepResponse, ComputeAnalyzeStepResponse, ConvertFormatAnalyzeStepResponse, DateBucketAnalyzeStepResponse, DedupeAnalyzeStepResponse, ExtractHeadingsAnalyzeStepResponse, FillNullAnalyzeStepResponse, FilterAnalyzeStepResponse, GenerateTextAnalyzeStepResponse, GroupByAnalyzeStepResponse, JoinAnalyzeStepResponse, LimitAnalyzeStepResponse, LookupAnalyzeStepResponse, PipelineRootSummaryResponse, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, PivotAnalyzeStepResponse, RenameAnalyzeStepResponse, SchemaFieldResponse, SelectAnalyzeStepResponse, SortAnalyzeStepResponse, SplitTextAnalyzeStepResponse, StringOpsAnalyzeStepResponse, UnionAnalyzeStepResponse, UnpivotAnalyzeStepResponse, UpsertSourceAnalyzeStepResponse, WindowAnalyzeStepResponse}
import com.helio.domain.panels.OutputBindingSpec
import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, OutputKind, PipelineId, PipelineStep, UserId}
import com.helio.domain.engine.{AnalyzeSchemaWarnings, PipelineAnalyzeService, SchemaField}
import com.helio.domain.{AggregateConfig, AnalyzeWithAiConfig, AssertConfig, CastConfig, ChunkByTokenCountConfig, ComputeConfig, ConvertFormatConfig, DateBucketConfig, DedupeConfig, ExtractHeadingsConfig, FillNullConfig, FilterConfig, GenerateTextConfig, GroupByConfig, JoinConfig, LimitConfig, LookupConfig, PivotConfig, RenameConfig, SelectConfig, SortConfig, SplitTextConfig, StringOpsConfig, UnionConfig, UnpivotConfig, WindowConfig, UpsertSourceConfig}
import com.helio.domain.steps.UpsertTargetCheck
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Shared helpers for the PipelineService collaborators: auditing, step-response assembly, wire-response mapping, schema
 *  resolution and the upsert-target ownership check. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineServiceSupport(
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    auditService: AuditService
)(implicit ec: ExecutionContext) {

  private[pipelines] def audit(
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
  private[pipelines] def stepResponseWithRoot(pipelineId: PipelineId, step: PipelineStep): Future[PipelineStepResponse] =
    pipelineStepRepo.rootIdOfStep(pipelineId, step.id).map { rootIdOpt =>
      PipelineStepResponse.fromDomain(step, rootIdOpt.map(rid => step.id.value -> rid.value).toMap)
    }

  private def stepAddress(idx: Int): String   = PipelineService.stepAddress(idx)

  private[pipelines] def outputAddress(idx: Int): String = PipelineService.outputAddress(idx)

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
  private[pipelines] def validateOutputFieldMapping(kind: OutputKind, config: JsObject, schema: Vector[SchemaField]): Either[ServiceError, Unit] = {
    val spec = OutputBindingSpec.All.find(_.outputKind == kind).getOrElse(
      throw new IllegalStateException(s"PipelineService: no OutputBindingSpec for kind $kind -- OutputBindingSpec.All is missing a case")
    )
    // HEL-1273/HEL-1313: the config-only checks are `PipelineCreatePreflight.validateOutputConfig` (run first,
    // unconditionally, before the no-fieldMapping early return).
    PipelineCreatePreflight.validateOutputConfig(kind, config).flatMap { _ =>
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
  }

  private[pipelines] def toWarningResponse(w: AnalyzeSchemaWarnings.Warning): AnalyzeWarningResponse =
    AnalyzeWarningResponse(stepId = w.stepId, code = w.code, message = w.message)

  /** HEL-1236: pre-resolves the inferred schema of every `join` step's `source`-kind secondary
   *  input so `PipelineAnalyzeService.analyzeNodes` can project the join's renamed columns
   *  (`right_<name>`) instead of its left-schema passthrough. EVERY `analyzeNodes` call site in
   *  this file funnels through here (no site keeps the passthrough). `resolve` is the caller's
   *  access policy: persisted-pipeline paths pass `findByIdInternal` (the pipeline ACL is the
   *  gate, exactly as `JoinStep.evaluate` resolves it); the un-applied-proposal path passes the
   *  caller-scoped `findByIdOwned` so an unvalidated proposal can never read another tenant's
   *  schema. A source that is missing or has no inferred schema is simply absent from the map
   *  (analyze falls back to the documented passthrough; the runtime still fails loudly). */
  private[pipelines] def resolveSecondarySourceSchemas(
      steps:   Iterable[(String, String)],
      resolve: DataSourceId => Future[Option[DataSource]]
  ): Future[Map[String, Vector[SchemaField]]] = {
    val ids = steps.flatMap { case (op, config) => PipelineAnalyzeService.secondarySourceIdOf(op, config) }.toVector.distinct
    Future.traverse(ids)(id => resolve(DataSourceId(id)).map(id -> _.map(_.inferredSchema).filter(_.nonEmpty)))
      .map(_.collect { case (id, Some(schema)) => id -> schema }.toMap)
  }

  /** Map the analyze service's stringly-typed step output back into the
   *  discriminated-union wire shape by re-decoding the config blob into its
   *  typed `*Config` and constructing the appropriate per-subtype response. */
  private[pipelines] def toAnalyzeStepResponse(s: PipelineAnalyzeService.AnalyzedStep): AnalyzeStepResponse = {
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
      case Success(cfg: UpsertSourceConfig) => UpsertSourceAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: ConvertFormatConfig) => ConvertFormatAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: AnalyzeWithAiConfig) => AnalyzeWithAiAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
      case Success(cfg: GenerateTextConfig) => GenerateTextAnalyzeStepResponse(s.id, s.position, cfg, inSchema, outSchema, s.validationError)
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

  /** HEL-1100 (design.md Decision 1): an `upsertsource` step's target must be OWNED BY THE
   *  PIPELINE OWNER, not the calling grantee -- resolved against
   *  `AuthenticatedUser(pipeline.ownerId, ...)` (D5: writes always run as the owner), never the
   *  caller's own identity. A grantee therefore cannot target the grantee's own dataset (rejected
   *  here, "data source not found"), but can target the owner's. `None` for every non-`upsertsource`
   *  config (mirrors `secondaryDataSourceId`'s own "no second source" no-op contract). */
  private[pipelines] def upsertOwnershipCheckF(typedConfig: Any, pipelineOwnerId: UserId, caller: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    typedConfig match {
      case cfg: UpsertSourceConfig =>
        val ownerUser = AuthenticatedUser(pipelineOwnerId, caller.source, caller.tokenId)
        UpsertTargetCheck.check(cfg.target, ownerUser, dataSourceRepo).map {
          case UpsertTargetCheck.NotFound(msg)    => Left(ServiceError.NotFound(msg))
          case UpsertTargetCheck.NotWritable(msg) => Left(ServiceError.UnprocessableEntity(msg))
          case UpsertTargetCheck.Writable         => Right(())
        }
      case _ => Future.successful(Right(()))
    }

  private[pipelines] def toSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      lastRunTruncated     = s.lastRunTruncated,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag,
      createdAt            = s.createdAt,
      updatedAt            = s.updatedAt
    )

  private[pipelines] def toFieldResponse(sf: SchemaField): SchemaFieldResponse =
    SchemaFieldResponse(sf.name, sf.`type`)
}
