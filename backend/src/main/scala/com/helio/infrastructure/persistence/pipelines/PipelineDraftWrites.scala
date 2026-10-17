package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{DataSourceId, PipelineId}
import com.helio.domain.steps.{UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.panels.PanelRowLocks
import com.helio.infrastructure.persistence.pipelines.OutputRepository.{OutputRow, OutputTable}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineTable
import com.helio.infrastructure.persistence.pipelines.PipelineRootRepository.PipelineRootTable
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository.{PipelineStepRow, PipelineStepTable}
import slick.jdbc.PostgresProfile.api._
// After the wildcard on purpose: an explicit import only shadows the profile's own `instantColumnType` when it is inner.
import PipelineRepository.instantColumnType
import OutputRepository.{jsObjectColumnType, schemaFieldsColumnType}
import spray.json.JsObject

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.util.Try

/** One step of the FINAL tree a draft save writes: the stored `config` text is already normalised (decode, then encode). */
final case class StepWrite(
    id: String,
    op: String,
    config: String,
    enabled: Boolean,
    parentStepId: Option[String],
    rootId: Option[String],
    position: Int
)

/** One Output of the final tree. `config` replaces the stored config outright (the body is declarative). */
final case class OutputWrite(
    id: String,
    name: String,
    kind: String,
    nodeStepId: Option[String],
    rootId: Option[String],
    config: JsObject
)

/** The raw rows a draft save plans against, read in the transaction. `rootIds` are in `position` order. */
final case class DefinitionRows(
    pipelineName: String,
    ownerId: UUID,
    rootIds: Vector[String],
    steps: Vector[PipelineStepRow],
    outputs: Vector[OutputRow]
)

/** The `DBIO` primitives of the atomic draft save (HEL-1629): the lock protocol (task 3.3) and the apply chain's row writes
 *  (task 3.5). Nothing here opens a transaction; the service composes everything into ONE privileged transaction, which is
 *  what makes a fault mid-chain leave the definition untouched.
 *
 *  The verified lock order is documented on [[PipelineDefinitionLocks]]; [[lockDefinition]] is its only implementation for
 *  the save. */
final class PipelineDraftWrites(
    locks: PipelineDefinitionLocks,
    rootRepo: PipelineRootRepository,
    stepRepo: PipelineStepRepository,
    outputRepo: OutputRepository
)(implicit ec: ExecutionContext) {

  private val pipelines = TableQuery[PipelineTable]
  private val roots     = TableQuery[PipelineRootTable]
  private val steps     = TableQuery[PipelineStepTable]
  private val outputs   = TableQuery[OutputTable]

  /** The pipeline's definition rows, or `None` when it does not exist. Plain reads: callers that need them stable lock first. */
  def readRows(pipelineId: String): DBIO[Option[DefinitionRows]] =
    pipelines.filter(_.id === pipelineId).map(p => (p.name, p.ownerId)).result.headOption.flatMap {
      case None => DBIO.successful(None)
      case Some((name, owner)) =>
        for {
          rootIds <- roots.filter(_.pipelineId === pipelineId).sortBy(_.position).map(_.id).result
          stepRows <- steps.filter(_.pipelineId === pipelineId).result
          outputRows <- outputs.filter(_.pipelineId === pipelineId).sortBy(o => (o.position, o.id)).result
        } yield Some(DefinitionRows(name, owner, rootIds.toVector, stepRows.toVector, outputRows.toVector))
    }

  /** Takes the save's locks in the verified order O* and returns `false` when the pipeline no longer exists (the caller
   *  answers 404). (1) panels then dashboards, once, first; (2) the cycle advisory lock, only when the plan adds or changes
   *  an `upsertsource` write edge; (3) the pipeline row; (4) the alert rules targeting its Outputs; (5) its Outputs by
   *  `(position, id)`. Each can be switched off in a spec ([[LockSite]]), and two of the orderings can be reverted to the
   *  order the probes proved deadlocks, so the race and deadlock specs can be shown to fail. */
  def lockDefinition(pipelineId: String, takeAdvisory: Boolean, afterLock: LockSite => DBIO[Unit] = _ => DBIO.successful(())): DBIO[Boolean] = {
    val unit: DBIO[Unit] = DBIO.successful(())
    def taken(site: LockSite, lock: DBIO[Unit]): DBIO[Unit] = locks.choose(site, lock, unit).andThen(afterLock(site))
    val panels   = taken(LockSite.SavePanels, PanelRowLocks.lockForDeletion(pipelines = Seq(pipelineId)))
    val advisory = if (takeAdvisory) taken(LockSite.SaveAdvisory, PipelineCycleGuard.lockAction) else unit
    val rules    = taken(LockSite.SaveRules, lockRules(pipelineId))
    val outs     = taken(LockSite.SaveOutputs, lockOutputs(pipelineId, byPosition = locks.active(LockSite.SaveOutputsByPosition)))
    val bodyAfterPipeline: DBIO[Unit] =
      if (locks.active(LockSite.SaveRulesBeforeOutputs)) rules.andThen(outs) else outs.andThen(rules)

    if (locks.active(LockSite.SavePanelsFirst))
      for {
        _  <- panels
        _  <- advisory
        ok <- locks.lockPipelines(LockSite.SavePipeline, Seq(pipelineId))
        _  <- afterLock(LockSite.SavePipeline)
        _  <- if (ok) bodyAfterPipeline else unit
      } yield ok
    else
      // The section-8.3 "earlier order" (pipeline, rules, Outputs, THEN panels): reachable only from a spec that has
      // switched LockSite.SavePanelsFirst off, to show the deadlock it causes against a concurrent panel create.
      for {
        _  <- advisory
        ok <- locks.lockPipelines(LockSite.SavePipeline, Seq(pipelineId))
        _  <- afterLock(LockSite.SavePipeline)
        _  <- if (ok) bodyAfterPipeline.andThen(panels) else unit
      } yield ok
  }

  private def lockRules(pipelineId: String): DBIO[Unit] =
    sql"""SELECT r.id FROM alert_rules r
          WHERE r.target_output_id IN (SELECT o.id FROM outputs o WHERE o.pipeline_id = $pipelineId)
          ORDER BY r.id FOR UPDATE OF r""".as[String].map(_ => ())

  /** By `(position, id)`: the node-snapshot transaction key-shares a node's Outputs in `position` order, and a lock taken in
   *  another order cycles with it (evidence: probe 1.3 (d)). */
  private def lockOutputs(pipelineId: String, byPosition: Boolean): DBIO[Unit] =
    (if (byPosition)
       sql"SELECT id FROM outputs WHERE pipeline_id = $pipelineId ORDER BY position, id FOR UPDATE"
     else
       sql"SELECT id FROM outputs WHERE pipeline_id = $pipelineId ORDER BY id FOR UPDATE").as[String].map(_ => ())

  // ── Apply chain (D2: creates, relinks, deletes, content, Outputs) ──────────────────────────────────────────────────

  /** (a) Inserts `rows` in the order given (the planner emits parents before children) with their FINAL parent, root and
   *  position, so V98's `(parent_step_id IS NULL) = (root_id IS NOT NULL)` CHECK holds on every row. An `upsertsource` row
   *  targeting an existing source is cycle-checked first, exactly as every other step insert path does. */
  def insertSteps(pipelineId: String, pipelineName: String, actingUserId: String, rows: Vector[StepWrite]): DBIO[Unit] = {
    val now = Instant.now()
    rows.foldLeft(DBIO.successful(()): DBIO[Unit]) { (acc, w) =>
      acc.andThen(upsertCycleCheck(pipelineId, pipelineName, actingUserId, w.op, w.config, None)).andThen(
        (steps += PipelineStepRow(w.id, pipelineId, w.position, w.op, w.config, w.enabled, now, now, w.parentStepId, w.rootId)).map(_ => ())
      )
    }
  }

  /** (b) Re-links every surviving step whose parent, root or position changed. One UPDATE per row sets parent and root
   *  together, so the CHECK is never violated between two statements. */
  def relinkSteps(rows: Vector[StepWrite]): DBIO[Unit] = {
    val now = Instant.now()
    DBIO.seq(rows.map { w =>
      steps.filter(_.id === w.id).map(s => (s.parentStepId, s.rootId, s.position, s.updatedAt)).update((w.parentStepId, w.rootId, w.position, now))
    }: _*)
  }

  /** (d) Writes the `config` and `enabled` of surviving steps whose content changed. `oldConfigs` is each row's stored config
   *  text, so the cycle check can exclude the edge being replaced. */
  def updateStepContent(pipelineId: String, pipelineName: String, actingUserId: String, rows: Vector[StepWrite], oldConfigs: Map[String, String]): DBIO[Unit] = {
    val now = Instant.now()
    rows.foldLeft(DBIO.successful(()): DBIO[Unit]) { (acc, w) =>
      acc.andThen(upsertCycleCheck(pipelineId, pipelineName, actingUserId, w.op, w.config, oldConfigs.get(w.id))).andThen(
        steps.filter(_.id === w.id).map(s => (s.config, s.enabled, s.updatedAt)).update((w.config, w.enabled, now)).map(_ => ())
      )
    }
  }

  /** The `upsertsource` write-edge check (`PipelineCycleGuard`), run only for a config whose target is an existing source,
   *  mirroring `PipelineStepRepository.cycleCheckForUpsertAction`. The advisory lock it takes was already taken by the save
   *  (re-entrant), or the save's plan had no such edge and the planner asked for none. */
  private def upsertCycleCheck(
      pipelineId: String,
      pipelineName: String,
      actingUserId: String,
      op: String,
      configJson: String,
      oldConfigJson: Option[String]
  ): DBIO[Unit] =
    if (op != "upsertsource") DBIO.successful(())
    else
      Try(UpsertSourceConfig.decode(configJson)).toOption match {
        case Some(UpsertSourceConfig(UpsertTarget.ExistingSource(dsId), _)) if dsId.trim.nonEmpty =>
          val oldTarget = oldConfigJson.flatMap(raw =>
            Try(UpsertSourceConfig.decode(raw)).toOption.collect {
              case UpsertSourceConfig(UpsertTarget.ExistingSource(old), _) if old.trim.nonEmpty => DataSourceId(old)
            }
          )
          PipelineCycleGuard.checkAddWriteAction(
            rootRepo, stepRepo, actingUserId, PipelineId(pipelineId), pipelineName, DataSourceId(dsId), excludeExistingWriteTarget = oldTarget
          )
        case _ => DBIO.successful(())
      }

  /** (c) Deletes the removed Outputs and their bound panels, then the removed steps in ONE statement (the `parent_step_id`
   *  FK is NO ACTION, checked at statement end, and survivors have already been re-linked off the removed set). */
  def deleteRemoved(outputIds: Vector[String], stepIds: Set[String]): DBIO[Vector[String]] =
    for {
      removedPanels <- outputRepo.deleteOutputsCoreAction(outputIds)
      _             <- stepRepo.deleteStepsCoreAction(stepIds)
    } yield removedPanels

  /** (e) Creates Outputs, owned by the PIPELINE OWNER, appended after the existing ones in draft order. */
  def insertOutputs(pipelineId: String, ownerId: UUID, startPosition: Int, writes: Vector[OutputWrite]): DBIO[Unit] = {
    val now = Instant.now()
    DBIO.seq(writes.zipWithIndex.map { case (w, i) =>
      outputs += OutputRow(
        w.id, pipelineId, w.nodeStepId, ownerId, w.name, w.kind, w.config, Vector.empty, startPosition + i, None, now, now, w.rootId
      )
    }: _*)
  }

  /** (e) Replaces the `name` and `config` of surviving Outputs; the node, root, kind and `schema` are not draft-editable. */
  def updateOutputs(writes: Vector[OutputWrite]): DBIO[Unit] = {
    val now = Instant.now()
    DBIO.seq(writes.map { w =>
      outputs.filter(_.id === w.id).map(o => (o.name, o.config, o.updatedAt)).update((w.name, w.config, now))
    }: _*)
  }

  /** Fresh id for a created row. */
  def newId(): String = UUID.randomUUID().toString
}
