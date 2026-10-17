package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.SqlTextArrays.setTextArray
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext

/** One place in the pipeline-definition lock protocol (HEL-1629, `docs/live-draft-preview.md` section 8.3): a lock the draft
 *  save takes, a lock a writer of fingerprinted state takes, or one of the ordering amendments the probes forced. Each is a
 *  separately switchable site ONLY so a spec can remove it and watch the race or deadlock spec go red (the recorded
 *  mutation every required spec owes). Production always runs [[PipelineDefinitionLocks.Enforced]]. */
final case class LockSite(label: String) {
  override def toString: String = label
}

object LockSite {
  // The save's own locks, in protocol order.
  val SavePanels: LockSite   = LockSite("save.panels")   // (1) lockForDeletion
  val SaveAdvisory: LockSite = LockSite("save.advisory") // (2) the cycle advisory lock, when an upsert edge changes
  val SavePipeline: LockSite = LockSite("save.pipeline") // (3) pipeline row FOR NO KEY UPDATE
  val SaveRules: LockSite    = LockSite("save.rules")    // (4) alert rules FOR UPDATE
  val SaveOutputs: LockSite  = LockSite("save.outputs")  // (5) Outputs FOR UPDATE

  // Ordering amendments: when INACTIVE the save uses the order the probes proved deadlocks.
  val SavePanelsFirst: LockSite        = LockSite("save.order.panelsFirst")        // inactive: pipeline, rules, Outputs, THEN panels (the 8.3 earlier order)
  val SaveOutputsByPosition: LockSite  = LockSite("save.order.outputsByPosition")  // inactive: Outputs by id (deadlocks with the node-snapshot txn)
  val SaveRulesBeforeOutputs: LockSite = LockSite("save.order.rulesBeforeOutputs") // inactive: Outputs then rules (deadlocks with the alert evaluator)

  // Writers that gain lock (3) (task 4.1).
  val StepUpdate: LockSite         = LockSite("step.update")
  val StepInsert: LockSite         = LockSite("step.insert")
  val StepInsertAt: LockSite       = LockSite("step.insertAt")
  val StepSplice: LockSite         = LockSite("step.splice")
  val StepAttach: LockSite         = LockSite("step.attach")
  val StepReorder: LockSite        = LockSite("step.reorder")
  val StepReorderTrunk: LockSite   = LockSite("step.reorderTrunk")
  val StepDelete: LockSite         = LockSite("step.delete")
  val StepDeletePanelsFirst: LockSite = LockSite("step.delete.order.panelsFirst") // inactive: (3) then (1) (deadlocks with the save)
  val RootRemovePanelsFirst: LockSite = LockSite("root.remove.order.panelsFirst") // inactive: (3) then (1) (deadlocks with the save)
  val OutputCreate: LockSite       = LockSite("output.create")
  val OutputDelete: LockSite       = LockSite("output.delete")
  val RootAdd: LockSite            = LockSite("root.add")
  val RootAddSourceShare: LockSite = LockSite("root.add.sourceShare") // (0) key-share on the source row, before (2)/(3)
  val RootRemove: LockSite         = LockSite("root.remove")
  val ScheduleUpsert: LockSite     = LockSite("schedule.upsert")
  val ScheduleDelete: LockSite     = LockSite("schedule.delete")
  val RewriteUpsert: LockSite      = LockSite("rewriteUpsert.pipeline")
  val RewriteAdvisoryFirst: LockSite = LockSite("rewriteUpsert.order.advisoryFirst") // inactive: step row first, then advisory
  val SourceDelete: LockSite          = LockSite("source.delete.pipelines")           // (3) over the frozen rooted set
  val SourceDeleteSourceRow: LockSite = LockSite("source.delete.sourceRow")           // (0) source row FOR UPDATE first
  val TeardownSourcesFirst: LockSite  = LockSite("teardown.sourcesFirst")             // (0) tagged source rows first
  val TeardownPipelines: LockSite     = LockSite("teardown.pipelines")                // (3) over the rooted set of the tagged sources

  /** Every site, for specs that sweep them. */
  val All: Vector[LockSite] = Vector(
    SavePanels, SaveAdvisory, SavePipeline, SaveRules, SaveOutputs, SavePanelsFirst, SaveOutputsByPosition, SaveRulesBeforeOutputs,
    StepUpdate, StepInsert, StepInsertAt, StepSplice, StepAttach, StepReorder, StepReorderTrunk, StepDelete, StepDeletePanelsFirst, RootRemovePanelsFirst, OutputCreate,
    OutputDelete, RootAdd, RootAddSourceShare, RootRemove, ScheduleUpsert, ScheduleDelete, RewriteUpsert, RewriteAdvisoryFirst,
    SourceDelete, SourceDeleteSourceRow, TeardownSourcesFirst, TeardownPipelines
  )
}

/** The verified lock order, O*: (0) `data_sources` rows, (1) panels then their dashboards, (2) the cycle advisory lock,
 *  (3) `pipelines` rows `FOR NO KEY UPDATE` by id, (4) the alert rules targeting the pipeline's Outputs by id, (5) the
 *  Outputs by `(position, id)`. A transaction takes the locks it needs in this order and never goes back; (1) is
 *  `PanelRowLocks.lockForDeletion`, once, as its first write. The evidence for every placement is in
 *  `openspec/changes/atomic-draft-save-endpoint/evidence/`.
 *
 *  Lock (3) is [[lockPipelines]]: the V137 SECURITY DEFINER function, because an application-level `FOR NO KEY UPDATE` on the
 *  app pool locks ZERO rows, silently, for an editor grantee under the owner-only `pipelines_update` policy. */
trait PipelineDefinitionLocks {

  /** False only in a spec that removes a site to prove the spec watching it can fail. */
  def active(site: LockSite): Boolean

  /** (3): locks `pipelineIds` `FOR NO KEY UPDATE` in id order. `true` when every distinct id still exists; `false` means a racer
   *  deleted one, and the caller must take its not-found path (a single-pipeline writer, the save: 404) and never proceed as
   *  if it held the lock. An inactive site locks nothing and reports success, so the writer behaves exactly as it did before
   *  the lock existed. */
  def lockPipelines(site: LockSite, pipelineIds: Seq[String])(implicit ec: ExecutionContext): DBIO[Boolean] = {
    val ids = pipelineIds.distinct.sorted
    if (ids.isEmpty || !active(site)) DBIO.successful(true)
    else PipelineDefinitionLocks.lockPipelinesSql(ids, Nil).map(_ == ids.size)
  }

  /** (3) for a writer that deletes data sources (a source delete, a teardown): locks `pipelineIds` AND every pipeline with a
   *  root on one of `sourceIds` (the pipelines the deletion cascades into), in id order, in ONE privileged statement, and
   *  returns how many it locked. The caller must already hold each source row `FOR UPDATE` (lock (0)): that is what freezes
   *  the rooted set, because a root add's FK key-share on the source conflicts. The rooted set is read inside the function
   *  because the source's owner cannot see, under RLS, a pipeline another user owns. A pipeline a racer deleted is simply
   *  absent from the result; the writer carries on. */
  def lockPipelinesRootedOn(site: LockSite, pipelineIds: Seq[String], sourceIds: Seq[String])(implicit ec: ExecutionContext): DBIO[Int] =
    if (!active(site) || (pipelineIds.isEmpty && sourceIds.isEmpty)) DBIO.successful(0)
    else PipelineDefinitionLocks.lockPipelinesSql(pipelineIds.distinct.sorted, sourceIds.distinct.sorted)

  /** `action` when `site` is active, else `otherwise`. */
  def choose[A](site: LockSite, action: => DBIO[A], otherwise: => DBIO[A]): DBIO[A] =
    if (active(site)) action else otherwise
}

object PipelineDefinitionLocks {

  /** Production: every site active. */
  object Enforced extends PipelineDefinitionLocks {
    def active(site: LockSite): Boolean = true
  }

  private[persistence] def lockPipelinesSql(sortedPipelineIds: Seq[String], sortedSourceIds: Seq[String])(implicit ec: ExecutionContext): DBIO[Int] =
    sql"SELECT hel1629_lock_pipelines($sortedPipelineIds, $sortedSourceIds)".as[Int].head
}
