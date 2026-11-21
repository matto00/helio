package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{PipelineAnalyzeResponse, PipelineStepConfigCodec, RootSourceSchemaResponse, SourceSchemaDriftResponse, TypeChangedColumnResponse}
import com.helio.api.protocols.pipelines.{ConciseAnalyzeNode, CostReasonResponse, CostVerdictResponse, PipelineAnalyzeConciseResponse}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, PipelineRootId, PipelineSchemaDrift, PipelineStep, SchemaDrift, UserId}
import com.helio.domain.engine.{AnalyzeSchemaWarnings, PipelineAnalyzeService, PipelineCostEstimator, RuntimeGraphPath, SchemaField}
import com.helio.domain.engine.PipelineAnalyzeService.schemaFieldJsonFormat
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Analyze reads: `analyze` and `analyzeConcise` and their wire-response mapping. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineAnalyzeReads(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    costInputGathering: PipelineCostInputGathering,
    support: PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  import support.{toWarningResponse, resolveSecondarySourceSchemas, toAnalyzeStepResponse, toFieldResponse}

  private def upsertTargetProblems(steps: Seq[PipelineStep], pipelineOwnerId: UserId): Future[Map[String, String]] =
    UpsertTargetAnalysis.problems(
      steps.map(s => (s.id.value, s.kind, PipelineStepConfigCodec.encode(s))),
      AuthenticatedUser(pipelineOwnerId),
      dataSourceRepo
    )

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
          // analyze. Mirrors the capabilities route's own root resolution
          // (`PipelineNodeReads.projectedSchemaAtNode`) exactly: `listRootDataSourceIdsInternal`
          // (position-ordered) + `rootIdsOf` (every parentless step's owning root), pipeline access
          // already confirmed by `findByIdShared`.
          // HEL-1661: `rootDsOpts` (caller view) feeds ONLY `sourceSchemas` and the caller-view step schemas; the cost
          // verdict resolves roots privately (`findByIdInternal`, below) and a non-owner's step validity comes from the
          // owner's root schemas, so a grantee's unowned root is neither `unclassified-source` nor a spurious step error.
          val callerIsOwner = pipeline.ownerId.value == user.id.value
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
            rootDsOpts        <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                                    dataSourceRepo.findByIdOwned(dsId, user).map(dsOpt => (rootId.value, dsOpt))
                                  }
            // HEL-1236: source-kind join secondaries' schemas, so a join's renamed columns project.
            secondarySchemas  <- resolveSecondarySourceSchemas(allSteps.map(s => s.kind -> PipelineStepConfigCodec.encode(s)), dataSourceRepo.findByIdInternal)
            upsertProblems    <- upsertTargetProblems(allSteps, pipeline.ownerId)
            // HEL-1661 D2: the roots as the pipeline OWNER sees them, read only to decide a non-owner's step validity.
            ownerSchemas      <- ownerRootSchemas(rootDataSourceIds, pipeline.ownerId, callerIsOwner)
          } yield (rootDataSourceIds, rootIdOfStep, rootDsOpts, secondarySchemas, upsertProblems, ownerSchemas)

          rootFetch.flatMap { case (rootDataSourceIds, rootIdOfStep, rootDsOpts, secondarySchemas, upsertProblems, ownerSchemas) =>
            val rootSchemas = rootDsOpts.map { case (rid, dsOpt) =>
              (rid, dsOpt.map(_.name).getOrElse(""), dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
            }
            val schemasByRoot = rootSchemas.map { case (rid, _, schema) => rid -> schema }.toMap

            // HEL-462's drift baseline predates multi-root and is not named by the 7.2c delta --
            // scoped here to the PRIMARY (lowest-positioned) root's schema, the same root
            // `findPrimaryDataSourceIdInternal` used to resolve alone, so existing single-root
            // baselines keep comparing against the same schema they always have.
            //
            // HEL-1516 (design.md D2): the drift diff compares against the baseline as the pipeline OWNER sees the
            // primary source (mirroring the capture side, HEL-1503 D2), not the caller's own view -- for a grantee who
            // does not own the source `rootSchemas.headOption` is empty and every baseline column would read removed.
            // `rootSchemas`/projections/cost inputs keep the caller's view; for the owner the two reads are identical.
            val primaryOwnerViewF: Future[Vector[SchemaField]] =
              rootDataSourceIds.headOption match {
                case Some((_, primaryDsId)) =>
                  dataSourceRepo.findByIdOwnedByInternal(primaryDsId, pipeline.ownerId).map(_.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
                case None => Future.successful(Vector.empty[SchemaField])
              }

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
            val projections = UpsertTargetAnalysis.overlay(PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, secondarySchemas), upsertProblems)
            val warnings    = AnalyzeSchemaWarnings.compute(nodeInputs, projections, secondarySchemas).map(toWarningResponse)
            val enabledSteps = allSteps.filter(_.enabled)
            // Reassemble in the SAME order `enabledSteps` lists them; a node that never resolved
            // (unknown parentStepId, dangling lane reference) is simply absent, mirroring
            // `analyzeNodes`'s own existing tolerant-degradation contract elsewhere in this file.
            // HEL-1661 D2 / HEL-1799 D1: a non-owner's step validity (and so `step-config-invalid`, `autoRunnable`,
            // `canRun`) is judged against the owner's root schemas; the schemas, warnings and everything else stay caller-view.
            val validated = nonOwnerValidity(projections, nodeInputs, ownerSchemas, secondarySchemas, upsertProblems)
            val analyzed  = enabledSteps.flatMap(s => validated.get(s.id.value))

            // HEL-1092/HEL-1093 (design.md Decision 2a): `CostInput` gathering is shared with the
            // auto-run trigger path via `PipelineCostInputGathering`. HEL-1661 D1: this call site supplies the
            // privileged `findByIdInternal` resolveRoot, exactly like the run path and the auto-run trigger, so the
            // estimator half of the verdict is the pipeline's own (owner's) and identical for every admitted caller
            // (access was already confirmed by `findByIdShared`; only reason codes leave this method for a non-owner,
            // see `toCostVerdictResponse`).
            costInputGathering.gather(
              pipelineId, enabledSteps, summary.lastRunRowCount,
              resolveRoot = dsId => dataSourceRepo.findByIdInternal(dsId)
            ).flatMap { costInput =>
            val costVerdict = PipelineCostEstimator.estimate(costInput)

            // HEL-1648: the caller's permission role (owner | editor | viewer), computed once and before the
            // config-validity AND. HEL-1096 design.md D1: `canRun` mirrors `PipelineRunService.submit`'s own
            // owner-or-editor-grantee check, computed regardless of `autoRunnable` -- see `CostVerdictResponse`'s own doc.
            val callerRoleF: Future[String] =
              if (pipeline.ownerId.value == user.id.value) Future.successful("owner")
              else pipelineRepo.findGrantRole(pipelineId, user).map(r => if (r.contains("editor")) "editor" else "viewer")

            // HEL-462: compare the current (primary-root) source schema against the baseline
            // captured on the pipeline's last successful (non-dry) run.
            for {
              callerRole    <- callerRoleF
              // HEL-1516 D1: keyed by the id `findByIdShared` authorized, so a grantee reads the owner's baseline.
              baselineJson  <- pipelineRepo.findLastSourceSchemaInternal(pipelineId)
              primarySchema <- primaryOwnerViewF
            } yield {
              val baseline = parseBaselineSchema(pipelineId, baselineJson)
              val drift    = PipelineSchemaDrift.diff(baseline, primarySchema)

              Right(PipelineAnalyzeResponse(
                id                = summary.id,
                name              = summary.name,
                sourceSchemas     = rootSchemas.map { case (rid, dsName, schema) =>
                                      RootSourceSchemaResponse(rid, dsName, schema.map(toFieldResponse))
                                    },
                steps             = analyzed.map(toAnalyzeStepResponse),
                sourceSchemaDrift = drift.map(toDriftResponse),
                costVerdict       = toCostVerdictResponse(costVerdict, callerRole != "viewer", analyzed, !callerIsOwner, summary.lastRunRowCount),
                warnings          = warnings,
                callerRole        = callerRole
              ))
            }
            }
          }
        }
      case _ =>
        Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
    }
  }

  // HEL-1093 (design.md Decision 2a): `hasSourceUrl` moved to `PipelineCostInputGathering` — both
  // `analyze` (via `costInputGathering.gather`) and `AutoRunTriggerService` now share one
  // implementation instead of two.

  /** HEL-1266 (design.md D1-D3): an enabled step with a `validationError` is a run that is certain
   *  to fail, so it adds a `step-config-invalid` reason (after the estimator's, in step order) and
   *  clears both `autoRunnable` and `canRun`. Permission stays inside `canRun` with no reason code. */
  private def toCostVerdictResponse(
      v:             PipelineCostEstimator.CostVerdict,
      canRun:        Boolean,
      analyzed:      Vector[PipelineAnalyzeService.AnalyzedStep],
      nonOwner:      Boolean,
      lastRunRows:   Option[Long]
  ): CostVerdictResponse = {
    val configReasons = analyzed.flatMap(s => s.validationError.map(CostReasonResponse(PipelineAnalyzeService.StepConfigInvalidCode, _, Some(s.id))))
    // HEL-1661 D3: a non-owner gets each estimator reason's code with a fixed neutral detail (no source kind, URL
    // wording or count), and never the owner's live dataset row count: `estimateRows` falls back to it on a never-run
    // pipeline, so a non-owner's `estimatedRows` is the last-run count (already shown in the header) or absent.
    val estimatorReasons = v.reasons.map { r =>
      CostReasonResponse(r.code, if (nonOwner) neutralDetail(r.code) else r.detail, r.stepId)
    }
    CostVerdictResponse(
      autoRunnable  = v.autoRunnable && configReasons.isEmpty,
      estimatedRows = if (nonOwner) lastRunRows else v.estimatedRows,
      stepCount     = v.stepCount,
      reasons       = estimatorReasons ++ configReasons,
      canRun        = canRun && configReasons.isEmpty
    )
  }

  /** HEL-1661 D2 / HEL-1799 D1: the pipeline's root schemas as its OWNER sees them, keyed by root id; `None` for the
   *  owner (the caller view is already the owner's). Read only to decide a non-owner's step validity. */
  private def ownerRootSchemas(
      rootDataSourceIds: Vector[(PipelineRootId, DataSourceId)],
      ownerId:           UserId,
      callerIsOwner:     Boolean
  ): Future[Option[Map[String, Vector[SchemaField]]]] =
    if (callerIsOwner) Future.successful(None)
    else Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
      dataSourceRepo.findByIdOwnedByInternal(dsId, ownerId)
        .map(dsOpt => rootId.value -> dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
    }.map(rs => Some(rs.toMap))

  /** HEL-1799 D1: the per-step result with a non-owner's `validationError` judged against the owner's schemas and
   *  mapped through `nonOwnerValidationError`; every other field is the caller-view one. For the owner (`None`) the
   *  caller view is returned unchanged. Shared by `analyze` and `analyzeConcise`. */
  private def nonOwnerValidity(
      callerView:       Map[String, PipelineAnalyzeService.AnalyzedStep],
      nodeInputs:       Vector[PipelineAnalyzeService.NodeStepInput],
      ownerSchemas:     Option[Map[String, Vector[SchemaField]]],
      secondarySchemas: Map[String, Vector[SchemaField]],
      upsertProblems:   Map[String, String]
  ): Map[String, PipelineAnalyzeService.AnalyzedStep] = ownerSchemas match {
    case None => callerView
    case Some(byRoot) =>
      val ownerView = UpsertTargetAnalysis.overlay(PipelineAnalyzeService.analyzeNodes(nodeInputs, byRoot, secondarySchemas), upsertProblems)
      callerView.map { case (id, s) => id -> s.copy(validationError = nonOwnerValidationError(s, ownerView.get(id).flatMap(_.validationError))) }
  }

  /** HEL-1661 D2: the `validationError` a non-owner receives for a step, given the error the OWNER's view of that step
   *  reports. Owner-view inference messages can carry column types from the owner's schema, so only text a non-owner
   *  can already derive is sent: the schema-independent config problem (a function of the step's own configuration),
   *  or an error identical to the caller-view one; any other owner-view error becomes one neutral sentence. */
  private def nonOwnerValidationError(step: PipelineAnalyzeService.AnalyzedStep, ownerError: Option[String]): Option[String] =
    PipelineAnalyzeService.stepConfigProblem(step.op, step.config) match {
      case some @ Some(_) => some
      case None =>
        ownerError.map(e => if (step.validationError.contains(e)) e else PipelineAnalyzeReads.NeutralStepError)
    }

  private def neutralDetail(code: String): String =
    PipelineAnalyzeReads.NeutralReasonDetail.getOrElse(code, PipelineAnalyzeReads.GenericReasonDetail)

  /** HEL-914 task 6.4 (design.md D5/D6): `GET /pipelines/:id/analyze?concise=true`'s opt-in
   *  per-node `{path, op, validationError}` projection — a wholly separate response from
   *  `analyze` above, under a byte budget `analyze`'s full response is never asked to meet.
   *  `path` reuses `RuntimeGraphPath` (the SAME builder `InProcessPipelineEngine` uses for
   *  lane-path error reporting, design.md D5's "exactly one implementation" rule) rather than
   *  a second formatter. Entries for ENABLED steps only, mirroring `analyze`'s own boundary. */
  def analyzeConcise(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, PipelineAnalyzeConciseResponse]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
      case Some(pipeline) =>
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { allSteps =>
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
            rootSchemas       <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                                    dataSourceRepo.findByIdOwned(dsId, user).map { dsOpt =>
                                      rootId.value -> dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField])
                                    }
                                  }
            secondarySchemas  <- resolveSecondarySourceSchemas(allSteps.map(s => s.kind -> PipelineStepConfigCodec.encode(s)), dataSourceRepo.findByIdInternal)
            upsertProblems    <- upsertTargetProblems(allSteps, pipeline.ownerId)
            // HEL-1799 D1: the same owner-view read the full route makes for a non-owner.
            ownerSchemas      <- ownerRootSchemas(rootDataSourceIds, pipeline.ownerId, pipeline.ownerId.value == user.id.value)
          } yield (rootDataSourceIds.map(_._1.value), rootIdOfStep, rootSchemas.toMap, secondarySchemas, upsertProblems, ownerSchemas)

          rootFetch.map { case (rootIds, rootIdOfStep, schemasByRoot, secondarySchemas, upsertProblems, ownerSchemas) =>
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
            val projections = UpsertTargetAnalysis.overlay(PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, secondarySchemas), upsertProblems)
            // HEL-1799 D1/D2: `validationError` is the owner-view one for a non-owner; path, op and warnings stay caller-view.
            val validated    = nonOwnerValidity(projections, nodeInputs, ownerSchemas, secondarySchemas, upsertProblems)
            val graphPath    = RuntimeGraphPath.build(allSteps, rootIds, rootIdOfStepStr)
            val warningsByStep = AnalyzeSchemaWarnings.compute(nodeInputs, projections, secondarySchemas).groupMap(_.stepId)(_.message)
            val nodes = allSteps.filter(_.enabled).flatMap { s =>
              projections.get(s.id.value).map { analyzed =>
                ConciseAnalyzeNode(
                  path            = graphPath.pathOf(s),
                  op              = s.kind,
                  validationError = validated.get(s.id.value).flatMap(_.validationError),
                  warnings        = warningsByStep.get(s.id.value)
                )
              }
            }
            Right(PipelineAnalyzeConciseResponse(nodes))
          }
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
}

private[pipelines] object PipelineAnalyzeReads {

  /** HEL-1661 D2: the one sentence a non-owner reads for a step that is invalid only against the owner's schema. */
  val NeutralStepError: String = "This step's configuration does not match its input."

  /** HEL-1661 D3: one constant sentence per estimator reason code for a non-owner: no source kind, URL wording, count or
   *  quoted identifier. The client renders its own copy per code, so this text is a fallback for other readers. */
  val NeutralReasonDetail: Map[String, String] = Map(
    "ai-step"                  -> "A step in this pipeline uses AI, so it is not updated automatically.",
    "writeback-step"           -> "A step in this pipeline writes to a data source, so it is not updated automatically.",
    "content-conversion"       -> "A step in this pipeline converts content, so it is not updated automatically.",
    "unclassified-op"          -> "A step in this pipeline is not on the automatic-update list.",
    "no-roots"                 -> "This pipeline has no source.",
    "remote-fetch"             -> "A source of this pipeline is read from elsewhere, so it is not updated automatically.",
    "unclassified-source"      -> "A source of this pipeline is of a kind not recognized for automatic updates.",
    "row-estimate-unavailable" -> "No row estimate is available for this pipeline.",
    "rows-above-threshold"     -> "This pipeline is too large to update automatically.",
    "steps-above-bound"        -> "This pipeline has too many steps to update automatically."
  )

  val GenericReasonDetail: String = "This pipeline is not updated automatically."
}
