package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.pipelines.{AggregateAnalyzeStepResponse, AnalyzeStepResponse, AssertAnalyzeStepResponse, CastAnalyzeStepResponse, ChunkByTokenCountAnalyzeStepResponse, ComputeAnalyzeStepResponse, CreatePipelineRequest, CreatePipelineStepRequest, DateBucketAnalyzeStepResponse, DedupeAnalyzeStepResponse, ExtractHeadingsAnalyzeStepResponse, FillNullAnalyzeStepResponse, FilterAnalyzeStepResponse, GroupByAnalyzeStepResponse, JoinAnalyzeStepResponse, LimitAnalyzeStepResponse, LookupAnalyzeStepResponse, PipelineAnalyzeProposalResponse, PipelineAnalyzeResponse, PipelineProposal, PipelineProposalSource, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, PivotAnalyzeStepResponse, RenameAnalyzeStepResponse, ReorderPipelineStepsRequest, SchemaFieldResponse, SelectAnalyzeStepResponse, SortAnalyzeStepResponse, SourceSchemaDriftResponse, SplitTextAnalyzeStepResponse, StringOpsAnalyzeStepResponse, TypeChangedColumnResponse, UnionAnalyzeStepResponse, UnpivotAnalyzeStepResponse, UpdatePipelineRequest, UpdatePipelineStepRequest, WindowAnalyzeStepResponse}
import com.helio.api.protocols.sources.{RestApiConfigPayload, SqlSourceConfigPayload}
import com.helio.domain.model.{AuditSource, AuthenticatedUser, DataFieldType, DataSourceId, DataSourceKind, EphemeralRestConfig, InferredSchema, PipelineId, PipelineSchemaDrift, PipelineStepId, PipelineStepKind, SchemaDrift}
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver, SqlConnectorDriver}
import com.helio.domain.{AggregateConfig, AssertConfig, CastConfig, ChunkByTokenCountConfig, ComputeConfig, DateBucketConfig, DedupeConfig, ExtractHeadingsConfig, FillNullConfig, FilterConfig, GroupByConfig, JoinConfig, LimitConfig, LookupConfig, PivotConfig, RenameConfig, SelectConfig, SortConfig, SplitTextConfig, StringOpsConfig, UnionConfig, UnpivotConfig, WindowConfig}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import org.postgresql.util.PSQLException
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

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
    dataTypeRepo:     DataTypeRepository,
    // HEL-381: nullable-optional wiring mirrors the many other optional
    // collaborators ApiRoutes.scala threads (e.g. binaryRefRepo/imageUploadRepo) —
    // fixtures that don't pass a RestApiConnectorDriver simply can't dry-analyze an
    // analyzeProposal request whose inline source is `rest_api` (every other
    // branch — existing sourceId, inline sql, inline static — never touches
    // it). ApiRoutes itself always threads the real, non-null connector (the
    // same instance SourceService already receives).
    connector: RestApiConnectorDriver = null,
    // HEL-477: nullable-optional wiring mirrors connector above.
    auditService: AuditService = null
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

  // ── Pipeline CRUD ─────────────────────────────────────────────────────────

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

  def create(req: CreatePipelineRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineSummaryResponse]] = {
    if (req.name.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("name is required")))
    else if (req.sourceDataSourceId.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("sourceDataSourceId is required")))
    else if (req.outputDataTypeName.trim.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("outputDataTypeName is required")))
    else RequestValidation.validateTag(req.tag) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(tag) =>
        pipelineRepo.create(req.name.trim, DataSourceId(req.sourceDataSourceId.trim), req.outputDataTypeName.trim, user, tag).map {
          case Right(summary)                       =>
            audit("pipeline.create", "pipeline", Some(summary.id), user)
            Right(toSummaryResponse(summary))
          case Left(msg) if msg.contains("not found") => Left(ServiceError.NotFound(msg))
          case Left(msg)                              => Left(ServiceError.BadRequest(msg))
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

  // ── Analyze ───────────────────────────────────────────────────────────────

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
          dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id).flatMap { sourceDataTypes =>
            val sourceSchema: Vector[SchemaField] = PipelineAnalyzeService.deriveSourceSchema(sourceDataTypes)

            // HEL-412 (design.md Decision 3, boundary iii): disabled steps are
            // dropped before analysis — the response therefore contains
            // per-step entries for enabled steps only.
            val steps = allSteps.filter(_.enabled)
            val stepInputs = steps.map(s =>
              PipelineAnalyzeService.PipelineStepInput(
                id       = s.id.value,
                position = s.position,
                op       = s.kind,
                config   = PipelineStepConfigCodec.encode(s)
              )
            )
            val analyzed = PipelineAnalyzeService.analyze(stepInputs, sourceSchema)

            // HEL-462: compare the current source schema against the baseline
            // captured on the pipeline's last successful (non-dry) run.
            pipelineRepo.findLastSourceSchema(pipelineId, user).map { baselineJson =>
              val baseline = parseBaselineSchema(pipelineId, baselineJson)
              val drift    = PipelineSchemaDrift.diff(baseline, sourceSchema)

              Right(PipelineAnalyzeResponse(
                id                   = summary.id,
                name                 = summary.name,
                sourceDataSourceName = summary.sourceDataSourceName,
                outputDataTypeName   = summary.outputDataTypeName,
                outputDataTypeId     = summary.outputDataTypeId,
                sourceSchema         = sourceSchema.map(toFieldResponse),
                steps                = analyzed.map(toAnalyzeStepResponse),
                sourceSchemaDrift    = drift.map(toDriftResponse)
              ))
            }
          }
        }
      case _ =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
    }
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
  def analyzeProposal(proposal: PipelineProposal, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeProposalResponse]] =
    validateStepKinds(proposal.steps) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        resolveProposalSourceSchema(proposal, user).map {
          case Left(err) => Left(err)
          case Right((sourceName, sourceSchema)) =>
            // HEL-412 (design.md Decision 3, boundary iv): a proposal step
            // carrying `enabled: false` is treated as absent, matching what
            // the live analyze endpoint would report once applied.
            val enabledSteps = proposal.steps.filter(_.enabled.getOrElse(true))
            val stepInputs = enabledSteps.zipWithIndex.map { case (req, i) =>
              PipelineAnalyzeService.PipelineStepInput(
                id       = s"step-$i",
                position = i,
                op       = req.`type`,
                config   = req.config.compactPrint
              )
            }
            val analyzed = PipelineAnalyzeService.analyze(stepInputs, sourceSchema)

            Right(PipelineAnalyzeProposalResponse(
              sourceName         = sourceName,
              outputDataTypeName = proposal.outputDataTypeName,
              sourceSchema        = sourceSchema.map(toFieldResponse),
              steps               = analyzed.map(toAnalyzeStepResponse)
            ))
        }
    }

  /** Same allow-list check `addStep` already performs (`PipelineStepKind.All.contains`)
   *  before a single step write — generalized here to every entry in a proposal's
   *  `steps` array, since `analyzeProposal` is the first caller to feed
   *  `toAnalyzeStepResponse` steps that never passed through that per-write gate. */
  private def validateStepKinds(steps: Vector[CreatePipelineStepRequest]): Either[ServiceError, Unit] =
    steps.find(s => !PipelineStepKind.All.contains(s.`type`)) match {
      case Some(bad) =>
        Left(ServiceError.BadRequest(
          s"Invalid step type '${bad.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
        ))
      case None => Right(())
    }

  /** Resolves `proposal.source`'s schema per design.md D2 — `sourceId`, when present,
   *  always wins over an inline `type` (checked first, before any inline branch).
   *  Returns the resolved name (existing source's stored name, or the inline source's
   *  declared name, falling back to `proposal.pipelineName` — design.md D4) alongside
   *  the resolved schema. */
  private def resolveProposalSourceSchema(
      proposal: PipelineProposal,
      user:     AuthenticatedUser
  ): Future[Either[ServiceError, (String, Vector[SchemaField])]] =
    proposal.source.sourceId match {
      case Some(id) =>
        dataSourceRepo.findByIdOwned(DataSourceId(id), user).flatMap {
          case None =>
            Future.successful(Left(ServiceError.NotFound(s"Data source not found: $id")))
          case Some(ds) =>
            dataTypeRepo.findBySourceId(ds.id, user.id).map { dataTypes =>
              val schema = dataTypes.headOption.toVector.flatMap(_.fields).map(f => SchemaField(f.name, f.dataType))
              Right((ds.name, schema))
            }
        }
      case None =>
        resolveInlineSourceSchema(proposal.source, proposal.pipelineName, user)
    }

  /** Inline-source branch of `resolveProposalSourceSchema` (design.md D2). Every
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
        source.restConfig match {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("inline 'rest_api' source requires a 'config' object")))
          case Some(payload) if payload.auth.isDefined =>
            Future.successful(Left(ServiceError.BadRequest("auth is not accepted on a REST source — auth lives on the referenced Connector")))
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
                    RestApiConfigPayload.toDomain(payload) match {
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
            Future.successful(Right((name, payload.columns.map(c => SchemaField(c.name, c.`type`)))))
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
      case Failure(ex) =>
        throw new IllegalStateException(
          s"PipelineService.toAnalyzeStepResponse: failed to decode persisted config for analyze step ${s.id}: ${ex.getMessage}",
          ex
        )
    }
  }

  // ── Pipeline step CRUD ────────────────────────────────────────────────────

  /** Sharing-aware step list. Owner, editor, and viewer can list steps. */
  def listSteps(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineStepResponse]]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(_) =>
        // Safe: access confirmed by findByIdShared above. Use internal variant
        // so editor/viewer grantees are not blocked by the V35 pipeline_steps
        // RLS owner-JOIN policy.
        pipelineStepRepo.listByPipelineInternal(pipelineId).map(steps => Right(steps.map(PipelineStepResponse.fromDomain)))
    }

  /** Step creation — requires Editor or Owner. Viewer grantees get 403. */
  def addStep(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, PipelineStepResponse]] = {
    if (!PipelineStepKind.All.contains(req.`type`))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      )))
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
          // Pre-flight ACL: JoinStep right-source must be caller-owned (HEL-278).
          val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
            case jc: JoinConfig =>
              dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
                case None    => Left(ServiceError.NotFound(s"Data source not found: ${jc.rightDataSourceId}"))
                case Some(_) => Right(())
              }
            case _ => Future.successful(Right(()))
          }
          // Pre-flight ACL: UnionStep other-source must be caller-owned (HEL-384,
          // design.md Decision 9 — symmetric with joinCheckF above).
          val unionCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
            case uc: UnionConfig =>
              dataSourceRepo.findByIdOwned(DataSourceId(uc.otherDataSourceId), user).map {
                case None    => Left(ServiceError.NotFound(s"Data source not found: ${uc.otherDataSourceId}"))
                case Some(_) => Right(())
              }
            case _ => Future.successful(Right(()))
          }
          // Pre-flight ACL: LookupStep reference-source must be caller-owned
          // (HEL-386, design.md Decision 9 — symmetric with joinCheckF/unionCheckF above).
          // Empty referenceDataSourceId (the picker's own defaultConfigFor("lookup")
          // seed value) is an incomplete draft, not a security violation — nothing
          // to leak against an unset id. Only run the ownership check once a real
          // id is present; the empty case falls through to the same allow-path as
          // "no LookupConfig at all" (design.md Decision 1's "empty is a no-op, not
          // an error" philosophy, extended to referenceDataSourceId; Decision 6
          // already scopes the "missing/invalid reference id" failure to execute
          // time via LookupStep.evaluate's None case).
          val lookupCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
            case lc: LookupConfig if lc.referenceDataSourceId.nonEmpty =>
              dataSourceRepo.findByIdOwned(DataSourceId(lc.referenceDataSourceId), user).map {
                case None    => Left(ServiceError.NotFound(s"Data source not found: ${lc.referenceDataSourceId}"))
                case Some(_) => Right(())
              }
            case _ => Future.successful(Right(()))
          }
          val aclCheckF: Future[Either[ServiceError, Unit]] =
            joinCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  => unionCheckF
            }.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  => lookupCheckF
            }
          aclCheckF.flatMap {
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

  /** Shared persist branch for `addStep` (HEL-410) — called only after the
    * caller's editor-or-owner access has been confirmed by both branches
    * above. `req.position` absent keeps the pre-existing append behavior
    * (`insertInternal`, untouched); present validates it as a list index
    * (`0 <= position <= count`, count read fresh immediately before the
    * insert) and, if in range, inserts + renumbers via `insertAtInternal`.
    * Out-of-range values return 422 with nothing persisted — the same
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
    req.position match {
      case None =>
        pipelineStepRepo.insertInternal(pipelineId, req.`type`, typedConfig, enabled)
          .map { step =>
            audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
            Right(PipelineStepResponse.fromDomain(step))
          }
          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
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
            pipelineStepRepo.insertAtInternal(pipelineId, req.`type`, typedConfig, index, enabled)
              .map { step =>
                audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                Right(PipelineStepResponse.fromDomain(step))
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
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
                          .map {
                            case Some(step) =>
                              audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                              Right(PipelineStepResponse.fromDomain(step))
                            case None       => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                          }
                          .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                      case Some(cfgJson) =>
                        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
                          case Failure(ex) =>
                            // HEL-311: keep the curated "Invalid '<type>' config" prefix,
                            // drop the raw decode-exception tail; log the detail server-side.
                            log.warn(s"updateStep: config decode failed for step type '${existing.kind}'", ex)
                            Future.successful(Left(ServiceError.BadRequest(
                              s"Invalid '${existing.kind}' config"
                            )))
                          case Success(typedConfig) =>
                            val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
                              case jc: JoinConfig =>
                                dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
                                  case None    => Left(ServiceError.NotFound(s"Data source not found: ${jc.rightDataSourceId}"))
                                  case Some(_) => Right(())
                                }
                              case _ => Future.successful(Right(()))
                            }
                            // Pre-flight ACL: UnionStep other-source must be caller-owned
                            // (HEL-384, design.md Decision 9 — symmetric with joinCheckF above).
                            val unionCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
                              case uc: UnionConfig =>
                                dataSourceRepo.findByIdOwned(DataSourceId(uc.otherDataSourceId), user).map {
                                  case None    => Left(ServiceError.NotFound(s"Data source not found: ${uc.otherDataSourceId}"))
                                  case Some(_) => Right(())
                                }
                              case _ => Future.successful(Right(()))
                            }
                            // Pre-flight ACL: LookupStep reference-source must be caller-owned
                            // (HEL-386, design.md Decision 9 — symmetric with joinCheckF/unionCheckF above).
                            // Empty referenceDataSourceId is an incomplete draft, not a security
                            // violation — see the identical guard + rationale in addStep above.
                            val lookupCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
                              case lc: LookupConfig if lc.referenceDataSourceId.nonEmpty =>
                                dataSourceRepo.findByIdOwned(DataSourceId(lc.referenceDataSourceId), user).map {
                                  case None    => Left(ServiceError.NotFound(s"Data source not found: ${lc.referenceDataSourceId}"))
                                  case Some(_) => Right(())
                                }
                              case _ => Future.successful(Right(()))
                            }
                            val aclCheckF: Future[Either[ServiceError, Unit]] =
                              joinCheckF.flatMap {
                                case Left(err) => Future.successful(Left(err))
                                case Right(_)  => unionCheckF
                              }.flatMap {
                                case Left(err) => Future.successful(Left(err))
                                case Right(_)  => lookupCheckF
                              }
                            aclCheckF.flatMap {
                              case Left(err) => Future.successful(Left(err))
                              case Right(_)  =>
                                // Safe: editor/owner access confirmed. Use internal update.
                                pipelineStepRepo.updateInternal(stepId, config = Some(typedConfig), position = req.position, enabled = req.enabled)
                                  .map {
                                    case Some(step) =>
                                      audit("pipeline.step.update", "pipeline_step", Some(step.id.value), user)
                                      Right(PipelineStepResponse.fromDomain(step))
                                    case None       => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
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

  /** Step delete — requires Editor or Owner. Viewer grantees get 403. */
  def deleteStep(stepId: PipelineStepId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
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
                pipelineStepRepo.deleteInternal(stepId).map {
                  case true  =>
                    audit("pipeline.step.delete", "pipeline_step", Some(stepId.value), user)
                    Right(())
                  case false => Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}"))
                }
            }
        }
    }

  /** Atomic batch reorder (HEL-407) — requires Editor or Owner. Viewer
   *  grantees get 403. `req.stepIds` must be exactly a permutation of the
   *  pipeline's current step ids (set equality + length); otherwise 422.
   *  On success, every step's `position` is set to its index in `stepIds`
   *  within a single repository transaction. */
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
            // Safe: editor/owner access confirmed above. Use internal variant
            // so editor grantees are not blocked by the V35 pipeline_steps
            // RLS owner-JOIN policy.
            pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
              val currentIds   = current.map(_.id.value).toSet
              val requestedIds = req.stepIds.toSet
              if (req.stepIds.size != current.size || requestedIds != currentIds) {
                Future.successful(Left(ServiceError.UnprocessableEntity(
                  "stepIds must be exactly a permutation of the pipeline's current step ids"
                )))
              } else {
                // Safe: editor/owner access confirmed above. Use internal reorder.
                pipelineStepRepo.reorderInternal(pipelineId, req.stepIds.map(PipelineStepId(_)))
                  .map { steps =>
                    // HEL-477 skeptic-final-1 round 1 (design.md Decision 7): ONE row per call,
                    // not one per step — metadata carries the resulting ordered step ids.
                    audit(
                      "pipeline.step.reorder",
                      "pipeline",
                      Some(pipelineId.value),
                      user,
                      JsObject("stepIds" -> JsArray(steps.map(s => JsString(s.id.value)).toVector))
                    )
                    Right(steps.map(PipelineStepResponse.fromDomain))
                  }
                  .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
              }
            }
        }
    }

  /** Duplicate a step (HEL-412) — requires Editor or Owner. Viewer grantees
   *  get 403; an unknown or invisible step masks as 404 (design.md
   *  Decision 4, the `updateStep` ACL pattern verbatim). Clones `kind`,
   *  `config`, and `enabled`, and inserts the clone directly after the
   *  original via `insertAtInternal` (HEL-410's transactional renumber). */
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
                    // Safe: editor/owner access confirmed above. Use internal list
                    // so editor grantees are not blocked by the V35 pipeline_steps
                    // RLS owner-JOIN policy. Read close to the insert below.
                    pipelineStepRepo.listByPipelineInternal(pipeline.id).flatMap { current =>
                      current.sortBy(_.position).indexWhere(_.id.value == stepId.value) match {
                        case -1 =>
                          Future.successful(Left(ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")))
                        case originalListIndex =>
                          pipelineStepRepo
                            .insertAtInternal(pipeline.id, existing.kind, typedConfig, originalListIndex + 1, existing.enabled)
                            .map { step =>
                              // HEL-477 skeptic-final-1 round 1: mirrors PanelService.duplicate's
                              // one-row-per-call convention; metadata carries the source stepId.
                              audit(
                                "pipeline.step.duplicate",
                                "pipeline_step",
                                Some(step.id.value),
                                user,
                                JsObject("sourceStepId" -> JsString(stepId.value))
                              )
                              Right(PipelineStepResponse.fromDomain(step))
                            }
                            .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                      }
                    }
                }
            }
        }
    }

  // ── Internal helpers ──────────────────────────────────────────────────────

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
      sourceDataSourceId   = s.sourceDataSourceId,
      sourceDataSourceName = s.sourceDataSourceName,
      outputDataTypeName   = s.outputDataTypeName,
      outputDataTypeId     = s.outputDataTypeId,
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag
    )

  private def toFieldResponse(sf: SchemaField): SchemaFieldResponse =
    SchemaFieldResponse(sf.name, sf.`type`)
}

object PipelineService {

  private val log = LoggerFactory.getLogger(getClass)

  /** Classify a DB exception into the appropriate ServiceError variant.
   *
   *  HEL-311: the raw PSQLException/JDBC message (which can include table,
   *  column, and constraint names) and any other exception's raw message
   *  must never reach the client body. The full exception is logged
   *  server-side; only a generic, curated message per category is returned.
   */
  private[services] def classifyDbError(ex: Throwable): ServiceError = ex match {
    case e: PSQLException =>
      val msg = Option(e.getMessage).getOrElse(e.getClass.getName)
      log.error("Pipeline step DB operation failed", e)
      if (msg.contains("violates foreign key constraint"))
        ServiceError.NotFound("Referenced resource not found")
      else if (msg.contains("violates check constraint"))
        ServiceError.BadRequest("Request violates a data constraint")
      else
        ServiceError.InternalError("Internal server error")
    case other =>
      log.error("Pipeline step DB operation failed", other)
      ServiceError.InternalError("Internal server error")
  }
}
