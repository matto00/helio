package com.helio.api.routes.pipelines

import com.helio.domain.engine.PipelineAnalyzeService
import com.helio.domain.model._
import com.helio.domain.panels.{OutputPanel, OutputPanelConfig}
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.pipelines.{LockSite, OutputHistoryInsert}
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository.TeardownOutcome
import com.helio.services.panels.PlacementSizes
import com.helio.testsupport.{DraftRaceFixture, DraftSaveSeed, RaceOutcome, RaceWriter, SaveFirst, WriterFirst}
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1629 task 6.4: no `40P01` between the draft save and every participant that shares a lock with it, and a RED control
 *  for each ordering decision the probes forced. Each pair is choreographed to the interleaving that forms the cycle when the
 *  decision is reverted: the save is parked between two of its locks (`parkAfter`) or a participant is held at its first
 *  write, the other side starts, and then everything resumes. The protected run must finish without a deadlock; the control,
 *  with ONE amendment removed through the `LockSite` seam, must deadlock. */
class DraftSaveDeadlockSpec extends DraftRaceFixture {

  private val owner = AuthenticatedUser(UserId(userA))
  private def now = Instant.now()
  private def pid(s: DraftSaveSeed) = PipelineId(s.pipeline)

  private def seedRule(s: DraftSaveSeed, local: String, outputId: String): Unit =
    exec(s"INSERT INTO alert_rules (id,owner_id,metric,condition,name,enabled,severity,created_at,updated_at,target_output_id) VALUES ('${s.id(local)}','$userA','m','{}','$local',true,'warning',now(),now(),'$outputId')")

  private def check(label: String, o: RaceOutcome, expectDeadlock: Boolean): Unit =
    withClue(s"$label: $o") {
      o.deadlock shouldBe expectDeadlock
      // A protected run is only evidence if Postgres showed one transaction waiting on the other.
      if (!expectDeadlock) o.blockedObserved shouldBe true
    }

  // ── 1. panel create vs the save's lock order (the section-8.3 "earlier order") ────────────────────────────────────────
  private val panelCreate = RaceWriter("panel create on a dashboard that already has a panel bound to the Output", Set.empty,
    (h, s) => h.panelRepo.insertPlaced(
      OutputPanel(PanelId(UUID.randomUUID().toString), DashboardId(s.d1), "raced", ResourceMeta(userA, now, now), PanelAppearance.Default, UserId(userA), OutputPanelConfig(OutputId(s.oa))),
      PlacementSizes.ContentDefault
    ))

  "a panel create against the save" should {
    "not deadlock: the save locks panels and dashboards first, as a create does (dashboard before Output)" in {
      check("protected", race(panelCreate, SaveFirst, parkAfter = Some(LockSite.SavePanels)), expectDeadlock = false)
    }
    "deadlock when the save takes the pipeline row and the Outputs before the panels (the section-8.3 earlier order)" in {
      check("control", race(panelCreate, SaveFirst, removed = Set(LockSite.SavePanelsFirst), parkAfter = Some(LockSite.SaveOutputs)), expectDeadlock = true)
    }
  }

  // ── 2. Output delete (amendment A5) ───────────────────────────────────────────────────────────────────────────────────
  private val outputDelete = RaceWriter("Output delete of an Output with an alert rule and no panel", Set.empty,
    (h, s) => h.outputRepo.deleteWithPanelsInternal(OutputId(s.oc)), s => seedRule(s, "rx", s.oc))

  "an Output delete against the save" should {
    "not deadlock: the delete takes the pipeline row first, as the save does" in {
      check("protected", race(outputDelete, SaveFirst, parkAfter = Some(LockSite.SaveRules)), expectDeadlock = false)
    }
    "deadlock when the delete holds the Output and cascades into rules the save already holds" in {
      check("control", race(outputDelete, SaveFirst, removed = Set(LockSite.OutputDelete), parkAfter = Some(LockSite.SaveRules)), expectDeadlock = true)
    }
  }

  // ── 2b. step delete and root remove (final-gate F2): (1) panels, THEN (3) pipeline row, as the save does ──────────────
  // Both cascade into Outputs with bound panels, so they take (1). The save holds (1) on those panels and wants (3); a writer
  // that took (3) first and then waited on the panels forms the cycle. Each control switches only that order off.
  private val stepDeleteWithPanel = RaceWriter("step delete of t2 (its Output oa has a bound panel)", Set.empty,
    (h, s) => h.stepRepo.deleteInternal(PipelineStepId(s.t2)))

  "a step delete against the save" should {
    "not deadlock: the delete locks the panels before the pipeline row, as the save does" in {
      check("protected", race(stepDeleteWithPanel, SaveFirst, parkAfter = Some(LockSite.SavePanels)), expectDeadlock = false)
    }
    "deadlock when the delete takes the pipeline row before the panels" in {
      check("control", race(stepDeleteWithPanel, SaveFirst, removed = Set(LockSite.StepDeletePanelsFirst), parkAfter = Some(LockSite.SavePanels)), expectDeadlock = true)
    }
  }

  private val rootRemoveWithPanel = RaceWriter("root remove of r2 (its Output od has a bound panel)", Set.empty,
    (h, s) => h.pipelineRepo.runTransactionally(userA)(
      h.stepRepo.removeRootCascadeAction(pid(s), PipelineRootId(s.r2)) andThen h.rootRepo.removeAction(PipelineRootId(s.r2)) andThen h.rootRepo.compactPositions(pid(s))
    ),
    s => {
      exec(s"INSERT INTO dashboards (id,name,created_by,created_at,last_updated,appearance,layout,owner_id) VALUES ('${s.id("dr")}','dr','u',now(),now(),'${DraftSaveSeed.DashboardAppearance}','{\"lg\":[],\"md\":[],\"sm\":[],\"xs\":[]}','$userA')")
      exec(s"INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES ('${s.id("pr")}','${s.id("dr")}','pr','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$userA','output','${s.od}')")
    })

  "a root remove against the save" should {
    "not deadlock: the removal locks the panels before the pipeline row, as the save does" in {
      check("protected", race(rootRemoveWithPanel, SaveFirst, parkAfter = Some(LockSite.SavePanels)), expectDeadlock = false)
    }
    "deadlock when the removal takes the pipeline row before the panels" in {
      check("control", race(rootRemoveWithPanel, SaveFirst, removed = Set(LockSite.RootRemovePanelsFirst), parkAfter = Some(LockSite.SavePanels)), expectDeadlock = true)
    }
  }

  // ── 3. alert evaluator (amendment A2): key-share rule, then Output ─────────────────────────────────────────────────────
  private val alertEvent = RaceWriter("alert evaluator firing event", Set.empty,
    (h, s) => h.alertEventRepo.upsertFiringInternal(AlertRuleId(s.id("rx")), UserId(userA), OutputId(s.oc), JsNumber(1), None, Severity.Warning),
    s => seedRule(s, "rx", s.oc))

  "the alert evaluator against the save" should {
    "not deadlock: the save locks the alert rules before the Outputs, the order the evaluator's FK checks take them" in {
      check("protected", race(alertEvent, SaveFirst, parkAfter = Some(LockSite.SaveRules)), expectDeadlock = false)
    }
    "deadlock when the save locks the Outputs before the alert rules" in {
      check("control", race(alertEvent, SaveFirst, removed = Set(LockSite.SaveRulesBeforeOutputs), parkAfter = Some(LockSite.SaveOutputs)), expectDeadlock = true)
    }
  }

  // ── 4. the run's node-snapshot transaction (amendment A1), on the reversed position/id fixture ────────────────────────
  private val snapshotTxn = RaceWriter("node-snapshot transaction writing history points in position order", Set.empty,
    (h, s) => h.outputRepo.listByPipelineInternal(pid(s)).flatMap { outputs =>
      val entries = outputs.filter(_.node.stepId.exists(_.value == s.t2)).map(o =>
        OutputHistoryInsert(o.id.value, s.pipeline, Some(s.t2), None, None, "manual", now, 0, JsObject.empty)
      )
      h.nodeSnapshotRepo.overwriteRowsWith(s.pipeline, Some(s.t2), Vector.empty, None, h.outputHistoryRepo.insertAction(entries), None)
    })

  "a node-snapshot transaction against the save" should {
    "not deadlock: the save locks Outputs by (position, id), the order the snapshot inserts its history points in" in {
      check("protected", race(snapshotTxn, WriterFirst), expectDeadlock = false)
    }
    "deadlock when the save locks Outputs by id on a node whose position order is the reverse of its id order" in {
      check("control", race(snapshotTxn, WriterFirst, removed = Set(LockSite.SaveOutputsByPosition)), expectDeadlock = true)
    }
  }

  // ── 5. the upsert write-back rewrite (amendment A3) vs a save holding the cycle advisory lock ─────────────────────────
  private def upsertDraft(s: DraftSaveSeed, fingerprint: String, definition: JsObject): JsObject = {
    val d = draftOf(fingerprint, definition)
    val toExisting = JsObject("target" -> JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(s.id("ds4"))), "mode" -> JsString("append"))
    withSteps(d, replacing(stepsOf(d), s.id("ut"))(st => set(st, "config", toExisting)))
  }

  private val rewrite = RaceWriter("upsert target rewrite", Set.empty,
    (h, s) => h.dataSourceRepo.applyWriteBacks(
      owner, Vector(PendingWrite(s.id("ut"), UpsertSourceConfig(UpsertTarget.NewSource("rewritten"), UpsertMode.Append), Seq(Map[String, Any]("a" -> 1)))), h.stepRepo, 100
    ),
    s => {
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema,dataset_schema) VALUES ('${s.id("ds4")}','ds4','dataset','{}',now(),now(),'$userA','[]','[]')")
      exec(s"INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES ('${s.id("ut")}','${s.pipeline}',0,'upsertsource','{\"target\":{\"kind\":\"newSource\",\"name\":\"rewritten\"},\"mode\":\"append\"}',now(),now(),true,'${s.t4}',NULL)")
    },
    draft = Some(upsertDraft))

  "the upsert write-back rewrite against a save that changes the same step's upsert target" should {
    "not deadlock: the rewrite takes the cycle advisory lock before the step row, as the save does" in {
      check("protected", race(rewrite, SaveFirst), expectDeadlock = false)
    }
    "deadlock when the rewrite locks the step row first and the advisory lock after" in {
      check("control", race(rewrite, SaveFirst, removed = Set(LockSite.RewriteAdvisoryFirst)), expectDeadlock = true)
    }
  }

  // ── 6. workspace teardown vs a source delete on the same source (amendment A4) ────────────────────────────────────────
  private val tag = (s: DraftSaveSeed) => s.id("tag")
  private def teardownFixture(s: DraftSaveSeed): Unit = {
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema,tag) VALUES ('${s.id("ds3")}','ds3','dataset','{}',now(),now(),'$userA','[]','${tag(s)}')")
    exec(s"INSERT INTO pipelines (id,name,created_at,updated_at,owner_id,tag) VALUES ('${s.id("p2")}','p2',now(),now(),'$userA','${tag(s)}')")
    exec(s"INSERT INTO pipeline_roots (id,pipeline_id,data_source_id,position,created_at) VALUES ('${s.id("r3")}','${s.id("p2")}','${s.id("ds3")}',0,now())")
    exec(s"INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES ('${s.id("o3")}','${s.id("p2")}',NULL,'$userA','o3','table','{}','[]',0,now(),now(),'${s.id("r3")}')")
    exec(s"INSERT INTO dashboards (id,name,created_by,created_at,last_updated,appearance,layout,owner_id) VALUES ('${s.id("dq")}','dq','u',now(),now(),'${DraftSaveSeed.DashboardAppearance}','{\"lg\":[],\"md\":[],\"sm\":[],\"xs\":[]}','$userA')")
    exec(s"INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES ('${s.id("pq")}','${s.id("dq")}','pq','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$userA','output','${s.id("o3")}')")
  }

  private val teardown = RaceWriter("workspace teardown of a tag batch", Set.empty,
    (h, s) => h.teardownRepo.teardown(tag(s), dryRun = false, owner), teardownFixture)
  private val sourceDeleteOnBatch = RaceWriter("source delete of a tagged source", Set.empty,
    (h, s) => h.dataSourceRepo.delete(DataSourceId(s.id("ds3")), owner))

  "a workspace teardown against a source delete on one of its sources" should {
    "not deadlock: the teardown locks its source rows first, as a source delete does" in {
      val (first, second, deadlock, blocked, trace) = duel(teardown, sourceDeleteOnBatch)
      withClue(trace.mkString("; ") + s" first=$first second=$second") { deadlock shouldBe false; blocked shouldBe true }
    }
    "deadlock when the teardown takes the panels before the source rows (the order it had)" in {
      val (first, second, deadlock, _, trace) = duel(teardown, sourceDeleteOnBatch, removed = Set(LockSite.TeardownSourcesFirst))
      withClue(trace.mkString("; ") + s" first=$first second=$second") { deadlock shouldBe true }
    }
  }

  // ── 7. the mix: the ticket's five plus every writer that gained lock (3), concurrently, repeatedly ───────────────────
  "a concurrent mix of the save and every participant, repeated" should {
    "never raise 40P01" in {
      import com.helio.domain.steps.LimitConfig
      import com.helio.api.protocols.pipelines.DraftSaveRequest
      import com.helio.testsupport.DraftSaveHarness
      import scala.concurrent.{Await, Future}
      import scala.concurrent.duration._
      import scala.util.Try
      val rounds = 12
      (1 to rounds).foreach { round =>
        val seed = seedPipeline()
        val q = seed.id("q")
        exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${seed.id("ds3")}','ds3','dataset','{}',now(),now(),'$userA','[]')")
        exec(s"INSERT INTO pipelines (id,name,created_at,updated_at,owner_id) VALUES ('$q','q',now(),now(),'$userA')")
        exec(s"INSERT INTO pipeline_roots (id,pipeline_id,data_source_id,position,created_at) VALUES ('${seed.id("rq1")}','$q','${seed.ds1}',0,now()),('${seed.id("rq2")}','$q','${seed.ds2}',1,now())")
        exec(s"INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES ('${seed.id("oq")}','$q',NULL,'$userA','oq','table','{}','[]',0,now(),now(),'${seed.id("rq1")}')")
        exec(s"INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES ('${seed.id("pq")}','${seed.d1}','pq','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$userA','output','${seed.id("oq")}')")
        seedRule(seed, "rx", seed.oc)
        val h = new DraftSaveHarness(ctx)
        val snapshot = await(h.service.read(pid(seed), owner, includeDefinition = true)).toOption.get
        val request  = raceDraft(seed, snapshot.fingerprint.get, snapshot.definition.get.asJsObject).convertTo[DraftSaveRequest]
        val participants: Vector[(String, () => Future[Any])] = Vector(
          "save" -> (() => h.service.save(pid(seed), request, owner)),
          "second save" -> (() => h.service.save(pid(seed), request, owner)),
          "panel create" -> (() => panelCreate.run(h, seed)),
          "Output delete" -> (() => outputDelete.run(h, seed)),
          "pipeline delete" -> (() => h.pipelineRepo.delete(PipelineId(q), owner)),
          "source delete" -> (() => h.dataSourceRepo.delete(DataSourceId(seed.ds2), owner)),
          "step PATCH" -> (() => h.stepRepo.updateInternal(PipelineStepId(seed.t3), Some(LimitConfig(33)), None, None, userA)),
          "Output create" -> (() => h.outputRepo.insertInternal(pid(seed), Some(PipelineStepId(seed.t3)), UserId(userA), "mixed", OutputKind.Table, JsObject.empty, Vector.empty, None, None)),
          "root add" -> (() => h.rootRepo.add(pid(seed), DataSourceId(seed.id("ds3")), owner)),
          "node snapshot" -> (() => snapshotTxn.run(h, seed))
        )
        val started = participants.map { case (name, run) => name -> Try(run()).fold(Future.failed, identity) }
        val results = started.map { case (name, f) => name -> Try(Await.result(f, 60.seconds)) }
        results.foreach { case (name, r) =>
          withClue(s"round $round, $name: $r") { r.failed.toOption.exists(t => Option(t.getMessage).exists(_.contains("deadlock detected"))) shouldBe false }
        }
      }
    }
  }
}
