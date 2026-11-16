package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.model.OutputKind
import spray.json.JsObject

/** HEL-1638: the ONE place a not-yet-persisted pipeline's per-node schemas are projected and an Output's `fieldMapping`
 *  is checked against its node. Both `PipelineCreateTransaction.createTransactional` (apply) and
 *  [[PipelineCreateDryRun]] (propose) call these functions, so propose and apply cannot drift. */
private[services] object PipelineOutputSchemas {

  /** `analyzed` is keyed by step `clientId`; `byRoot` by root INDEX-as-string (the `NodeStepInput.rootId` convention). */
  final case class NodeSchemas(analyzed: Map[String, PipelineAnalyzeService.AnalyzedStep], byRoot: Map[String, Vector[SchemaField]])

  /** Builds the `NodeStepInput`s (carrying each step's `enabled` flag, so a disabled step is transparent exactly as in
   *  analyze and the run) and runs `analyzeNodes`. `rootSchemas` is one schema per root, in request order. */
  def outputNodeSchemas(
      steps: Vector[CreatePipelineTransactionalStepRequest],
      stepRootIdxs: Vector[Option[Int]],
      rootSchemas: Vector[Vector[SchemaField]],
      secondarySchemas: Map[String, Vector[SchemaField]]
  ): NodeSchemas = {
    val byRoot = rootSchemas.zipWithIndex.map { case (schema, idx) => idx.toString -> schema }.toMap
    val inputs = nodeInputs(steps, stepRootIdxs)
    NodeSchemas(PipelineAnalyzeService.analyzeNodes(inputs, byRoot, secondarySchemas), byRoot)
  }

  def nodeInputs(steps: Vector[CreatePipelineTransactionalStepRequest], stepRootIdxs: Vector[Option[Int]]): Vector[PipelineAnalyzeService.NodeStepInput] =
    steps.zip(stepRootIdxs).zipWithIndex.map { case ((s, rootIdxOpt), idx) =>
      PipelineAnalyzeService.NodeStepInput(
        id           = s.clientId,
        parentStepId = s.parentStepId,
        position     = idx,
        op           = s.`type`,
        config       = s.config.compactPrint,
        rootId       = rootIdxOpt.map(_.toString),
        enabled      = s.enabled.getOrElse(true)
      )
    }

  /** The schema at an Output's node: its step's projected schema, else (root-bound) its own root's schema. */
  def nodeSchemaOf(spec: CreatePipelineTransactionalOutputRequest, rootIdx: Option[Int], schemas: NodeSchemas): Vector[SchemaField] =
    spec.nodeStepClientId.flatMap(schemas.analyzed.get).map(_.outputSchema)
      .getOrElse(rootIdx.flatMap(idx => schemas.byRoot.get(idx.toString)).getOrElse(Vector.empty))

  /** The Output's config + slot + column-at-node check; `Left` is apply's error, verbatim. */
  def outputMappingProblem(kind: OutputKind, config: JsObject, nodeSchema: Vector[SchemaField]): Either[ServiceError, Unit] =
    OutputFieldMappingCheck.validate(kind, config, nodeSchema)
}
