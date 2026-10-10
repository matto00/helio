package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.sources.{ContentSourceSupport, SourceService}
import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, OutputAnalyzeResponse, PipelineAnalyzeProposalResponse, PipelineProposal, PipelineProposalSource, ProposalRestApiConfig, RootSourceSchemaResponse}
import com.helio.api.protocols.sources.{RestApiConfigPayload, SqlSourceConfigPayload}
import com.helio.domain.model.{AuthenticatedUser, DataFieldType, DataSourceId, DataSourceKind, EphemeralRestConfig, InferredSchema, OutputKind, PipelineStepKind}
import com.helio.domain.engine.{AnalyzeSchemaWarnings, PipelineAnalyzeService, SchemaField}
import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver, SqlConnectorDriver}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json._

import java.net.InetAddress
import scala.concurrent.{ExecutionContext, Future}

/** Dry-analyze of a not-yet-created `PipelineProposal` (`analyzeProposal`) and its source/Output resolution. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineProposalAnalyze(
    dataSourceRepo: DataSourceRepository,
    connector: RestApiConnectorDriver,
    sourceService: SourceService,
    support: PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  import support.{outputAddress, validateOutputFieldMapping, toWarningResponse, resolveSecondarySourceSchemas, toAnalyzeStepResponse, toFieldResponse}

  /** Dry-analyze a not-yet-created `PipelineProposal` (HEL-381): resolve/derive the
   *  source schema, fold the proposed steps through the same `PipelineAnalyzeService`
   *  engine `PipelineAnalyzeReads.analyze` uses, and return the projected schema — no persistence,
   *  no run (design.md D1).
   *
   *  Validates every step's `type` against `PipelineStepKind.All` *before* resolving
   *  the source or building `stepInputs` — mirroring `PipelineStepCreate.addStepReporting`'s existing guard
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
   *  multi-root/lane projection the persisted-pipeline `PipelineAnalyzeReads.analyze` route uses — never a
   *  second, un-applied-proposal-specific projection. Each proposed root gets a stable key
   *  (its own `clientId` when given, else its request index as a string) so a step's
   *  `rootClientId` (or, for a single-root proposal, the implicit root) resolves against the
   *  right root's schema, and a rejoin node's schema derives from BOTH incoming lanes. */
  def analyzeProposal(proposal: PipelineProposal, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeProposalResponse]] =
    validateStepKinds(proposal.steps) match {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        // HEL-1236: caller-scoped (`findByIdOwned`) -- an un-applied proposal's join secondary has
        // not passed `validateStepCrossOwnerRefs`, so it must never resolve another tenant's schema.
        resolveAllProposalRootSchemas(proposal, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(rootSchemas) =>
          for {
            secondarySchemas <- resolveSecondarySourceSchemas(proposal.steps.map(r => r.`type` -> r.config.compactPrint), dsId => dataSourceRepo.findByIdOwned(dsId, user))
            upsertProblems   <- UpsertTargetAnalysis.problems(proposal.steps.map(r => (r.clientId, r.`type`, r.config.compactPrint)), user, dataSourceRepo)
          } yield {
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
            val projections  = UpsertTargetAnalysis.overlay(PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, secondarySchemas), upsertProblems)
            val enabledSteps = proposal.steps.filter(_.enabled.getOrElse(true))
            val analyzed     = enabledSteps.flatMap(s => projections.get(s.clientId))
            val warnings     = AnalyzeSchemaWarnings.compute(nodeInputs, projections, secondarySchemas).map(toWarningResponse)

            resolveProposalOutputAnalyses(proposal.outputs, proposal.steps, rootKeys, schemasByRoot, projections) match {
              case Left(err) => Left(err)
              case Right(outputAnalyses) =>
                Right(PipelineAnalyzeProposalResponse(
                  sourceSchemas = rootSchemas.zip(rootKeys).map { case ((name, schema), key) =>
                    RootSourceSchemaResponse(key, name, schema.map(toFieldResponse))
                  },
                  steps    = analyzed.map(toAnalyzeStepResponse),
                  outputs  = outputAnalyses,
                  warnings = warnings
                ))
            }
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
    // HEL-1073 design.md Decision 2: canonicalize before matching so a "static" inline
    // type resolves the same branch as "dataset".
    source.`type`.map(DataSourceKind.canonicalize) match {
      case Some(DataSourceKind.Sql) =>
        source.sqlConfig match {
          case None =>
            Future.successful(Left(ServiceError.BadRequest("inline 'sql' source requires a 'config' object")))
          case Some(payload) =>
            val domainConfig = SqlSourceConfigPayload.toDomain(payload)
            SqlConnectorDriver.checkQuery(domainConfig.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(domainConfig)) match {
              case Left(err) =>
                Future.successful(Left(ServiceError.BadRequest(err)))
              case Right(_) =>
                // HEL-952 design.md Decision 4a: reuses the SAME sqlResolveHost/sqlIsBlocked
                // override `sourceService` was constructed with (Option-guarded — this
                // constructor param is nullable, matching every other optional collaborator in
                // this file), rather than always falling back to real DNS/denylist here.
                val (resolveHost, isBlocked) = Option(sourceService) match {
                  case Some(svc) => (svc.sqlResolveHost, svc.sqlIsBlocked)
                  case None      => (ContentSourceSupport.defaultResolveHost _, (h: String, addr: InetAddress) => ContentSourceSupport.isBlockedAddress(addr))
                }
                SqlConnectorDriver.inferSchema(domainConfig, ConnectorResolveContext.Internal, resolveHost, isBlocked).map {
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
      case Some(DataSourceKind.Dataset) =>
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
}
