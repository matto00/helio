package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineStepConfigCodec}
import com.helio.domain.history.{OutputCompare, PayloadOptIn}
import com.helio.domain.model.{OutputKind, PipelineStep, PipelineStepKind}
import com.helio.services.ServiceError
import org.slf4j.LoggerFactory
import spray.json.JsObject

import scala.annotation.tailrec
import scala.util.{Failure, Success}

/** HEL-1469: every check of a single-call `POST /api/pipelines` request that needs nothing but the request
 *  itself, so it can run BEFORE any inline root source is created. `PipelineService.buildStepsAction`/
 *  `buildOutputsAction` call the SAME per-step/per-Output helpers inside the write transaction as defense in
 *  depth, so the two entry points cannot drift in message or status. Schema-dependent checks (an Output
 *  `fieldMapping` naming a column) and ownership lookups are not request-only and stay in `PipelineService`. */
private[services] object PipelineCreatePreflight {

  private val log = LoggerFactory.getLogger(getClass)

  /** The owning-root index per step and per Output (parallel to the request's `steps`/`outputs`). */
  final case class RootIndices(steps: Vector[Option[Int]], outputs: Vector[Option[Int]])

  /** The whole request-only pass, in the order `PipelineService.create`'s "Exact sequence" documents: root
   *  indices (steps, then Outputs), lane pass 1 (every step), per-step checks in request order, per-Output
   *  checks in request order. */
  def run(req: CreatePipelineRequest): Either[ServiceError, RootIndices] =
    for {
      stepIdxs   <- traverse(req.steps)(resolveStepRootIndex(_, _, req.roots))
      outputIdxs <- traverse(req.outputs)(resolveOutputRootIndex(_, _, req.roots))
      _          <- laneChecks(req.steps)
      _          <- checkSteps(req.steps)
      _          <- checkOutputs(req.outputs, req.steps.map(_.clientId).toSet)
    } yield RootIndices(stepIdxs, outputIdxs)

  private def traverse[A, B](xs: Vector[A])(f: (A, Int) => Either[ServiceError, B]): Either[ServiceError, Vector[B]] =
    xs.zipWithIndex.foldLeft[Either[ServiceError, Vector[B]]](Right(Vector.empty)) { case (acc, (x, idx)) =>
      acc.flatMap(done => f(x, idx).map(done :+ _))
    }

  /** HEL-913 task 7.3a (R13): a PARENTLESS step's owning root as an INDEX into `roots`. A step with a
   *  `parentStepId` inherits its root implicitly and must NOT also name `rootClientId`; a parentless step
   *  with neither is fine with exactly one root and a named 400 with more; an unresolvable `rootClientId`
   *  is a named 400. `Right(None)` for a step whose parent supplies the root. */
  def resolveStepRootIndex(
      step: CreatePipelineTransactionalStepRequest,
      stepIdx: Int,
      roots: Vector[CreatePipelineRootRequest]
  ): Either[ServiceError, Option[Int]] =
    if (step.parentStepId.isDefined) {
      if (step.rootClientId.isDefined)
        Left(ServiceError.BadRequest(
          s"${PipelineService.stepAddress(stepIdx)}: names both parentStepId and rootClientId -- a step with a parent inherits its root implicitly"
        ))
      else Right(None)
    } else rootIndex(step.rootClientId, roots, PipelineService.stepAddress(stepIdx), "parentless with no rootClientId")

  /** HEL-913 task 7.3a-i: the Output-shaped sibling of [[resolveStepRootIndex]]. */
  def resolveOutputRootIndex(
      output: CreatePipelineTransactionalOutputRequest,
      outputIdx: Int,
      roots: Vector[CreatePipelineRootRequest]
  ): Either[ServiceError, Option[Int]] =
    if (output.nodeStepClientId.isDefined) {
      if (output.rootClientId.isDefined)
        Left(ServiceError.BadRequest(
          s"${PipelineService.outputAddress(outputIdx)}: names both nodeStepClientId and rootClientId -- a step-bound Output's root is implied by its step"
        ))
      else Right(None)
    } else rootIndex(output.rootClientId, roots, PipelineService.outputAddress(outputIdx), "root-bound with no rootClientId")

  private def rootIndex(
      rootClientId: Option[String],
      roots: Vector[CreatePipelineRootRequest],
      address: String,
      neitherDescription: String
  ): Either[ServiceError, Option[Int]] =
    rootClientId match {
      case Some(rcid) =>
        roots.indexWhere(_.clientId.contains(rcid)) match {
          case -1  => Left(ServiceError.BadRequest(s"$address: references unresolvable rootClientId '$rcid'"))
          case idx => Right(Some(idx))
        }
      case None =>
        if (roots.size > 1)
          Left(ServiceError.BadRequest(s"$address: is $neitherDescription, and this request names ${roots.size} roots -- name one explicitly"))
        else Right(Some(0))
    }

  /** Lane pass 1 (HEL-911 CR5): the request-scoped lane checks for EVERY step before any per-step check, as
   *  `validateStepCrossOwnerRefs` always ran them -- exists in THIS request (422), not the step itself (400),
   *  not an ancestor (400). A step whose config does not decode is skipped (pass 2 rejects it). */
  def laneChecks(steps: Vector[CreatePipelineTransactionalStepRequest]): Either[ServiceError, Unit] = {
    val byClientId: Map[String, CreatePipelineTransactionalStepRequest] = steps.map(s => s.clientId -> s).toMap

    def ancestorClientIds(step: CreatePipelineTransactionalStepRequest): Set[String] = {
      @tailrec
      def loop(cur: Option[String], acc: Set[String]): Set[String] = cur match {
        case None => acc
        case Some(parentClientId) =>
          byClientId.get(parentClientId) match {
            case Some(p) => loop(p.parentStepId, acc + parentClientId)
            case None    => acc
          }
      }
      loop(step.parentStepId, Set.empty)
    }

    def validateLane(step: CreatePipelineTransactionalStepRequest, typedConfig: Any): Either[ServiceError, Unit] =
      PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
        case None => Right(())
        case Some(dep) =>
          if (dep == step.clientId)
            Left(ServiceError.BadRequest(s"Lane reference '$dep' cannot reference the step itself."))
          else if (!byClientId.contains(dep))
            Left(ServiceError.UnprocessableEntity(s"Lane reference '$dep' does not exist in this request."))
          else if (ancestorClientIds(step).contains(dep))
            Left(ServiceError.BadRequest(s"Lane reference '$dep' would create a cycle (it is an ancestor of this step)."))
          else Right(())
      }

    steps.foldLeft[Either[ServiceError, Unit]](Right(())) { (acc, step) =>
      acc.flatMap { _ =>
        PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
          case Failure(_)           => Right(())
          case Success(typedConfig) => validateLane(step, typedConfig)
        }
      }
    }
  }

  private def checkSteps(steps: Vector[CreatePipelineTransactionalStepRequest]): Either[ServiceError, Unit] =
    steps.foldLeft[Either[ServiceError, Set[String]]](Right(Set.empty)) { (acc, spec) =>
      acc.flatMap(seen => checkStep(spec, seen).map(_ => seen + spec.clientId))
    }.map(_ => ())

  /** One step's request-only checks in the order the write path always ran them: duplicate `clientId`, step
   *  type, `parentStepId` resolving to an EARLIER `clientId` (`seen`), strict `rawConfigProblem` (422), decode
   *  (400), forward lane reference (400). Returns the decoded typed config so the transaction does not
   *  re-decode it. */
  def checkStep(spec: CreatePipelineTransactionalStepRequest, seen: Set[String]): Either[ServiceError, Any] =
    if (seen.contains(spec.clientId))
      Left(ServiceError.BadRequest(s"Duplicate step clientId: ${spec.clientId}"))
    else if (!PipelineStepKind.All.contains(spec.`type`))
      Left(ServiceError.BadRequest(
        s"Invalid step type '${spec.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      ))
    else if (spec.parentStepId.exists(!seen.contains(_)))
      Left(ServiceError.BadRequest(
        s"Step '${spec.clientId}' references unresolvable parentStepId '${spec.parentStepId.get}' -- it must be an earlier step's clientId in this same request"
      ))
    else
      PipelineStep.rawConfigProblem(spec.`type`, spec.config.compactPrint) match {
        case Some(problem) => Left(ServiceError.UnprocessableEntity(s"Step '${spec.clientId}': $problem"))
        case None =>
          PipelineStepConfigCodec.decode(spec.`type`, spec.config.compactPrint) match {
            case Failure(ex) =>
              log.warn(s"create (transactional): config decode failed for step type '${spec.`type`}'", ex)
              Left(ServiceError.BadRequest(s"Invalid '${spec.`type`}' config"))
            case Success(typedConfig) =>
              unresolvedLaneClientId(typedConfig, seen) match {
                case Some(unresolved) => Left(ServiceError.BadRequest(forwardLaneMessage(spec.clientId, unresolved)))
                case None             => Right(typedConfig)
              }
          }
      }

  /** A `lane`-kind `secondaryInput` naming a clientId not yet seen when the left-to-right build reaches the
   *  step (a forward reference -- `validateLane` only requires it exist somewhere in the request). */
  def unresolvedLaneClientId(typedConfig: Any, seen: Set[String]): Option[String] =
    PipelineStepConfigCodec.secondaryLaneStepId(typedConfig).filterNot(seen.contains)

  def forwardLaneMessage(clientId: String, unresolvedClientId: String): String =
    s"Step '$clientId' has a lane secondaryInput referencing '$unresolvedClientId', " +
      "which is not an earlier step's clientId in this same request -- a forward lane " +
      "reference is not yet supported via this single-call create path"

  private def checkOutputs(outputs: Vector[CreatePipelineTransactionalOutputRequest], stepClientIds: Set[String]): Either[ServiceError, Unit] =
    outputs.foldLeft[Either[ServiceError, Unit]](Right(())) { (acc, spec) =>
      acc.flatMap(_ => checkOutput(spec, stepClientIds).map(_ => ()))
    }

  /** One Output's request-only checks: `nodeStepClientId` resolvable, non-blank name, `OutputKind`, and the
   *  config-only validation. Returns the parsed kind. */
  def checkOutput(spec: CreatePipelineTransactionalOutputRequest, stepClientIds: Set[String]): Either[ServiceError, OutputKind] =
    spec.nodeStepClientId match {
      case Some(clientId) if !stepClientIds.contains(clientId) =>
        Left(ServiceError.BadRequest(
          s"Output '${spec.name}' references unresolvable nodeStepClientId '$clientId' -- it must be a step's clientId in this same request"
        ))
      case _ =>
        if (spec.name.trim.isEmpty) Left(ServiceError.BadRequest("name is required"))
        else
          OutputKind.fromString(spec.kind) match {
            case Left(msg)   => Left(ServiceError.BadRequest(msg))
            case Right(kind) => validateOutputConfig(kind, spec.config.getOrElse(JsObject.empty)).map(_ => kind)
          }
    }

  /** HEL-1273/HEL-1313 config-only checks (key set, aggregation/chartType, `compare`, payload opt-in); nothing
   *  is stored yet, so `stored` is empty. `config.compare` is checked unconditionally, before any `fieldMapping`
   *  work. */
  def validateOutputConfig(kind: OutputKind, config: JsObject): Either[ServiceError, Unit] =
    OutputConfigValidation.validate(kind, config, JsObject.empty)
      .flatMap(_ => OutputCompare.validateConfig(config))
      .flatMap(_ => PayloadOptIn.validateConfig(config))
      .left.map(msg => ServiceError.BadRequest(msg))
}
