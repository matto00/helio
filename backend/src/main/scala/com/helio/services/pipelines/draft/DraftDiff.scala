package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftOutputRequest, DraftSaveRequest, DraftStepRequest, PipelineStepConfigCodec}
import com.helio.domain.model.{OutputKind, PipelineStep, PipelineStepKind}
import com.helio.domain.steps.{UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.pipelines.OutputRepository.OutputRow
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository.PipelineStepRow
import com.helio.infrastructure.persistence.pipelines.{DefinitionRows, OutputWrite, StepWrite}
import com.helio.services.ServiceError
import com.helio.services.pipelines.{OutputService, PipelineCreatePreflight}
import spray.json._

import scala.annotation.tailrec
import scala.util.{Failure, Success, Try}

/** A created or content-changed step, with its decoded config, for the ownership checks that need the database. */
final case class CheckedConfig(draftKey: String, stepId: String, typedConfig: Any)

/** What a draft changes. `finalSteps` is the whole final tree. Everything else is a delta against the stored definition:
 *  `creates` are parents-first, `relinks` change a surviving step's parent, root or position, `contentUpdates` its config
 *  or `enabled`. `removedStepIds` is EXACTLY the stored steps the draft omits: the server never deletes a step the draft
 *  keeps, so splice and absorb semantics are the client's job when it builds the tree (design D2). */
final case class DraftPlan(
    finalSteps: Vector[StepWrite],
    creates: Vector[StepWrite],
    relinks: Vector[StepWrite],
    contentUpdates: Vector[StepWrite],
    oldConfigs: Map[String, String],
    removedStepIds: Set[String],
    outputCreates: Vector[OutputWrite],
    outputUpdates: Vector[OutputWrite],
    removedOutputIds: Vector[String],
    checkedConfigs: Vector[CheckedConfig],
    needsAdvisory: Boolean
) {
  def removesAnything: Boolean = removedStepIds.nonEmpty || removedOutputIds.nonEmpty

  /** The draft keys and normalised configs the async checks covered: a re-plan on the locked state may only check a subset. */
  def checkedKeys: Map[String, String] =
    checkedConfigs.map(c => c.draftKey -> PipelineStepConfigCodec.encodeConfig(c.typedConfig)).toMap
}

/** Pure planner behind `POST /api/pipelines/:id/draft/save` (HEL-1629 task 3.2): validates the draft as a forest, resolves
 *  client ids, and diffs it against the stored definition. No I/O, so it is exercised exhaustively without a database.
 *
 *  `allowExplicitIds` is true only when the server restores a journaled definition (undo): an `id` that is not currently a
 *  step of this pipeline is then a step to recreate under that very id. A public request never sets it. */
object DraftDiff {

  private final case class Resolved(req: DraftStepRequest, key: String, id: String, created: Boolean)

  private def bad(message: String): Left[ServiceError, Nothing] = Left(ServiceError.BadRequest(message))

  def plan(
      current: DefinitionRows,
      req: DraftSaveRequest,
      allowExplicitIds: Boolean,
      newId: () => String
  ): Either[ServiceError, DraftPlan] = {
    val curSteps   = current.steps.map(s => s.id -> s).toMap
    val curOutputs = current.outputs.map(o => o.id -> o).toMap
    for {
      resolved   <- resolveSteps(req.steps, curSteps, allowExplicitIds, newId)
      byId        = resolved.map(r => r.id -> r).toMap
      clientIds   = resolved.collect { case r if r.req.clientId.isDefined => r.req.clientId.get -> r.id }.toMap
      parents    <- resolveParents(resolved, byId, clientIds, current.rootIds.toSet)
      _          <- requireAcyclic(resolved, parents)
      normalized <- normalizeSteps(resolved, curSteps, clientIds)
      survivors   = resolved.filter(!_.created)
      removed     = curSteps.keySet -- survivors.map(_.id)
      finalSteps  = resolved.map(r => toWrite(r, parents(r.id), normalized(r.id)))
      _          <- requireLaneTargetsExist(finalSteps, byId.keySet)
      outputPlan <- planOutputs(req.outputs, current, curOutputs, byId, removed, current.rootIds.toSet, allowExplicitIds, newId)
    } yield {
      val finalById = finalSteps.map(w => w.id -> w).toMap
      val creates   = orderParentsFirst(resolved.filter(_.created).map(r => finalById(r.id)))
      val changed = survivors.map(r => (curSteps(r.id), finalById(r.id)))
      val relinks = changed.collect { case (cur, fin) if cur.parentStepId != fin.parentStepId || cur.rootId != fin.rootId || cur.position != fin.position => fin }
      val contentChanged = changed.filter { case (cur, fin) => cur.enabled != fin.enabled || !sameConfig(cur.config, fin.config) }
      val contentUpdates = contentChanged.map(_._2)
      val checkedIds     = (creates.map(_.id) ++ contentUpdates.map(_.id)).toSet
      val checked = resolved.filter(r => checkedIds.contains(r.id)).flatMap { r =>
        PipelineStepConfigCodec.decode(r.req.`type`, finalById(r.id).config).toOption.map(CheckedConfig(r.key, r.id, _))
      }
      DraftPlan(
        finalSteps = finalSteps,
        creates = creates,
        relinks = relinks,
        contentUpdates = contentUpdates,
        oldConfigs = contentChanged.map { case (cur, _) => cur.id -> cur.config }.toMap,
        removedStepIds = removed,
        outputCreates = outputPlan.creates,
        outputUpdates = outputPlan.updates,
        removedOutputIds = outputPlan.removed,
        checkedConfigs = checked,
        needsAdvisory = checked.exists(c => upsertsToExistingSource(c.typedConfig))
      )
    }
  }

  // ── Steps ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private def resolveSteps(
      steps: Vector[DraftStepRequest],
      curSteps: Map[String, PipelineStepRow],
      allowExplicitIds: Boolean,
      newId: () => String
  ): Either[ServiceError, Vector[Resolved]] = {
    val resolved = steps.zipWithIndex.map { case (s, i) =>
      (s.id.map(_.trim).filter(_.nonEmpty), s.clientId.map(_.trim).filter(_.nonEmpty)) match {
        case (Some(_), Some(_)) => bad(s"steps[$i]: specify either id or clientId, not both")
        case (None, None)       => bad(s"steps[$i]: id or clientId is required")
        case (Some(id), None) =>
          if (curSteps.contains(id)) Right(Resolved(s, id, id, created = false))
          else if (allowExplicitIds) Right(Resolved(s, id, id, created = true))
          else bad(s"steps[$i]: id '$id' is not a step of this pipeline (new steps carry a clientId)")
        case (None, Some(cid)) => Right(Resolved(s, cid, newId(), created = true))
      }
    }
    sequence(resolved).flatMap { all =>
      val dupKeys = all.groupBy(_.key).collect { case (k, v) if v.size > 1 => k }
      if (dupKeys.nonEmpty) bad(s"Duplicate step id or clientId in the draft: ${dupKeys.toVector.sorted.mkString(", ")}")
      else
        all.zipWithIndex.collectFirst {
          case (r, i) if !PipelineStepKind.All.contains(r.req.`type`) =>
            s"steps[$i]: invalid step type '${r.req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
          case (r, i) if r.req.position < 0 => s"steps[$i]: position must not be negative"
        }.fold[Either[ServiceError, Vector[Resolved]]](Right(all))(msg => bad(msg))
    }
  }

  /** The final `(parentStepId, rootId)` of every step: exactly one of parent (an id or a clientId) or root, the parent a step
   *  OF THE DRAFT (a removed step cannot have children), the root one of this pipeline's. */
  private def resolveParents(
      steps: Vector[Resolved],
      byId: Map[String, Resolved],
      clientIds: Map[String, String],
      rootIds: Set[String]
  ): Either[ServiceError, Map[String, (Option[String], Option[String])]] =
    sequence(steps.map { r =>
      val s = r.req
      def placed(parent: Option[String], root: Option[String]): Either[ServiceError, (String, (Option[String], Option[String]))] =
        Right(r.id -> ((parent, root)))
      val named = Vector(s.parentStepId.filter(_.nonEmpty), s.parentClientId.filter(_.nonEmpty), s.rootId.filter(_.nonEmpty))
      if (named.count(_.isDefined) != 1)
        bad(s"Step '${r.key}': name exactly one of parentStepId, parentClientId or rootId (a parentless step names its root)")
      else (named(0), named(1), named(2)) match {
        case (Some(pid), _, _) =>
          if (byId.contains(pid)) placed(Some(pid), None)
          else bad(s"Step '${r.key}': parentStepId '$pid' is not in the draft (a removed step cannot have children)")
        case (_, Some(cid), _) =>
          clientIds.get(cid) match {
            case Some(real) => placed(Some(real), None)
            case None       => bad(s"Step '${r.key}': parentClientId '$cid' does not name a new step of this draft")
          }
        case (_, _, Some(root)) =>
          if (rootIds.contains(root)) placed(None, Some(root))
          else bad(s"Step '${r.key}': rootId '$root' is not a root of this pipeline")
        case _ => bad(s"Step '${r.key}': no parent or root")
      }
    }).map(_.toMap)

  private def requireAcyclic(steps: Vector[Resolved], parents: Map[String, (Option[String], Option[String])]): Either[ServiceError, Unit] = {
    def reachesRoot(start: String): Boolean = {
      @tailrec
      def loop(cur: String, seen: Set[String]): Boolean =
        parents(cur)._1 match {
          case None                      => true
          case Some(p) if seen.contains(p) => false
          case Some(p)                   => loop(p, seen + p)
        }
      loop(start, Set(start))
    }
    steps.find(r => !reachesRoot(r.id)).fold[Either[ServiceError, Unit]](Right(()))(r =>
      bad(s"Step '${r.key}': the draft's parent links form a cycle")
    )
  }

  /** The stored `config` text each step would have: validated (strict, then decode) and lane clientIds rewritten to real ids,
   *  then encoded. A surviving step whose draft config is the stored config is not re-validated (an unchanged legacy config
   *  must still save), but any step whose config differs, and every new step, is. */
  private def normalizeSteps(
      steps: Vector[Resolved],
      curSteps: Map[String, PipelineStepRow],
      clientIds: Map[String, String]
  ): Either[ServiceError, Map[String, String]] =
    sequence(steps.map { r =>
      val rawDraft = r.req.config.compactPrint
      curSteps.get(r.id) match {
        case Some(cur) if !r.created && cur.op != r.req.`type` =>
          bad(s"Step '${r.key}': cannot change type from '${cur.op}' to '${r.req.`type`}'; remove it and add a new step")
        case Some(cur) if !r.created && sameConfig(cur.config, rawDraft) =>
          Right(r.id -> cur.config)
        case Some(cur) if !r.created =>
          validatedConfig(r, rawDraft, clientIds).map { encoded =>
            // Semantically unchanged (the stored text is an older encoding of the same typed config): keep the stored text.
            val storedAgain = PipelineStepConfigCodec.decode(cur.op, cur.config).toOption.flatMap(c => Try(PipelineStepConfigCodec.encodeConfig(c)).toOption)
            r.id -> (if (storedAgain.exists(sameConfig(_, encoded))) cur.config else encoded)
          }
        case _ => validatedConfig(r, rawDraft, clientIds).map(r.id -> _)
      }
    }).map(_.toMap)

  private def validatedConfig(r: Resolved, raw: String, clientIds: Map[String, String]): Either[ServiceError, String] =
    PipelineStep.rawConfigProblem(r.req.`type`, raw) match {
      case Some(problem) => bad(s"Step '${r.key}': $problem")
      case None =>
        PipelineStepConfigCodec.decode(r.req.`type`, raw) match {
          case Failure(_) => bad(s"Step '${r.key}': Invalid '${r.req.`type`}' config")
          case Success(typed) =>
            PipelineCreatePreflight.rewriteLaneClientId(typed, id => clientIds.get(id).orElse(Some(id))).left.map(unresolved =>
              ServiceError.BadRequest(s"Step '${r.key}': lane reference '$unresolved' does not resolve"): ServiceError
            ).flatMap(rewritten => Try(PipelineStepConfigCodec.encodeConfig(rewritten)).toEither.left.map(_ =>
              ServiceError.BadRequest(s"Step '${r.key}': Invalid '${r.req.`type`}' config"): ServiceError
            ))
        }
    }

  /** A lane reference must name a step of the final tree (a removed target would leave it dangling). */
  private def requireLaneTargetsExist(finalSteps: Vector[StepWrite], ids: Set[String]): Either[ServiceError, Unit] =
    finalSteps.view.flatMap { w =>
      PipelineStepConfigCodec.decode(w.op, w.config).toOption.flatMap(PipelineStepConfigCodec.secondaryLaneStepId).filterNot(ids.contains).map(w -> _)
    }.headOption.fold[Either[ServiceError, Unit]](Right(())) { case (w, target) =>
      bad(s"Step '${w.id}' has a lane reference to '$target', which is not a step of the draft")
    }

  private def toWrite(r: Resolved, parent: (Option[String], Option[String]), config: String): StepWrite =
    StepWrite(r.id, r.req.`type`, config, r.req.enabled.getOrElse(true), parent._1, parent._2, r.req.position)

  /** Parents before children, so an insert never references a row that does not exist yet. */
  private def orderParentsFirst(created: Vector[StepWrite]): Vector[StepWrite] = {
    val ids = created.map(_.id).toSet
    val byParent = created.groupBy(_.parentStepId)
    def visit(w: StepWrite): Vector[StepWrite] = w +: byParent.getOrElse(Some(w.id), Vector.empty).flatMap(visit)
    // Entry points: created steps whose parent is an existing step or a root.
    created.filter(w => w.parentStepId.forall(p => !ids.contains(p))).flatMap(visit)
  }

  private def sameConfig(storedOrEncoded: String, other: String): Boolean =
    (Try(storedOrEncoded.parseJson), Try(other.parseJson)) match {
      case (Success(a), Success(b)) => a == b
      case _                        => storedOrEncoded == other
    }

  private def upsertsToExistingSource(typed: Any): Boolean = typed match {
    case UpsertSourceConfig(UpsertTarget.ExistingSource(id), _) => id.trim.nonEmpty
    case _                                                       => false
  }

  // ── Outputs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private final case class OutputPlan(creates: Vector[OutputWrite], updates: Vector[OutputWrite], removed: Vector[String])

  private def planOutputs(
      draft: Vector[DraftOutputRequest],
      current: DefinitionRows,
      curOutputs: Map[String, OutputRow],
      stepsById: Map[String, Resolved],
      removedSteps: Set[String],
      rootIds: Set[String],
      allowExplicitIds: Boolean,
      newId: () => String
  ): Either[ServiceError, OutputPlan] = {
    val stepClientIds = stepsById.values.collect { case r if r.req.clientId.isDefined => r.req.clientId.get -> r.id }.toMap
    val resolved = draft.zipWithIndex.map { case (o, i) =>
      val label = s"outputs[$i]"
      for {
        idKey <- (o.id.map(_.trim).filter(_.nonEmpty), o.clientId.map(_.trim).filter(_.nonEmpty)) match {
          case (Some(_), Some(_)) => bad(s"$label: specify either id or clientId, not both")
          case (None, None)       => bad(s"$label: id or clientId is required")
          case (Some(id), None) =>
            if (curOutputs.contains(id)) Right((id, id, false))
            else if (allowExplicitIds) Right((id, id, true))
            else bad(s"$label: id '$id' is not an Output of this pipeline (new Outputs carry a clientId)")
          case (None, Some(cid)) => Right((cid, newId(), true))
        }
        kind <- if (o.name.trim.isEmpty) bad(s"$label: name is required") else OutputKind.fromString(o.kind).left.map(m => ServiceError.BadRequest(s"$label: $m"): ServiceError)
        node <- resolveNode(label, o, stepsById, stepClientIds, removedSteps, rootIds)
      } yield (o, idKey._1, idKey._2, idKey._3, kind, node)
    }
    sequence(resolved).flatMap { all =>
      val dup = all.groupBy(_._2).collect { case (k, v) if v.size > 1 => k }
      if (dup.nonEmpty) bad(s"Duplicate Output id or clientId in the draft: ${dup.toVector.sorted.mkString(", ")}")
      else {
        val survivorIds = all.collect { case (_, _, id, false, _, _) => id }.toSet
        val perOutput = all.map { case (o, key, id, created, kind, (nodeStep, root)) =>
          val config = o.config.getOrElse(JsObject.empty)
          val write  = OutputWrite(id, o.name.trim, OutputKind.asString(kind), nodeStep, root, config)
          curOutputs.get(id) match {
            case Some(cur) if !created =>
              if (cur.kind != write.kind) bad(s"Output '$key': cannot change kind from '${cur.kind}' to '${write.kind}'")
              else if (cur.nodeStepId != write.nodeStepId || cur.rootId != write.rootId)
                bad(s"Output '$key': an Output cannot move to another node or root; remove it and add a new one")
              else if (cur.name == write.name && cur.config == write.config) Right((None, None))
              else OutputService.validateConfig(kind, config, JsObject.empty).map(_ => (None, Some(write)))
            case _ => OutputService.validateConfig(kind, config, JsObject.empty).map(_ => (Some(write), None))
          }
        }
        sequence(perOutput).map { results =>
          val cascaded = curOutputs.valuesIterator.filter(o => o.nodeStepId.exists(removedSteps.contains)).map(_.id)
          val explicit = curOutputs.keysIterator.filterNot(survivorIds.contains)
          OutputPlan(results.flatMap(_._1), results.flatMap(_._2), (explicit ++ cascaded).toVector.distinct.sorted)
        }
      }
    }
  }

  /** `(nodeStepId, rootId)` of an Output: exactly one of a step of the draft (by id or clientId) or a root of the pipeline. */
  private def resolveNode(
      label: String,
      o: DraftOutputRequest,
      stepsById: Map[String, Resolved],
      stepClientIds: Map[String, String],
      removedSteps: Set[String],
      rootIds: Set[String]
  ): Either[ServiceError, (Option[String], Option[String])] = {
    val named = Vector(o.nodeStepId.filter(_.nonEmpty), o.nodeStepClientId.filter(_.nonEmpty), o.rootId.filter(_.nonEmpty))
    if (named.count(_.isDefined) != 1) bad(s"$label: name exactly one of nodeStepId, nodeStepClientId or rootId")
    else (named(0), named(1), named(2)) match {
      case (Some(sid), _, _) =>
        if (removedSteps.contains(sid)) bad(s"$label: nodeStepId '$sid' is a step the draft removes")
        else if (stepsById.contains(sid)) Right((Some(sid), None))
        else bad(s"$label: nodeStepId '$sid' is not a step of the draft (a new step is named by nodeStepClientId)")
      case (_, Some(cid), _) =>
        stepClientIds.get(cid).map(real => (Some(real), None: Option[String])).toRight[ServiceError](
          ServiceError.BadRequest(s"$label: nodeStepClientId '$cid' does not name a new step of this draft")
        )
      case (_, _, Some(root)) =>
        if (rootIds.contains(root)) Right((None, Some(root))) else bad(s"$label: rootId '$root' is not a root of this pipeline")
      case _ => bad(s"$label: no node or root")
    }
  }

  private def sequence[A](xs: Vector[Either[ServiceError, A]]): Either[ServiceError, Vector[A]] =
    xs.foldLeft[Either[ServiceError, Vector[A]]](Right(Vector.empty))((acc, x) => acc.flatMap(done => x.map(done :+ _)))
}
