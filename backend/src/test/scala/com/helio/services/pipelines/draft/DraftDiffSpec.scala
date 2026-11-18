package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftOutputRequest, DraftRootRequest, DraftSaveRequest, DraftStepRequest}
import com.helio.infrastructure.persistence.pipelines.{DefinitionRows, RootWrite}
import com.helio.infrastructure.persistence.pipelines.OutputRepository.OutputRow
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository.PipelineStepRow
import com.helio.services.ServiceError
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID

/** HEL-1629 task 3.2: [[DraftDiff.plan]] is pure, so the whole planning contract is checked without a database: removed steps
 *  are EXACTLY the stored steps the draft omits (the server never deletes a step the draft keeps), the draft must be a valid
 *  forest, client ids resolve to fresh ids, an explicit id is accepted only when restoring, and creates are parents-first. */
class DraftDiffSpec extends AnyWordSpec with Matchers {

  private val now   = Instant.now()
  private val owner = UUID.fromString("00000000-0000-0000-0000-0000000000a1")
  private def lim(n: Int) = s"""{"count":$n}"""

  private def row(id: String, parent: Option[String], root: Option[String], position: Int, count: Int = 1, enabled: Boolean = true) =
    PipelineStepRow(id, "p", position, "limit", lim(count), enabled, now, now, parent, root)

  private def output(id: String, node: Option[String], root: Option[String], name: String = "o", position: Int = 0, config: JsObject = JsObject.empty) =
    OutputRow(id, "p", node, owner, name, "table", config, Vector.empty, position, None, now, now, root)

  // t1(root r1) -> t2 (trunk, pos 0), t3 (tail, pos 1); t4 root-level on r2. Outputs: oa on t2, oc on t3, od root-bound on r2.
  private val current = DefinitionRows(
    "p", owner, Vector("r1", "r2"),
    Vector(row("t1", None, Some("r1"), 0), row("t2", Some("t1"), None, 0, 2), row("t3", Some("t1"), None, 1, 3), row("t4", None, Some("r2"), 0, 4)),
    Vector(output("oa", Some("t2"), None, "oa"), output("oc", Some("t3"), None, "oc", 1), output("od", None, Some("r2"), "od", 2))
  )

  private def step(id: String, parent: Option[String], root: Option[String], position: Int, count: Int = 1, enabled: Boolean = true) =
    DraftStepRequest(Some(id), None, "limit", JsObject("count" -> JsNumber(count)), Some(enabled), parent, None, root, position)
  private def newStep(client: String, parent: Either[String, String], position: Int = 0, count: Int = 9) =
    DraftStepRequest(None, Some(client), "limit", JsObject("count" -> JsNumber(count)), None,
      parent.left.toOption, parent.toOption, None, position)
  private def out(id: String, node: Option[String], root: Option[String], name: String) =
    DraftOutputRequest(Some(id), None, name, "table", node, None, root, Some(JsObject.empty))

  private val unchangedSteps = Vector(
    step("t1", None, Some("r1"), 0), step("t2", Some("t1"), None, 0, 2), step("t3", Some("t1"), None, 1, 3), step("t4", None, Some("r2"), 0, 4)
  )
  private val unchangedOutputs = Vector(out("oa", Some("t2"), None, "oa"), out("oc", Some("t3"), None, "oc"), out("od", None, Some("r2"), "od"))

  private var counter = 0
  private def ids(): () => String = { counter = 0; () => { counter += 1; s"new-$counter" } }
  private def plan(steps: Vector[DraftStepRequest] = unchangedSteps, outputs: Vector[DraftOutputRequest] = unchangedOutputs, restoring: Boolean = false) =
    DraftDiff.plan(current, DraftSaveRequest("fp", steps, outputs, None, None), restoring, ids())
  private def error(r: Either[ServiceError, DraftPlan]): String = r.left.toOption.map(_.message).getOrElse(fail(s"expected an error, got ${r.toOption.get}"))

  "an unchanged draft" should {
    "plan nothing" in {
      val p = plan().toOption.get
      p.creates shouldBe empty; p.relinks shouldBe empty; p.contentUpdates shouldBe empty
      p.removedStepIds shouldBe empty; p.removedOutputIds shouldBe empty
      p.outputCreates shouldBe empty; p.outputUpdates shouldBe empty
      p.needsAdvisory shouldBe false
    }
  }

  "removal" should {
    "be EXACTLY the stored steps the draft omits, and never a step the draft keeps" in {
      // t1 is dropped; its children are kept by the draft (re-linked), so they are NOT removed with it.
      val steps = Vector(
        step("t2", None, Some("r1"), 0, 2), step("t3", Some("t2"), None, 1, 3), step("t4", None, Some("r2"), 0, 4)
      )
      val p = plan(steps).toOption.get
      p.removedStepIds shouldBe Set("t1")
      p.relinks.map(_.id).toSet shouldBe Set("t2", "t3")
      p.removedOutputIds shouldBe empty
    }

    "cascade an Output on a removed step and list an explicitly omitted Output too" in {
      val steps = unchangedSteps.filterNot(_.id.contains("t3"))
      val p = plan(steps, unchangedOutputs.filterNot(o => o.id.exists(Set("oc", "od")))).toOption.get
      p.removedStepIds shouldBe Set("t3")
      p.removedOutputIds shouldBe Vector("oc", "od")
    }

    "refuse an Output the draft keeps on a step it removes" in {
      error(plan(unchangedSteps.filterNot(_.id.contains("t3")))) should include("t3")
    }
  }

  "the forest" should {
    "reject a parent that is not in the draft, a cycle, both a parent and a root, and neither" in {
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(parentStepId = Some("ghost")) else s))) should include("ghost")
      error(plan(unchangedSteps.map(s => if (s.id.contains("t1")) s.copy(rootId = None, parentStepId = Some("t2")) else s))) should include("cycle")
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(rootId = Some("r1")) else s))) should include("exactly one")
      error(plan(unchangedSteps.map(s => if (s.id.contains("t1")) s.copy(rootId = None) else s))) should include("exactly one")
    }
    "reject a root that is not this pipeline's, a duplicate key, an unknown type and a negative position" in {
      error(plan(unchangedSteps.map(s => if (s.id.contains("t1")) s.copy(rootId = Some("nope")) else s))) should include("nope")
      error(plan(unchangedSteps :+ newStep("a", Left("t1")) :+ newStep("a", Left("t1")))) should include("Duplicate")
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(`type` = "nonsense") else s))) should include("nonsense")
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(position = -1) else s))) should include("negative")
    }
    "reject a type change on a surviving step" in {
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(`type` = "sort", config = JsObject("keys" -> JsArray.empty)) else s))) should include("cannot change type")
    }
  }

  "ids" should {
    "give each clientId step a fresh id, with its parent resolved through parentClientId" in {
      val p = plan(unchangedSteps :+ newStep("a", Left("t4")) :+ newStep("b", Right("a"), position = 0)).toOption.get
      p.creates.map(_.id) shouldBe Vector("new-1", "new-2")
      p.creates.map(_.parentStepId) shouldBe Vector(Some("t4"), Some("new-1"))
    }
    "emit creates parents-first even when the draft lists a child before its parent" in {
      val p = plan(unchangedSteps :+ newStep("b", Right("a")) :+ newStep("a", Left("t4"))).toOption.get
      val order = p.creates.map(_.id)
      p.creates.find(_.parentStepId.contains(order.head)).map(c => order.indexOf(c.id)) should contain (1)
    }
    "reject an explicit id that is not a step of the pipeline, unless the server is restoring" in {
      val ghost = step("t9", None, Some("r1"), 0, 9)
      error(plan(unchangedSteps :+ ghost)) should include("t9")
      val restored = plan(unchangedSteps :+ ghost, restoring = true).toOption.get
      restored.creates.map(_.id) shouldBe Vector("t9")
    }
    "reject an id and a clientId together, and neither" in {
      error(plan(unchangedSteps :+ newStep("a", Left("t4")).copy(id = Some("t2")))) should include("either id or clientId")
      error(plan(unchangedSteps :+ newStep("a", Left("t4")).copy(clientId = None))) should include("id or clientId is required")
    }
  }

  "content" should {
    "detect a changed config and a changed enabled flag, and ignore a cosmetically different but equal config" in {
      val steps = unchangedSteps.map {
        case s if s.id.contains("t2") => s.copy(config = JsObject("count" -> JsNumber(22)))
        case s if s.id.contains("t3") => s.copy(enabled = Some(false))
        case s                        => s
      }
      val p = plan(steps).toOption.get
      p.contentUpdates.map(_.id).toSet shouldBe Set("t2", "t3")
      p.oldConfigs.keySet shouldBe Set("t2", "t3")
    }
    "validate a changed config strictly and name the step" in {
      error(plan(unchangedSteps.map(s => if (s.id.contains("t2")) s.copy(config = JsObject("count" -> JsString("many"))) else s))) should (include("t2") and include("count"))
    }
    "plan a reorder as relinks of the moved siblings only" in {
      val steps = unchangedSteps.map {
        case s if s.id.contains("t2") => s.copy(position = 1)
        case s if s.id.contains("t3") => s.copy(position = 0)
        case s                        => s
      }
      plan(steps).toOption.get.relinks.map(_.id).toSet shouldBe Set("t2", "t3")
    }
    "rewrite a lane reference to a new step's clientId to the real id" in {
      val join = JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString("a")), "joinType" -> JsString("inner"), "leftKey" -> JsString("k"), "rightKey" -> JsString("k"))
      val joinStep = newStep("j", Left("t4")).copy(`type` = "join", config = join)
      val p = plan(unchangedSteps :+ newStep("a", Left("t1"), position = 2) :+ joinStep)
      p.toOption.map(_.creates.find(_.op == "join").get.config.parseJson.asJsObject.fields("secondaryInput").asJsObject.fields("stepId")) shouldBe Some(JsString("new-1"))
    }
  }

  "Outputs" should {
    "plan a rename as an update and a new Output on a new step as a create" in {
      val newOut = DraftOutputRequest(None, Some("nc"), "nc", "table", None, Some("a"), None, None)
      val p = plan(unchangedSteps :+ newStep("a", Left("t4")), unchangedOutputs.map(o => if (o.id.contains("oa")) o.copy(name = "renamed") else o) :+ newOut).toOption.get
      p.outputUpdates.map(_.id) shouldBe Vector("oa")
      p.outputCreates.map(_.nodeStepId) shouldBe Vector(Some("new-1"))
    }
    "name each problem" in {
      error(plan(outputs = unchangedOutputs.map(o => if (o.id.contains("oa")) o.copy(kind = "chart") else o))) should include("cannot change kind")
      error(plan(outputs = unchangedOutputs.map(o => if (o.id.contains("oa")) o.copy(nodeStepId = Some("t3")) else o))) should include("cannot move")
      error(plan(outputs = unchangedOutputs.map(o => if (o.id.contains("oa")) o.copy(name = "  ") else o))) should include("name is required")
    }
  }

  // HEL-1733 D12: a draft Output edit is judged like PATCH /api/outputs/:id (against the STORED config), so an Output
  // that carries a stored legacy key can still be renamed in a draft; a restore re-judges nothing it restores.
  "Output edit validation against the stored config (HEL-1733)" should {
    val legacyConfig = JsObject("metricLabel" -> JsString("Old label"))
    def metricOut(id: String, config: JsObject) =
      OutputRow(id, "p", Some("t2"), owner, "m", "metric", config, Vector.empty, 0, None, now, now, None)
    val legacyCurrent = current.copy(outputs = Vector(metricOut("om", legacyConfig)))
    def planLegacy(config: JsObject, name: String = "renamed", restoring: Boolean = false, id: String = "om") =
      DraftDiff.plan(
        legacyCurrent,
        DraftSaveRequest("fp", unchangedSteps, Vector(DraftOutputRequest(Some(id), None, name, "metric", Some("t2"), None, None, Some(config))), None, None),
        restoring,
        ids()
      )

    "plan an update (not a 400) for a rename of an Output whose stored config carries a legacy key" in {
      val p = planLegacy(legacyConfig).toOption.getOrElse(fail("expected a plan"))
      p.outputUpdates.map(_.name) shouldBe Vector("renamed")
    }
    "still refuse a draft that ADDS a new unknown key to that Output, naming the key" in {
      error(planLegacy(JsObject(legacyConfig.fields + ("metricUnit" -> JsString("ms"))))) should include("metricUnit")
    }
    "plan a create when a restore recreates a removed Output carrying a legacy key" in {
      val restored = DraftDiff.plan(
        current.copy(outputs = Vector.empty),
        DraftSaveRequest("fp", unchangedSteps, Vector(DraftOutputRequest(Some("om"), None, "m", "metric", Some("t2"), None, None, Some(legacyConfig))), None, None),
        true,
        ids()
      )
      restored.toOption.getOrElse(fail(s"expected a plan, got $restored")).outputCreates.map(_.id) shouldBe Vector("om")
    }
  }

  // ── HEL-1734: the root pass ──────────────────────────────────────────────────────────────────────────────────────────
  private def keepRoot(id: String)                      = DraftRootRequest(id = Some(id))
  private def newRoot(client: String, source: String)    = DraftRootRequest(clientId = Some(client), sourceId = Some(source))
  private def planRoots(roots: Vector[DraftRootRequest], steps: Vector[DraftStepRequest] = unchangedSteps, outputs: Vector[DraftOutputRequest] = unchangedOutputs, restoring: Boolean = false) =
    DraftDiff.plan(current, DraftSaveRequest("fp", steps, outputs, None, None, roots = Some(roots)), restoring, ids())

  "the root pass" should {
    "leave the roots alone when `roots` is absent" in {
      val p = plan().toOption.get
      p.rootPlan.rootsGiven shouldBe false
      p.rootPlan.creates shouldBe empty
      p.rootPlan.removedRootIds shouldBe empty
      p.addedSourceIds shouldBe empty
    }
    "plan a new root last, with its minted id, final index, source, and need the advisory lock" in {
      val p = planRoots(Vector(keepRoot("r1"), keepRoot("r2"), newRoot("nr", "dsX"))).toOption.get
      p.rootPlan.creates shouldBe Vector(RootWrite("new-1", "dsX", 2))
      p.rootPlan.finalRootIds shouldBe Vector("r1", "r2", "new-1")
      p.rootPlan.removedRootIds shouldBe empty
      p.addedSourceIds shouldBe Vector("dsX")
      p.needsAdvisory shouldBe true
    }
    "list the same source once when two new roots use it, sorted" in {
      val p = planRoots(Vector(keepRoot("r1"), keepRoot("r2"), newRoot("b", "dsZ"), newRoot("a", "dsA"), newRoot("c", "dsZ"))).toOption.get
      p.addedSourceIds shouldBe Vector("dsA", "dsZ")
    }
    "plan the removal of an omitted root, which counts as a removal" in {
      val steps = unchangedSteps.filterNot(_.id.contains("t4"))
      val outputs = unchangedOutputs.filterNot(_.id.contains("od"))
      val p = planRoots(Vector(keepRoot("r1")), steps, outputs).toOption.get
      p.rootPlan.removedRootIds shouldBe Vector("r2")
      p.removesAnything shouldBe true
      p.removedStepIds shouldBe Set("t4")
      p.removedOutputIds shouldBe Vector("od")
    }
    "let a step and an Output name a new root by rootClientId" in {
      val steps = unchangedSteps :+ DraftStepRequest(None, Some("ns"), "limit", JsObject("count" -> JsNumber(1)), None, None, None, None, 0, Some("nr"))
      val outputs = unchangedOutputs :+ DraftOutputRequest(None, Some("no"), "n", "table", None, None, None, Some(JsObject.empty), Some("nr"))
      val p = planRoots(Vector(keepRoot("r1"), keepRoot("r2"), newRoot("nr", "dsX")), steps, outputs).toOption.get
      p.creates.map(w => (w.rootId, w.parentStepId)) shouldBe Vector((Some("new-1"), None))
      p.outputCreates.map(_.rootId) shouldBe Vector(Some("new-1"))
    }
    "refuse, naming the cause (400)" in {
      error(planRoots(Vector.empty)) should include("last root")
      error(planRoots(Vector(keepRoot("r2"), keepRoot("r1")))) should include("stored order")
      error(planRoots(Vector(newRoot("nr", "dsX"), keepRoot("r1"), keepRoot("r2")))) should include("after every surviving root")
      error(planRoots(Vector(keepRoot("r1"), DraftRootRequest(id = Some("r2"), sourceId = Some("dsX"))))) should include("cannot carry sourceId")
      error(planRoots(Vector(keepRoot("r1"), keepRoot("zz")))) should include("not a root of this pipeline")
      error(planRoots(Vector(keepRoot("r1"), DraftRootRequest(id = Some("r2"), clientId = Some("x"))))) should include("not both")
      error(planRoots(Vector(keepRoot("r1"), keepRoot("r2"), DraftRootRequest()))) should include("required")
      error(planRoots(Vector(keepRoot("r1"), keepRoot("r2"), DraftRootRequest(clientId = Some("x"))))) should include("needs a sourceId")
      error(planRoots(Vector(keepRoot("r1"), keepRoot("r1"), keepRoot("r2")))) should include("Duplicate root")
      error(planRoots(Vector(keepRoot("r1"), keepRoot("r2"), newRoot("x", "a"), newRoot("x", "b")))) should include("Duplicate root")
    }
    "refuse a step or Output that still names a root the list removes, or a rootClientId nothing declares" in {
      error(planRoots(Vector(keepRoot("r1")))) should include("not a root of this pipeline")
      val ghost = unchangedSteps :+ DraftStepRequest(None, Some("ns"), "limit", JsObject("count" -> JsNumber(1)), None, None, None, None, 0, Some("ghost"))
      error(planRoots(Vector(keepRoot("r1"), keepRoot("r2")), ghost)) should include("rootClientId")
    }
    "in restore mode recreate a root under its explicit id and source, in the interleaved position the journal recorded" in {
      val p = planRoots(Vector(DraftRootRequest(id = Some("rOld"), sourceId = Some("dsOld")), keepRoot("r1"), keepRoot("r2")), restoring = true).toOption.get
      p.rootPlan.finalRootIds shouldBe Vector("rOld", "r1", "r2")
      p.rootPlan.creates shouldBe Vector(RootWrite("rOld", "dsOld", 0))
    }
  }
}
