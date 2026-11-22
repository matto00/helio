package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.engine.{AnalyzeSchemaWarnings, PipelineAnalyzeService, SchemaField}
import com.helio.domain.model.{DataSource, DataSourceId, PipelineRootId, PipelineStep, PipelineStepId}

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1625 (design D3): the ONE projection of a pipeline's analyze `steps` and `warnings`, shared by
 *  `PipelineAnalyzeReads.analyze` (live-repo resolvers, one pipeline) and the batched
 *  `GET /api/pipelines/context-analyze` (map-backed resolvers, every owned pipeline). Both go through [[fetch]] and
 *  [[project]], so the two reads agree by construction; only where a source is looked up differs.
 *
 *  The three resolvers are deliberately separate and never merged here:
 *  - `rootSourceAsCaller`: each root source as the CALLER sees it (`findByIdOwned(_, caller)`);
 *  - `upsertTargetAsOwner`: an `upsertsource` existing-source target as the pipeline OWNER sees it, never the
 *    calling grantee (HEL-1265), so an editor's analyze of an owner's upsert target reports no `validationError`;
 *  - `secondarySource`: a join/union/lookup secondary source, privileged (`findByIdInternal`). */
private[pipelines] object PipelineAnalyzeProjection {

  type Resolver = DataSourceId => Future[Option[DataSource]]

  final case class Resolvers(rootSourceAsCaller: Resolver, upsertTargetAsOwner: Resolver, secondarySource: Resolver)

  /** The async reads a projection needs. `rootDsOpts` is `(rootId, source as the caller sees it)` per root. */
  final case class Fetched(
      rootDsOpts:       Vector[(String, Option[DataSource])],
      secondarySchemas: Map[String, Vector[SchemaField]],
      upsertProblems:   Map[String, String]
  )

  final case class Projected(
      rootSchemas:  Vector[(String, String, Vector[SchemaField])],
      projections:  Map[String, PipelineAnalyzeService.AnalyzedStep],
      warnings:     Vector[AnalyzeSchemaWarnings.Warning],
      analyzed:     Vector[PipelineAnalyzeService.AnalyzedStep],
      nodeInputs:   Vector[PipelineAnalyzeService.NodeStepInput]
  )

  def fetch(
      allSteps:          Vector[PipelineStep],
      rootDataSourceIds: Vector[(PipelineRootId, DataSourceId)],
      resolvers:         Resolvers
  )(implicit ec: ExecutionContext): Future[Fetched] =
    for {
      rootDsOpts       <- Future.traverse(rootDataSourceIds) { case (rootId, dsId) =>
                            resolvers.rootSourceAsCaller(dsId).map(dsOpt => (rootId.value, dsOpt))
                          }
      // HEL-1236: source-kind join secondaries' schemas, so a join's renamed columns project.
      secondarySchemas <- PipelineStepOwnership.resolveSecondarySourceSchemas(
                            allSteps.map(s => s.kind -> PipelineStepConfigCodec.encode(s)), resolvers.secondarySource
                          )
      upsertProblems   <- UpsertTargetAnalysis.problems(
                            allSteps.map(s => (s.id.value, s.kind, PipelineStepConfigCodec.encode(s))), resolvers.upsertTargetAsOwner
                          )
    } yield Fetched(rootDsOpts, secondarySchemas, upsertProblems)

  /** HEL-913 task 7.2c fold-in: built from EVERY step (enabled or not), never pre-filtered -- a disabled step still
   *  occupies a real position in the `parentStepId` graph; `analyzeNodes` makes a disabled node transparent. */
  def nodeInputsOf(allSteps: Vector[PipelineStep], rootIdOfStep: Map[PipelineStepId, PipelineRootId]): Vector[PipelineAnalyzeService.NodeStepInput] =
    allSteps.map(s =>
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

  /** The pure half: caller-view schemas, warnings, and the enabled steps' results. `ownerSchemas` is `None` for the
   *  pipeline owner (the caller view IS the owner's). */
  def project(
      allSteps:     Vector[PipelineStep],
      rootIdOfStep: Map[PipelineStepId, PipelineRootId],
      fetched:      Fetched,
      ownerSchemas: Option[Map[String, Vector[SchemaField]]]
  ): Projected = {
    val rootSchemas = fetched.rootDsOpts.map { case (rid, dsOpt) =>
      (rid, dsOpt.map(_.name).getOrElse(""), dsOpt.map(_.inferredSchema).getOrElse(Vector.empty[SchemaField]))
    }
    val schemasByRoot = rootSchemas.map { case (rid, _, schema) => rid -> schema }.toMap
    val nodeInputs    = nodeInputsOf(allSteps, rootIdOfStep)
    val projections   = UpsertTargetAnalysis.overlay(
      PipelineAnalyzeService.analyzeNodes(nodeInputs, schemasByRoot, fetched.secondarySchemas), fetched.upsertProblems
    )
    val warnings = AnalyzeSchemaWarnings.compute(nodeInputs, projections, fetched.secondarySchemas)
    // Reassemble in the SAME order the enabled steps list them; a node that never resolved (unknown parentStepId,
    // dangling lane reference) is simply absent. HEL-1661 D2 / HEL-1799 D1: a non-owner's step validity is judged
    // against the owner's root schemas; schemas, warnings and everything else stay caller-view.
    val validated = nonOwnerValidity(projections, nodeInputs, ownerSchemas, fetched.secondarySchemas, fetched.upsertProblems)
    val analyzed  = allSteps.filter(_.enabled).flatMap(s => validated.get(s.id.value))
    Projected(rootSchemas, projections, warnings, analyzed, nodeInputs)
  }

  /** HEL-1799 D1: the per-step result with a non-owner's `validationError` judged against the owner's schemas and
   *  mapped through `nonOwnerValidationError`; every other field is the caller-view one. For the owner (`None`) the
   *  caller view is returned unchanged. Shared by `analyze`, `analyzeConcise` and the batched read. */
  def nonOwnerValidity(
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
}
