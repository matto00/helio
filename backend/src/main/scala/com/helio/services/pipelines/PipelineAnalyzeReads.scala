package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{PipelineAnalyzeResponse, PipelineStepConfigCodec, RootSourceSchemaResponse, SourceSchemaDriftResponse, TypeChangedColumnResponse}
import com.helio.api.protocols.pipelines.{ConciseAnalyzeNode, CostReasonResponse, CostVerdictResponse, PipelineAnalyzeConciseResponse}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineSchemaDrift, PipelineStep, SchemaDrift, UserId}
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
          // HEL-1092: `rootDsOpts` also feeds `PipelineCostEstimator`'s per-root classification
          // (kind/hasSourceUrl) below -- a root `findByIdOwned` can't see (e.g. a shared viewer)
          // yields `None` here, which the estimator treats as `unclassified-source` (D7).
          val rootFetch = for {
            rootDataSourceIds <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
            rootIdOfStep      <- pipelineStepRepo.rootIdsOf(pipelineId)
            rootDsOpts        <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                                    dataSourceRepo.findByIdOwned(dsId, user).map(dsOpt => (rootId.value, dsOpt))
                                  }
            // HEL-1236: source-kind join secondaries' schemas, so a join's renamed columns project.
            secondarySchemas  <- resolveSecondarySourceSchemas(allSteps.map(s => s.kind -> PipelineStepConfigCodec.encode(s)), dataSourceRepo.findByIdInternal)
            upsertProblems    <- upsertTargetProblems(allSteps, pipeline.ownerId)
          } yield (rootIdOfStep, rootDsOpts, secondarySchemas, upsertProblems)

          rootFetch.flatMap { case (rootIdOfStep, rootDsOpts, secondarySchemas, upsertProblems) =>
            val rootSchemas = rootDsOpts.map { case (rid, dsOpt) =>
              (rid, dsOpt.map(_.name).getOrElse(""), dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
            }
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
            val projections = UpsertTargetAnalysis.overlay(PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, secondarySchemas), upsertProblems)
            val warnings    = AnalyzeSchemaWarnings.compute(nodeInputs, projections, secondarySchemas).map(toWarningResponse)
            val enabledSteps = allSteps.filter(_.enabled)
            // Reassemble in the SAME order `enabledSteps` lists them; a node that never resolved
            // (unknown parentStepId, dangling lane reference) is simply absent, mirroring
            // `analyzeNodes`'s own existing tolerant-degradation contract elsewhere in this file.
            val analyzed = enabledSteps.flatMap(s => projections.get(s.id.value))

            // HEL-1092/HEL-1093 (design.md Decision 2a): `CostInput` gathering is shared with the
            // auto-run trigger path via `PipelineCostInputGathering` -- this call site supplies
            // `resolveRoot = findByIdOwned(_, user)`, byte-for-byte the same ACL-scoped resolution
            // this method already performed inline before the extraction (unlike the auto-run
            // path's own privileged `findByIdInternal` resolveRoot -- see that class's doc).
            // `gather` re-derives its own root list and dataset-row-count lookup rather than
            // accepting `rootDsOpts` (already resolved above for the schema-drift computation)
            // pre-computed -- the shared helper's contract is deliberately self-contained for its
            // one other caller (AutoRunTriggerService), which has no equivalent value in scope.
            costInputGathering.gather(
              pipelineId, enabledSteps, summary.lastRunRowCount,
              resolveRoot = dsId => dataSourceRepo.findByIdOwned(dsId, user)
            ).flatMap { costInput =>
            val costVerdict = PipelineCostEstimator.estimate(costInput)

            // HEL-1096 design.md D1: `canRun` mirrors `PipelineRunService.submit`'s own
            // owner-or-editor-grantee check, computed regardless of `autoRunnable` -- see
            // `CostVerdictResponse`'s own doc.
            val canRunF: Future[Boolean] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(true)
              else pipelineRepo.findGrantRole(pipelineId, user).map(_.contains("editor"))

            // HEL-462: compare the current (primary-root) source schema against the baseline
            // captured on the pipeline's last successful (non-dry) run.
            for {
              canRun       <- canRunF
              baselineJson <- pipelineRepo.findLastSourceSchema(pipelineId, user)
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
                costVerdict       = toCostVerdictResponse(costVerdict, canRun, analyzed),
                warnings          = warnings
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
      v:        PipelineCostEstimator.CostVerdict,
      canRun:   Boolean,
      analyzed: Vector[PipelineAnalyzeService.AnalyzedStep]
  ): CostVerdictResponse = {
    val configReasons = analyzed.flatMap(s => s.validationError.map(CostReasonResponse(PipelineAnalyzeService.StepConfigInvalidCode, _, Some(s.id))))
    CostVerdictResponse(
      autoRunnable  = v.autoRunnable && configReasons.isEmpty,
      estimatedRows = v.estimatedRows,
      stepCount     = v.stepCount,
      reasons       = v.reasons.map(r => CostReasonResponse(r.code, r.detail, r.stepId)) ++ configReasons,
      canRun        = canRun && configReasons.isEmpty
    )
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
          } yield (rootDataSourceIds.map(_._1.value), rootIdOfStep, rootSchemas.toMap, secondarySchemas, upsertProblems)

          rootFetch.map { case (rootIds, rootIdOfStep, schemasByRoot, secondarySchemas, upsertProblems) =>
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
            val graphPath    = RuntimeGraphPath.build(allSteps, rootIds, rootIdOfStepStr)
            val warningsByStep = AnalyzeSchemaWarnings.compute(nodeInputs, projections, secondarySchemas).groupMap(_.stepId)(_.message)
            val nodes = allSteps.filter(_.enabled).flatMap { s =>
              projections.get(s.id.value).map { analyzed =>
                ConciseAnalyzeNode(
                  path            = graphPath.pathOf(s),
                  op              = s.kind,
                  validationError = analyzed.validationError,
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
