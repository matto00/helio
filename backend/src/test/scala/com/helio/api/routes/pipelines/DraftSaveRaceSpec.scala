package com.helio.api.routes.pipelines

import com.helio.api.protocols.dashboards.{DashboardAppearancePayload, DashboardLayoutPayload, DashboardSnapshotDashboardEntry, DashboardSnapshotPanelEntry, DashboardSnapshotPayload}
import com.helio.api.protocols.panels.{PanelAppearancePayload, PanelBatchItem}
import com.helio.domain.model._
import com.helio.domain.panels.{OutputPanel, OutputPanelConfig}
import com.helio.domain.steps.{LimitConfig, UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.pipelines.LockSite
import com.helio.services.panels.PlacementSizes
import com.helio.testsupport.{DraftRaceFixture, DraftSaveHarness, DraftSaveSeed, RaceOrder, RaceOutcome, RaceWriter, SaveFirst, WriterFirst}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.util.Try

/** HEL-1629 task 6.3: one two-connection race per writer of fingerprinted state against the draft save, both orders
 *  choreographed (see [[DraftRaceFixture]]), each asserted by Postgres's own lock-wait view. For every writer:
 *   - protected: no violation, no `40P01`, and one transaction was observed waiting on the other;
 *   - control: with the writer's protecting lock sites (an instrumented writer's own lock, or the save's lock that excludes
 *     it) switched off, the SAME race is a violation. That red is the recorded mutation that proves the spec can fail.
 *
 *  Fixtures keep each exclusion attributable to the lock named in `protectedBy`: a panel writer works on a FRESH dashboard
 *  (so the save's lock (1) on the seed's dashboards does not mask lock (4)), and a writer that cascades (a root removal, a
 *  source delete) deletes a root that carries no Output (so the save's lock (4) on that Output does not mask lock (3)). */
class DraftSaveRaceSpec extends DraftRaceFixture {

  private val owner = AuthenticatedUser(UserId(userA))
  private def now = Instant.now()
  private def pid(seed: DraftSaveSeed) = PipelineId(seed.pipeline)
  private def step(id: String) = PipelineStepId(id)
  private val Cond = JsObject("comparator" -> JsString(">"), "threshold" -> JsNumber(1))

  private def dashboard(seed: DraftSaveSeed, local: String): String = {
    exec(s"INSERT INTO dashboards (id,name,created_by,created_at,last_updated,appearance,layout,owner_id) VALUES ('${seed.id(local)}','$local','u',now(),now(),'${DraftSaveSeed.DashboardAppearance}','{\"lg\":[],\"md\":[],\"sm\":[],\"xs\":[]}','$userA')")
    seed.id(local)
  }

  private def panelRow(seed: DraftSaveSeed, dashboardId: String, local: String, outputId: String): String = {
    exec(s"INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES ('${seed.id(local)}','$dashboardId','$local','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$userA','output','$outputId')")
    seed.id(local)
  }

  private def outputPanel(seed: DraftSaveSeed, dashboardId: String, panelId: String, outputId: String): OutputPanel =
    OutputPanel(PanelId(panelId), DashboardId(dashboardId), "raced", ResourceMeta(userA, now, now), PanelAppearance.Default, UserId(userA), OutputPanelConfig(OutputId(outputId)))

  private def newPanel(seed: DraftSaveSeed, dashboardId: String, outputId: String): OutputPanel =
    outputPanel(seed, dashboardId, UUID.randomUUID().toString, outputId)

  private def alertRule(seed: DraftSaveSeed, id: String, name: String): AlertRule =
    AlertRule(AlertRuleId(id), UserId(userA), "m", Cond, name, true, Severity.Warning, now, now, OutputId(seed.oc))

  private def seedRule(seed: DraftSaveSeed, local: String): String = {
    exec(s"INSERT INTO alert_rules (id,owner_id,metric,condition,name,enabled,severity,created_at,updated_at,target_output_id) VALUES ('${seed.id(local)}','$userA','m','{}','$local',true,'warning',now(),now(),'${seed.oc}')")
    seed.id(local)
  }

  private val NoPanels = DashboardLayout(Vector.empty, Vector.empty, Vector.empty, Vector.empty)

  /** Panels, dashboards, alert rules and pipeline/Output rows: excluded by the SAVE's own locks. */
  private val savesOwnLocks: Vector[RaceWriter] = Vector(
    RaceWriter("panel create (PanelRepository.insertPlaced)", Set(LockSite.SaveOutputs),
      (h, s) => h.panelRepo.insertPlaced(newPanel(s, s.id("dx"), s.oc), PlacementSizes.ContentDefault),
      s => dashboard(s, "dx")),
    RaceWriter("panel duplicate (PanelRepository.duplicate)", Set(LockSite.SavePanels, LockSite.SaveOutputs),
      (h, s) => h.panelRepo.duplicate(PanelId(s.id("px")), UserId(userA), PlacementSizes.ContentDefault),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oc) }),
    RaceWriter("panel output swap, batch (PanelRepository.batchUpdate)", Set(LockSite.SavePanels, LockSite.SaveOutputs),
      (h, s) => h.panelRepo.batchUpdate(Vector(PanelBatchItem(s.id("px"), None, None, None, Some(JsObject("outputId" -> JsString(s.oc))))), now),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oa) }),
    RaceWriter("panel batch create (PanelRepository.insertBatchPlaced)", Set(LockSite.SaveOutputs),
      (h, s) => h.panelRepo.insertBatchPlaced(Vector(newPanel(s, s.id("dx"), s.oc) -> PlacementSizes.ContentDefault)),
      s => dashboard(s, "dx")),
    RaceWriter("panel output swap, single (PanelRepository.replace)", Set(LockSite.SavePanels, LockSite.SaveOutputs),
      (h, s) => h.panelRepo.replace(outputPanel(s, s.id("dx"), s.id("px"), s.oc), now),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oa) }),
    RaceWriter("panel delete (PanelRepository.delete)", Set(LockSite.SavePanels),
      (h, s) => h.panelRepo.delete(PanelId(s.id("px"))),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oa) }),
    RaceWriter("dashboard duplicate (DashboardRepository.duplicate)", Set(LockSite.SaveOutputs),
      (h, s) => h.dashboardRepo.duplicate(DashboardId(s.id("dx")), UserId(userA)),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oc) }),
    RaceWriter("dashboard import (DashboardRepository.importSnapshot)", Set(LockSite.SaveOutputs),
      (h, s) => h.dashboardRepo.importSnapshot(
        DashboardSnapshotPayload(
          1,
          DashboardSnapshotDashboardEntry("imported", DashboardAppearancePayload(None, None), DashboardLayoutPayload(Vector.empty, Vector.empty, Vector.empty, Vector.empty)),
          Vector(DashboardSnapshotPanelEntry("snap-1", None, "imported", "output", PanelAppearancePayload(None, None, None, None), JsObject("outputId" -> JsString(s.oc))))
        ),
        UserId(userA)
      )),
    RaceWriter("dashboard contents replace (DashboardRepository.replaceContents)", Set(LockSite.SavePanels, LockSite.SaveOutputs),
      (h, s) => h.dashboardRepo.replaceContents(DashboardId(s.id("dx")), Vector(newPanel(s, s.id("dx"), s.oc)), NoPanels),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oc) }),
    RaceWriter("dashboard delete (DashboardRepository.delete)", Set(LockSite.SavePanels),
      (h, s) => h.dashboardRepo.delete(DashboardId(s.id("dx"))),
      s => { dashboard(s, "dx"); panelRow(s, s.id("dx"), "px", s.oa) }),
    RaceWriter("alert rule insert (AlertRuleRepository.insert)", Set(LockSite.SaveOutputs),
      (h, s) => h.alertRuleRepo.insert(alertRule(s, UUID.randomUUID().toString, "raced"), owner)),
    RaceWriter("alert rule update (AlertRuleRepository.update)", Set(LockSite.SaveRules),
      (h, s) => h.alertRuleRepo.update(alertRule(s, s.id("rx"), "renamed"), owner),
      s => seedRule(s, "rx")),
    RaceWriter("alert rule delete (AlertRuleRepository.delete)", Set(LockSite.SaveRules),
      (h, s) => h.alertRuleRepo.delete(AlertRuleId(s.id("rx")), owner),
      s => seedRule(s, "rx")),
    RaceWriter("Output update (OutputRepository.updateOwned)", Set(LockSite.SaveOutputs),
      (h, s) => h.outputRepo.updateOwned(OutputId(s.oc), owner, Some("renamed"), None)),
    RaceWriter("pipeline rename (PipelineRepository.updateName)", Set(LockSite.SavePipeline),
      (h, s) => h.pipelineRepo.updateName(pid(s), "renamed", owner)),
    RaceWriter("pipeline delete (PipelineRepository.delete)", Set(LockSite.SavePanels, LockSite.SavePipeline, LockSite.SaveRules, LockSite.SaveOutputs),
      (h, s) => h.pipelineRepo.delete(pid(s), owner), hasViolationControl = false)
  )

  /** Writers of steps, Outputs, roots and the schedule: nothing the save locks conflicts with them, so each takes lock (3). */
  private val gainLockThree: Vector[RaceWriter] = Vector(
    RaceWriter("step PATCH (PipelineStepRepository.updateInternal)", Set(LockSite.StepUpdate),
      (h, s) => h.stepRepo.updateInternal(step(s.t3), Some(LimitConfig(33)), None, None, userA)),
    RaceWriter("step insert (PipelineStepRepository.insertInternal)", Set(LockSite.StepInsert),
      (h, s) => h.stepRepo.insertInternal(pid(s), "limit", LimitConfig(5), true, Some(step(s.t4)), None, userA)),
    RaceWriter("step insert at index (PipelineStepRepository.insertAtInternal)", Set(LockSite.StepInsertAt),
      (h, s) => h.stepRepo.insertAtInternal(pid(s), "limit", LimitConfig(5), 0, true, Some(step(s.t4)))),
    RaceWriter("step splice (PipelineStepRepository.spliceInsertAtInternal)", Set(LockSite.StepSplice),
      (h, s) => h.stepRepo.spliceInsertAtInternal(pid(s), "limit", LimitConfig(5), Some(step(s.t4)), true, None, userA)),
    RaceWriter("step attach as tail (PipelineStepRepository.attachTailInternal)", Set(LockSite.StepAttach),
      (h, s) => h.stepRepo.attachTailInternal(pid(s), "limit", LimitConfig(5), step(s.t4), true, userA)),
    RaceWriter("step reorder (PipelineStepRepository.reorderInternal)", Set(LockSite.StepReorder),
      (h, s) => h.stepRepo.reorderInternal(pid(s), Seq(step(s.t3), step(s.t2)))),
    RaceWriter("trunk reorder (PipelineStepRepository.reorderTrunkInternal)", Set(LockSite.StepReorderTrunk),
      (h, s) => h.stepRepo.reorderTrunkInternal(pid(s), Seq(step(s.t4), step(s.t2), step(s.t1)))),
    RaceWriter("step delete (PipelineStepRepository.deleteInternal)", Set(LockSite.StepDelete),
      (h, s) => h.stepRepo.deleteInternal(step(s.t4))),
    // Excluded by the writer's own (3) AND the save's lock (5) on the Output row it deletes; both sites are the protection, so the
    // control removes both. (The writer's (3) after (1) is there for G2, see DraftSaveDeadlockSpec "Output delete".)
    RaceWriter("Output delete (OutputRepository.deleteWithPanelsInternal)", Set(LockSite.OutputDelete, LockSite.SaveOutputs),
      (h, s) => h.outputRepo.deleteWithPanelsInternal(OutputId(s.oc))),
    RaceWriter("Output create (OutputRepository.insertInternal)", Set(LockSite.OutputCreate),
      (h, s) => h.outputRepo.insertInternal(pid(s), Some(step(s.t3)), UserId(userA), "raced", OutputKind.Table, JsObject.empty, Vector.empty, None, None)),
    RaceWriter("root add (PipelineRootRepository.add)", Set(LockSite.RootAdd),
      (h, s) => h.rootRepo.add(pid(s), DataSourceId(s.id("ds3")), owner),
      s => exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${s.id("ds3")}','ds3','dataset','{}',now(),now(),'$userA','[]')")),
    // HEL-1652: an EDITOR grantee adds a root with a source the editor owns; since the write is privileged it takes the same locks
    // in the same order as the owner's add, so the same exclusion holds.
    RaceWriter("root add by an editor grantee (PipelineRootRepository.add)", Set(LockSite.RootAdd),
      (h, s) => h.rootRepo.add(pid(s), DataSourceId(s.id("dsB")), AuthenticatedUser(UserId(userB))),
      s => {
        exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${s.id("dsB")}','dsB','dataset','{}',now(),now(),'$userB','[]')")
        exec(s.grant(userB, "editor"))
      }),
    RaceWriter("root remove (PipelineRootRepository.removeRoot: cascade, removeAction, compactPositions; privileged, as owner and editor run it)", Set(LockSite.RootRemove),
      (h, s) => h.rootRepo.removeRoot(h.stepRepo, pid(s), PipelineRootId(s.r2)),
      s => exec(s"DELETE FROM outputs WHERE id='${s.od}'")),
    RaceWriter("schedule upsert (PipelineScheduleRepository.upsert)", Set(LockSite.ScheduleUpsert),
      (h, s) => h.scheduleRepo.upsert(PipelineSchedule(PipelineScheduleId(s.id("sch")), pid(s), ScheduleKind.Cron, "5 * * * *", true, "UTC", None, None, now, now), owner)),
    RaceWriter("schedule delete (PipelineScheduleRepository.delete)", Set(LockSite.ScheduleDelete),
      (h, s) => h.scheduleRepo.delete(pid(s), owner)),
    RaceWriter("upsert target rewrite (StepRepository.rewriteUpsertTargetAction via applyWriteBacks)", Set(LockSite.RewriteUpsert),
      (h, s) => h.dataSourceRepo.applyWriteBacks(
        owner,
        Vector(PendingWrite(s.id("ut"), UpsertSourceConfig(UpsertTarget.NewSource("rewritten"), UpsertMode.Append), Seq(Map[String, Any]("a" -> 1)))),
        h.stepRepo, 100
      ),
      s => exec(s"INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES ('${s.id("ut")}','${s.pipeline}',0,'upsertsource','{\"target\":{\"kind\":\"newSource\",\"name\":\"rewritten\"},\"mode\":\"append\"}',now(),now(),true,'${s.t4}',NULL)")),
    RaceWriter("source delete (DataSourceRepository.delete)", Set(LockSite.SourceDelete),
      (h, s) => h.dataSourceRepo.delete(DataSourceId(s.ds2), owner),
      s => exec(s"DELETE FROM outputs WHERE id='${s.od}'"),
      didWrite = _.toOption.contains(true)),
    // C5: the source's owner (C) cannot see the pipeline (A's) under RLS, so a plain application-level FOR NO KEY UPDATE would
    // lock ZERO rows and the race would be a silent violation. The V137 function locks it all the same.
    RaceWriter("source delete by a source owner who cannot see the pipeline (RLS)", Set(LockSite.SourceDelete),
      (h, s) => h.dataSourceRepo.delete(DataSourceId(s.id("dsC")), AuthenticatedUser(UserId(userC))),
      s => {
        exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${s.id("dsC")}','dsC','dataset','{}',now(),now(),'$userC','[]')")
        exec(s"INSERT INTO pipeline_roots (id,pipeline_id,data_source_id,position,created_at) VALUES ('${s.id("rC")}','${s.pipeline}','${s.id("dsC")}',2,now())")
      },
      didWrite = _.toOption.contains(true))
  )

  // F1 (final-gate skeptic): a step delete reads the deleted row's place BEFORE its lock, then promotes the head child to that
  // place after waiting behind a save that moved the step. The draft below moves t2 under t4; the serial order save-then-delete
  // puts t2's head child t5 under t4, not under t1. `serialCheck` is the oracle that catches this class.
  private def moveT2UnderT4(s: DraftSaveSeed, fp: String, d0: JsObject): JsObject = {
    val d = draftOf(fp, d0)
    withSteps(d, replacing(stepsOf(d), s.t2)(st => set(set(st, "parentStepId", JsString(s.t4)), "position", JsNumber(0))))
  }

  private val stepDeleteOfMovedStep = RaceWriter("step delete of a step the save moved (PipelineStepRepository.deleteInternal)", Set(LockSite.StepDelete),
    (h, s) => h.stepRepo.deleteInternal(step(s.t2)),
    prepare = s => exec(s"INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES ('${s.id("t5")}','${s.pipeline}',0,'limit','{\"count\":5}',now(),now(),true,'${s.t2}',NULL)"),
    hasViolationControl = false,
    draft = Some(moveT2UnderT4),
    serialCheck = Some((s, q) => q(s"SELECT coalesce(parent_step_id,'-') FROM pipeline_steps WHERE id='${s.id("t5")}'") == Vector(s.t4)))

  // The retry path: the save attaches a new tail child under the step being deleted. The delete read its removal set before
  // it waited for the panel locks the save holds, so under the pipeline lock the set has GROWN past the steps whose panels it
  // locked. It must not delete them on the old panel locks and cannot lock panels again: it rolls the attempt back (nothing
  // written) and retries in a fresh transaction. The outcome is the serial order save-then-delete: both t2 and the new tail
  // are gone and the head child t5 sits in t2's old place.
  private val stepDeleteOfGrownSubtree = RaceWriter("step delete whose removal set the save grew (PipelineStepRepository.deleteInternal retry)", Set(LockSite.StepDelete),
    (h, s) => h.stepRepo.deleteInternal(step(s.t2)),
    prepare = s => exec(s"INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES ('${s.id("t5")}','${s.pipeline}',0,'limit','{\"count\":5}',now(),now(),true,'${s.t2}',NULL)"),
    hasViolationControl = false,
    draft = Some((s, fp, d0) => { val d = draftOf(fp, d0); withSteps(d, stepsOf(d) :+ newStep("nx", Left(s.t2), position = 1)) }),
    serialCheck = Some((s, q) =>
      q(s"SELECT count(*) FROM pipeline_steps WHERE pipeline_id='${s.pipeline}'") == Vector("4") &&
        q(s"SELECT coalesce(parent_step_id,'-') FROM pipeline_steps WHERE id='${s.id("t5")}'") == Vector(s.t1)))

  private val writers: Vector[RaceWriter] = savesOwnLocks ++ gainLockThree :+ stepDeleteOfMovedStep :+ stepDeleteOfGrownSubtree

  private def describe(label: String, o: RaceOutcome): String = s"$label: $o"

  private def protectedRun(writer: RaceWriter, order: RaceOrder): Unit = {
    val o = race(writer, order)
    withClue(describe("protected", o)) {
      o.deadlock shouldBe false
      o.violation shouldBe false
      o.blockedObserved shouldBe true
    }
  }

  private def controlRun(writer: RaceWriter, order: RaceOrder): Unit = {
    val o = race(writer, order, removed = writer.protectedBy)
    withClue(describe(s"control without ${writer.protectedBy.mkString(",")}", o)) {
      o.deadlock shouldBe false
      o.violation shouldBe true
    }
  }

  writers.foreach { w =>
    s"${w.name}" should {
      "writer-first: be excluded from the save's window" in protectedRun(w, WriterFirst)
      "save-first: be excluded from the save's window" in protectedRun(w, SaveFirst)
      if (w.hasViolationControl) {
        s"writer-first control: be a violation without ${w.protectedBy.mkString(",")}" in controlRun(w, WriterFirst)
        s"save-first control: be a violation without ${w.protectedBy.mkString(",")}" in controlRun(w, SaveFirst)
      }
    }
  }

  // D5 / V137's count: a writer whose pipeline a racer deleted BEFORE it took lock (3) gets a false/short count. The writers
  // do not branch on it; their write runs against a pipeline that no longer exists and takes its own existing not-found path
  // (an FK violation, a zero-row write, a not-found result). What matters, and what is pinned here, is that none of them ever
  // proceeds into a SUCCESSFUL write of definition state for the vanished pipeline.
  "every single-pipeline writer, run after a racer deleted the pipeline," should {
    gainLockThree.filterNot(w => Set("root add", "root remove", "upsert target rewrite", "source delete").exists(w.name.startsWith)).foreach { w =>
      s"write nothing: ${w.name}" in {
        val seed = seedPipeline()
        w.prepare(seed)
        exec(s"DELETE FROM pipelines WHERE id='${seed.pipeline}'")
        val h = new DraftSaveHarness(ctx)
        Try(await(w.run(h, seed)))
        List("pipeline_steps", "outputs", "pipeline_roots", "pipeline_schedules").foreach { t =>
          withClue(t)(queryStrings(s"SELECT count(*) FROM $t WHERE pipeline_id='${seed.pipeline}'") shouldBe Vector("0"))
        }
      }
    }
  }

}
