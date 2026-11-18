package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed, JsonSchemaValidation}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import spray.json._

import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1734 task 3.1: `POST /api/pipelines/:id/draft/save` with `roots` (add, remove, replace, order, ownership, cycle,
 *  cascade confirmation, stale base), over the full route tree on a non-BYPASSRLS app pool. */
class DraftSaveRootsApiSpec extends DraftSaveApiFixture {

  override protected def auditEventRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): AuditEventRepository =
    new AuditEventRepository(ctx)

  /** A dataset source owned by `owner`, not a root of anything. */
  private def seedSource(owner: String): String = {
    val id = "src-" + UUID.randomUUID().toString.take(8)
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('$id','$id','dataset','{}',now(),now(),'$owner','[]')")
    id
  }

  private def rootRows(seed: DraftSaveSeed): Vector[String] =
    queryStrings(s"SELECT id||'|'||data_source_id||'|'||position FROM pipeline_roots WHERE pipeline_id='${seed.pipeline}' ORDER BY position")

  private def keep(id: String): JsObject                 = JsObject("id" -> JsString(id))
  private def fresh(clientId: String, sourceId: String): JsObject = JsObject("clientId" -> JsString(clientId), "sourceId" -> JsString(sourceId))
  private def withRoots(draft: JsObject, roots: JsObject*): JsObject = JsObject(draft.fields + ("roots" -> JsArray(roots.toVector)))
  private def confirmRoots(draft: JsObject, steps: Seq[String] = Nil, outputs: Seq[String] = Nil, panels: Seq[String] = Nil, rules: Seq[String] = Nil, roots: Seq[String] = Nil): JsObject =
    withConfirm(draft, JsObject("confirmCascade" -> JsObject(
      "stepIds" -> JsArray(steps.map(JsString(_)).toVector), "outputIds" -> JsArray(outputs.map(JsString(_)).toVector),
      "panelIds" -> JsArray(panels.map(JsString(_)).toVector), "alertRuleIds" -> JsArray(rules.map(JsString(_)).toVector),
      "rootIds" -> JsArray(roots.map(JsString(_)).toVector)
    )))
  private def newRootStep(clientId: String, rootClientId: String): JsObject =
    JsObject("clientId" -> JsString(clientId), "type" -> JsString("limit"), "config" -> limit(7), "position" -> JsNumber(0), "rootClientId" -> JsString(rootClientId))

  private def savedRoots(body: JsObject): Vector[JsObject] =
    body.fields("saved").asJsObject.fields("definition").asJsObject.fields("roots").convertTo[Vector[JsObject]]

  "a save that adds a root" should {
    "write the root last, store a step and an Output on it by rootClientId, return definition.roots and move the fingerprint" in {
      val seed = seedPipeline()
      val ds3 = seedSource(userA)
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val draft = withOutputs(
        withSteps(withRoots(draft0, keep(seed.r1), keep(seed.r2), fresh("nr", ds3)), stepsOf(draft0) :+ newRootStep("ns", "nr")),
        outputsOf(draft0) :+ JsObject("clientId" -> JsString("no"), "name" -> JsString("rootOut"), "kind" -> JsString("table"), "rootClientId" -> JsString("nr"), "config" -> JsObject.empty)
      )
      val journals = journalCount(userA)
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("pipelines/draft-save-response.schema.json"), body.compactPrint) shouldBe empty

      val rows = rootRows(seed)
      rows.take(2) shouldBe Vector(s"${seed.r1}|${seed.ds1}|0", s"${seed.r2}|${seed.ds2}|1")
      rows should have size 3
      val Array(newRoot, source, pos) = rows(2).split('|')
      source shouldBe ds3
      pos shouldBe "2"
      stepRows(seed).count(r => r.contains("{\"count\":7}") && r.contains(s"|-|$newRoot|0")) shouldBe 1
      outputRows(seed).count(r => r.contains("|rootOut|") && r.contains(s"|$newRoot|")) shouldBe 1
      savedRoots(body).map(_.fields("id").convertTo[String]) shouldBe Vector(seed.r1, seed.r2, newRoot)
      savedRoots(body).map(_.fields("dataSourceName").convertTo[String]).last shouldBe ds3
      body.fields("saved").asJsObject.fields("fingerprint").convertTo[String] should not be fingerprint
      read(seed)._1 shouldBe body.fields("saved").asJsObject.fields("fingerprint").convertTo[String]
      journalCount(userA) shouldBe journals + 1
      queryStrings(s"SELECT count(*) FROM audit_events WHERE action='pipeline.draft.save' AND resource_id='${seed.pipeline}'") shouldBe Vector("1")
    }

    "let an editor add a source they own, and refuse a source another user owns with 404 and nothing written" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val own = seedSource(userB)
      val foreign = seedSource(userC)
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val before = storedState(seed)
      val journals = journalCount(userB)
      val (code404, body404) = save(seed, userB, withRoots(draft0, keep(seed.r1), keep(seed.r2), fresh("nr", foreign)))
      withClue(body404.compactPrint)(code404 shouldBe StatusCodes.NotFound)
      storedState(seed) shouldBe before
      journalCount(userB) shouldBe journals
      // The owner's own source is not the editor's: the check is the CALLER's ownership, like POST /roots.
      save(seed, userB, withRoots(draft0, keep(seed.r1), keep(seed.r2), fresh("nr", seedSource(userA))))._1 shouldBe StatusCodes.NotFound
      val (code, body) = save(seed, userB, withRoots(draft0, keep(seed.r1), keep(seed.r2), fresh("nr", own)))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      rootRows(seed).last should include(s"|$own|2")
    }

    "answer 400 naming the cycle and write nothing when the new root is read by a step that writes the same source" in {
      val seed = seedPipeline()
      val ds3 = seedSource(userA)
      exec(
        s"""INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id)
            VALUES ('${seed.id("up")}','${seed.pipeline}',0,'upsertsource','{"target":{"kind":"existingSource","dataSourceId":"$ds3"},"mode":"append"}',now(),now(),true,'${seed.t4}',NULL)"""
      )
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val (code, body) = save(seed, userA, withRoots(draftOf(fingerprint, definition), keep(seed.r1), keep(seed.r2), fresh("nr", ds3)))
      withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
      storedState(seed) shouldBe before
    }

    "answer 409 PATCH_SET_STALE for a draft based before a standalone root add, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val ds3 = seedSource(userA)
      req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/roots", userA, Some(JsObject("sourceId" -> JsString(ds3)).compactPrint)) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      val before = storedState(seed)
      val (code, body) = save(seed, userA, draftOf(fingerprint, definition))
      code shouldBe StatusCodes.Conflict
      body.fields("code") shouldBe JsString("PATCH_SET_STALE")
      storedState(seed) shouldBe before
    }
  }

  "a save without roots" should {
    "leave the stored roots exactly as they were" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val before = rootRows(seed)
      val draft0 = draftOf(fingerprint, definition)
      val (code, body) = save(seed, userA, withSteps(draft0, stepsOf(draft0) :+ newStep("n1", Left(seed.t4))))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      rootRows(seed) shouldBe before
      savedRoots(body).map(_.fields("id").convertTo[String]) shouldBe Vector(seed.r1, seed.r2)
    }

    "treat an explicit unchanged list the same as no list" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val (code, body) = save(seed, userA, withRoots(draftOf(fingerprint, definition), keep(seed.r1), keep(seed.r2)))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      storedState(seed) shouldBe before
      body.fields("saved").asJsObject.fields("fingerprint") shouldBe JsString(fingerprint)
    }
  }

  "a save that removes a root" should {
    "delete the root, its steps, Outputs and node snapshots, keep the rest, and leave the survivor at position 0" in {
      val seed = seedPipeline()
      exec(s"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ('${seed.pipeline}', '${seed.t4}', 0, '{}'::jsonb)")
      exec(s"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id) VALUES ('${seed.pipeline}', NULL, 0, '{}'::jsonb, '${seed.r2}')")
      exec(s"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ('${seed.pipeline}', '${seed.t1}', 0, '{}'::jsonb)")
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val draft = confirmRoots(
        withOutputs(withSteps(withRoots(draft0, keep(seed.r1)), without(stepsOf(draft0), seed.t4)), without(outputsOf(draft0), seed.od)),
        steps = Seq(seed.t4), outputs = Seq(seed.od), roots = Seq(seed.r2)
      )
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      rootRows(seed) shouldBe Vector(s"${seed.r1}|${seed.ds1}|0")
      stepRows(seed).exists(_.startsWith(seed.t4)) shouldBe false
      outputRows(seed).exists(_.startsWith(seed.od)) shouldBe false
      queryStrings(s"SELECT node_step_id FROM node_snapshots WHERE pipeline_id='${seed.pipeline}' ORDER BY node_step_id") shouldBe Vector(seed.t1)
      savedRoots(body).map(_.fields("id").convertTo[String]) shouldBe Vector(seed.r1)
    }

    "answer 422 with impact.rootIds when the root is not in the confirmation, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val before = storedState(seed)
      val draft = confirmRoots(
        withOutputs(withSteps(withRoots(draft0, keep(seed.r1)), without(stepsOf(draft0), seed.t4)), without(outputsOf(draft0), seed.od)),
        steps = Seq(seed.t4), outputs = Seq(seed.od)
      )
      val (code, body) = save(seed, userA, draft)
      code shouldBe StatusCodes.UnprocessableEntity
      body.fields("code") shouldBe JsString("CASCADE_CONFIRMATION_REQUIRED")
      body.fields("impact").asJsObject.fields("rootIds").convertTo[Vector[String]] shouldBe Vector(seed.r2)
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("pipelines/draft-cascade-required-response.schema.json"), body.compactPrint) shouldBe empty
      storedState(seed) shouldBe before
    }

    "keep a step the draft relinks off the removed root (the root is a placement; the step survives)" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val relinked = replacing(stepsOf(draft0), seed.t4)(s => set(set(unset(s, "rootId"), "parentStepId", JsString(seed.t1)), "position", JsNumber(5)))
      val draft = confirmRoots(
        withOutputs(withSteps(withRoots(draft0, keep(seed.r1)), relinked), without(outputsOf(draft0), seed.od)),
        outputs = Seq(seed.od), roots = Seq(seed.r2)
      )
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      stepRows(seed) should contain(s"${seed.t4}|limit|{\"count\":4}|true|${seed.t1}|-|5")
      rootRows(seed) shouldBe Vector(s"${seed.r1}|${seed.ds1}|0")
    }

    "replace the first root and add one: the survivor moves to position 0 and the new root lands at 1" in {
      val seed = seedPipeline()
      val ds3 = seedSource(userA)
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val draft = confirmRoots(
        withOutputs(
          withSteps(withRoots(draft0, keep(seed.r2), fresh("nr", ds3)), stepsOf(draft0).filter(s => s.fields("id") == JsString(seed.t4))),
          outputsOf(draft0).filter(o => o.fields("id") == JsString(seed.od))
        ),
        steps = Seq(seed.t1, seed.t2, seed.t3), outputs = Seq(seed.oa, seed.ob, seed.oc),
        panels = Seq(seed.pa, seed.pb), rules = Seq(seed.ra, seed.rb), roots = Seq(seed.r1)
      )
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      val rows = rootRows(seed)
      rows.head shouldBe s"${seed.r2}|${seed.ds2}|0"
      rows(1) should (endWith(s"|$ds3|1"))
      rows should have size 2
    }

    "replace the only root: the new root is the pipeline's single root at position 0" in {
      val seed = seedPipeline()
      val ds3 = seedSource(userA)
      // Make r1 the only root: drop r2 and everything on it.
      exec(s"DELETE FROM outputs WHERE id='${seed.od}'")
      exec(s"DELETE FROM pipeline_steps WHERE id='${seed.t4}'")
      exec(s"DELETE FROM pipeline_roots WHERE id='${seed.r2}'")
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val draft = confirmRoots(
        withOutputs(withSteps(withRoots(draft0, fresh("nr", ds3)), Vector.empty), Vector.empty),
        steps = Seq(seed.t1, seed.t2, seed.t3), outputs = Seq(seed.oa, seed.ob, seed.oc),
        panels = Seq(seed.pa, seed.pb), rules = Seq(seed.ra, seed.rb), roots = Seq(seed.r1)
      )
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      val rows = rootRows(seed)
      rows should have size 1
      rows.head should endWith(s"|$ds3|0")
    }
  }

  "the roots list" should {
    def rejected(name: String, status: StatusCodes.ClientError = StatusCodes.BadRequest)(mutate: (DraftSaveSeed, String, JsObject) => JsObject): Unit =
      s"answer ${status.intValue} and write nothing: $name" in {
        val seed = seedPipeline()
        val ds3 = seedSource(userA)
        val (fingerprint, definition) = read(seed)
        val before = storedState(seed)
        val journals = journalCount(userA)
        val (code, body) = save(seed, userA, mutate(seed, ds3, draftOf(fingerprint, definition)))
        withClue(body.compactPrint)(code shouldBe status)
        storedState(seed) shouldBe before
        journalCount(userA) shouldBe journals
      }

    rejected("an empty list") { (_, _, d) => withRoots(d) }
    rejected("a reorder of the survivors") { (seed, _, d) => withRoots(d, keep(seed.r2), keep(seed.r1)) }
    rejected("a new root before a survivor") { (seed, ds3, d) => withRoots(d, keep(seed.r1), fresh("nr", ds3), keep(seed.r2)) }
    rejected("a survivor that carries a sourceId") { (seed, ds3, d) =>
      withRoots(d, keep(seed.r1), JsObject("id" -> JsString(seed.r2), "sourceId" -> JsString(ds3)))
    }
    rejected("an id that is not a root of this pipeline (explicit ids are undo-only)") { (seed, ds3, d) =>
      withRoots(d, keep(seed.r1), keep(seed.r2), JsObject("id" -> JsString("someone-elses-root"), "sourceId" -> JsString(ds3)))
    }
    rejected("an item with both an id and a clientId") { (seed, ds3, d) =>
      withRoots(d, keep(seed.r1), JsObject("id" -> JsString(seed.r2), "clientId" -> JsString("x"), "sourceId" -> JsString(ds3)))
    }
    rejected("an item with neither") { (seed, _, d) => withRoots(d, keep(seed.r1), keep(seed.r2), JsObject.empty) }
    rejected("a new root without a sourceId") { (seed, _, d) => withRoots(d, keep(seed.r1), keep(seed.r2), JsObject("clientId" -> JsString("nr"))) }
    rejected("a repeated clientId") { (seed, ds3, d) => withRoots(d, keep(seed.r1), keep(seed.r2), fresh("nr", ds3), fresh("nr", ds3)) }
    rejected("a repeated root id") { (seed, _, d) => withRoots(d, keep(seed.r1), keep(seed.r1), keep(seed.r2)) }
    rejected("a step that still names a root the list removes") { (seed, _, d) => withRoots(d, keep(seed.r1)) }
    rejected("a rootClientId that names no new root") { (seed, _, d) =>
      withSteps(withRoots(d, keep(seed.r1), keep(seed.r2)), stepsOf(d) :+ newRootStep("ns", "ghost"))
    }
    rejected("a step naming both a rootId and a rootClientId", StatusCodes.BadRequest) { (seed, ds3, d) =>
      withSteps(withRoots(d, keep(seed.r1), keep(seed.r2), fresh("nr", ds3)), replacing(stepsOf(d), seed.t1)(s => set(s, "rootClientId", JsString("nr"))))
    }
    rejected("a source that does not exist", StatusCodes.NotFound) { (seed, _, d) => withRoots(d, keep(seed.r1), keep(seed.r2), fresh("nr", "no-such-source")) }
  }

  "an insight Output (HEL-1740) in a root-changing draft" should {
    def insight(reads: String, node: (String, String)): JsObject = JsObject(
      "clientId" -> JsString("ins"), "name" -> JsString("ins"), "kind" -> JsString("insight"), node._1 -> JsString(node._2),
      "config" -> JsObject("reads" -> JsObject("outputs" -> JsArray(JsString(reads))))
    )

    "save on a draft root, reading a surviving Output" in {
      val seed = seedPipeline()
      val ds3 = seedSource(userA)
      val (fingerprint, definition) = read(seed)
      val d = draftOf(fingerprint, definition)
      val draft = withOutputs(withRoots(d, keep(seed.r1), keep(seed.r2), fresh("nr", ds3)), outputsOf(d) :+ insight(seed.oa, "rootClientId" -> "nr"))
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      outputRows(seed).count(_.contains("|ins|insight|")) shouldBe 1
    }

    "400 and write nothing when it reads an Output on a root the same draft removes" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val d = draftOf(fingerprint, definition)
      val before = storedState(seed)
      val draft = confirmRoots(
        withOutputs(withSteps(withRoots(d, keep(seed.r1)), without(stepsOf(d), seed.t4)), without(outputsOf(d), seed.od) :+ insight(seed.od, "nodeStepId" -> seed.t1)),
        steps = Seq(seed.t4), outputs = Seq(seed.od), roots = Seq(seed.r2)
      )
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
      body.compactPrint should include("reads.outputs")
      storedState(seed) shouldBe before
    }
  }
}
