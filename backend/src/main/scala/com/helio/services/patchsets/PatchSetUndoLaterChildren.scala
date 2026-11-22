package com.helio.services.patchsets

import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, PipelineId, PipelineRoot, PipelineStep}
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledEdit

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1795: undoing a `pipeline` or `pipelineStep` create deletes the pipeline's (or step's) Outputs and steps through FK
 *  cascades, which ignore RLS. Undo refuses (409, nothing restored) rather than delete one the patch set did not create,
 *  whoever added it. This is [[PatchSetUndoBoundPanels]]'s sibling for Outputs and steps, over the same doomed set
 *  ([[PatchSetUndoBoundPanels.doomedRows]]).
 *
 *  Excused (created by the same application): the `newId` of every `output` / `pipelineStep` create edit (defensive: not
 *  reachable through apply, a same-set create cannot target a pipeline or step the same set creates), plus, on the
 *  `pipeline` arm, the ids the apply journaled as `createdChildren`. A `pipeline` row with no `createdChildren` (written
 *  before HEL-1795) falls back to: an Output is excused iff the applier owns it and it was created at or before
 *  `appliedAt`; a step iff created at or before `appliedAt`. A `pipelineStep` create has no fallback: only same-set
 *  creates are excused.
 *
 *  HEL-1811 adds what the same deletes cascade into besides Outputs and steps: alert rules on a doomed Output (every arm,
 *  the `output` create included), and, on the `pipeline` arm, the pipeline's schedule and its roots. A patch set has no
 *  alert-rule or schedule target kind, so none is ever excused: every rule on a doomed Output and any schedule was added
 *  after the apply. A root is excused iff the create made it (`createdChildren.rootIds`); a row without `rootIds` falls
 *  back to `created_at <= appliedAt`. Blocking is the safe direction in doubt. */
private[services] object PatchSetUndoLaterChildren {

  def guards(edit: JournaledEdit): Boolean = edit.op == "create" && Set("pipeline", "pipelineStep", "output").contains(edit.targetKind)

  final case class Later(
      outputs: Vector[Output],
      steps: Vector[PipelineStep],
      alertRules: Vector[PatchSetUndoBoundPanels.AlertRuleRow] = Vector.empty,
      schedule: Boolean = false,
      roots: Vector[PipelineRoot] = Vector.empty
  ) {
    def isEmpty: Boolean = outputs.isEmpty && steps.isEmpty && alertRules.isEmpty && !schedule && roots.isEmpty
    def size: Int        = outputs.size + steps.size + alertRules.size + (if (schedule) 1 else 0) + roots.size
  }

  /** The Outputs and steps `edit`'s undo would delete that the patch set did not create. */
  def blocking(edit: JournaledEdit, edits: Vector[JournaledEdit], appliedAt: Instant, applier: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Later] =
    PatchSetUndoBoundPanels.doomedRows(edit, ctx).flatMap { rows =>
      def createdIds(kind: String) = edits.filter(e => e.targetKind == kind && e.op == "create").flatMap(_.newId).toSet
      val setOutputs = createdIds("output")
      val setSteps   = createdIds("pipelineStep")
      val children   = if (edit.targetKind == "pipeline") edit.createdChildren else None
      val outputExcused: Output => Boolean = o =>
        setOutputs.contains(o.id.value) || (children match {
          case Some(c) => c.outputIds.contains(o.id.value)
          case None    => edit.targetKind == "pipeline" && o.ownerId == applier.id && !o.createdAt.isAfter(appliedAt)
        })
      val stepExcused: PipelineStep => Boolean = st =>
        setSteps.contains(st.id.value) || (children match {
          case Some(c) => c.stepIds.contains(st.id.value)
          case None    => edit.targetKind == "pipeline" && !st.createdAt.isAfter(appliedAt)
        })
      val outputs = rows.outputs.filterNot(outputExcused).sortBy(_.id.value)
      val steps   = rows.steps.filterNot(stepExcused).sortBy(_.id.value)
      val pipeline = edit.targetKind == "pipeline"
      for {
        doomedOutputs <- PatchSetUndoBoundPanels.doomedOutputIds(edit, ctx)
        rules         <- ctx.outputRepo.findAlertRuleDefinitionsInternal(doomedOutputs).map(_.values.flatten.toVector.sortBy(_._1))
        schedule      <- if (pipeline) edit.newId.fold(Future.successful(false))(id => ctx.pipelineRepo.findScheduleDefinitionInternal(PipelineId(id)).map(_.isDefined)) else Future.successful(false)
        roots         <- if (pipeline) edit.newId.fold(Future.successful(Vector.empty[PipelineRoot]))(id => ctx.pipelineRepo.listRootsInternal(PipelineId(id))) else Future.successful(Vector.empty[PipelineRoot])
      } yield {
        val rootExcused: PipelineRoot => Boolean = r =>
          children.flatMap(_.rootIds) match {
            case Some(ids) => ids.contains(r.id.value)
            case None      => !r.createdAt.isAfter(appliedAt)
          }
        Later(outputs, steps, rules, schedule, roots.filterNot(rootExcused).sortBy(_.id.value))
      }
    }

  /** The Phase-1 blockers for `edit` (one string per kind that blocks), or empty. Names the Outputs the undoing user can
   *  read, describes steps by op and position when they can read the pipeline, counts the rest; never an id. */
  def blockers(edit: JournaledEdit, edits: Vector[JournaledEdit], appliedAt: Instant, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Vector[String]] =
    blocking(edit, edits, appliedAt, user, ctx).flatMap { later =>
      val head = s"edit ${edit.index} (${edit.targetKind} create)"
      val outputsMsg: Future[Option[String]] =
        if (later.outputs.isEmpty) Future.successful(None)
        else
          PatchSetUndoBoundPanels
            .nameList(later.outputs.map(_.id.value), describeOutput(_, user, ctx), "Output(s) you cannot see")
            .map(parts =>
              Some(s"$head: ${later.outputs.size} Output(s) were added after the patch set was applied and would be deleted: $parts; remove them before undoing")
            )
      val stepsMsg: Future[Option[String]] =
        if (later.steps.isEmpty) Future.successful(None)
        else
          PatchSetUndoBoundPanels
            .nameList(later.steps.map(_.id.value), describeStep(_, later.steps, user, ctx), "step(s) you cannot see")
            .map(parts =>
              Some(s"$head: ${later.steps.size} pipeline step(s) were added after the patch set was applied and would be deleted: $parts; remove them before undoing")
            )
      val rulesMsg: Future[Option[String]] =
        if (later.alertRules.isEmpty) Future.successful(None)
        else
          PatchSetUndoBoundPanels.alertRuleClause(later.alertRules, user, ctx.outputRepo).map(
            _.map(parts => s"$head: ${later.alertRules.size} alert rule(s) were added after the patch set was applied and would be deleted: $parts; remove them before undoing")
          )
      val scheduleMsg: Option[String] =
        Some(s"$head: the pipeline has a schedule that was added after the patch set was applied and would be deleted; remove it before undoing").filter(_ => later.schedule)
      val rootsMsg: Future[Option[String]] =
        if (later.roots.isEmpty) Future.successful(None)
        else
          PatchSetUndoBoundPanels
            .nameList(later.roots.map(_.id.value), describeRoot(_, later.roots, user, ctx), "root(s) on data sources you cannot see")
            .map(parts => Some(s"$head: ${later.roots.size} root(s) were added after the patch set was applied and would be deleted: $parts; remove them before undoing"))
      for { o <- outputsMsg; s <- stepsMsg; a <- rulesMsg; r <- rootsMsg } yield Vector(o, s, a, scheduleMsg, r).flatten
    }

  /** `root on data source "<name>"` when the undoing user owns the data source, else `None` (counted, never named). Data
   *  sources have no sharing: the only policy on `data_sources` is the owner-only `data_sources_owner` (V35) and no grant
   *  table names one, so "owned" and "readable" are the same set and the owner-scoped `DataSourceRepository.findByIdOwned`
   *  is the readable-source read. */
  private def describeRoot(id: String, roots: Vector[PipelineRoot], user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] =
    roots.find(_.id.value == id) match {
      case None => Future.successful(None)
      case Some(root) =>
        ctx.dataSourceRepo.findByIdOwned(root.dataSourceId, user).map(_.map(ds => s"""root on data source "${ds.name}""""))
    }

  private def describeOutput(id: String, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    ctx.outputRepo.findById(OutputId(id), user).map(_.map(o => s"""Output "${o.name}""""))

  private def describeStep(id: String, steps: Vector[PipelineStep], user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] =
    steps.find(_.id.value == id) match {
      case None => Future.successful(None)
      case Some(step) =>
        ctx.pipelineRepo.findByIdShared(step.pipelineId, Some(user)).map(_.map(_ => s"${step.kind} step at position ${step.position}"))
    }

  /** The fixed Phase-2 failure phrase: a count only, never a name or id (it is logged at ERROR). */
  def addedDuringUndo(count: Int): String =
    s"$count Output(s), pipeline step(s), alert rule(s), schedule(s) or root(s) were added during the undo; nothing further was undone"

  /** The fixed Phase-2 failure phrase of the `output` arm's in-transaction re-count (counts only). */
  def outputBoundDuringUndo(panels: Int, alertRules: Int): String =
    Vector(
      Some(PatchSetUndoBoundPanels.boundDuringUndo(panels)).filter(_ => panels > 0),
      Some(s"$alertRules alert rule(s) were added during the undo; nothing further was undone").filter(_ => alertRules > 0)
    ).flatten.mkString("; ")
}
