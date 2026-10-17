package com.helio.api.routes.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed, JsonSchemaValidation}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1629 task 6.1: `POST /api/pipelines/:id/draft/save` over the full route tree on a non-BYPASSRLS app pool. */
class DraftSaveApiSpec extends DraftSaveApiFixture {

  override protected def auditEventRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): AuditEventRepository =
    new AuditEventRepository(ctx)

  "GET /api/pipelines/:id" should {
    "return a fingerprint, and with ?definition=true the steps and Outputs it was computed from" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      fingerprint should startWith("v1:")
      definition.fields("steps").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String]).toSet shouldBe Set(seed.t1, seed.t2, seed.t3, seed.t4)
      definition.fields("outputs").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String]).toSet shouldBe Set(seed.oa, seed.ob, seed.oc, seed.od)
    }

    "not carry a fingerprint in the list" in {
      seedPipeline()
      val items = req(HttpMethods.GET, "/api/pipelines", userA) ~> routes ~> check {
        responseAs[String].parseJson.convertTo[Vector[JsObject]]
      }
      items should not be empty
      all(items.map(_.fields.contains("fingerprint"))) shouldBe false
    }

    "serve the same fingerprint to an editor as to the owner (the privileged read sees other users' panels and rules)" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      read(seed, userB)._1 shouldBe read(seed, userA)._1
    }
  }

  "the real bodies on the wire" should {
    "validate against the committed schemas: the GET, the 200, the 409 and the 422" in {
      val seed = seedPipeline()
      val (code0, getBody) = get(s"/api/pipelines/${seed.pipeline}?definition=true", userA)
      code0 shouldBe StatusCodes.OK
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("pipelines/pipeline-summary.schema.json"), getBody.compactPrint) shouldBe empty
      val fp = getBody.fields("fingerprint").convertTo[String]
      val definition = getBody.fields("definition").asJsObject
      val ok = save(seed, userA, wholeDraft(seed, fp, definition))._2
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("pipelines/draft-save-response.schema.json"), ok.compactPrint) shouldBe empty
      val stale = save(seed, userA, draftOf(fp, definition))._2
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("shared/patch-set-stale-response.schema.json"), stale.compactPrint) shouldBe empty
      val seed2 = seedPipeline()
      val (fp2, definition2) = read(seed2)
      val d = draftOf(fp2, definition2)
      val cascade = save(seed2, userA, withOutputs(withSteps(d, without(stepsOf(d), seed2.t3)), without(outputsOf(d), seed2.oc)))._2
      JsonSchemaValidation.validationErrors(JsonSchemaValidation.compile("pipelines/draft-cascade-required-response.schema.json"), cascade.compactPrint) shouldBe empty
    }
  }

  "an unchanged draft" should {
    "save with 200, leave the stored state and the fingerprint as they were, and write one journal and one audit row" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val journals = journalCount(userA)
      val (code, body) = save(seed, userA, draftOf(fingerprint, definition))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      body.fields("run") shouldBe JsNull
      body.fields("saved").asJsObject.fields("fingerprint") shouldBe JsString(fingerprint)
      storedState(seed) shouldBe before
      journalCount(userA) shouldBe journals + 1
      queryStrings(s"SELECT count(*) FROM audit_events WHERE action='pipeline.draft.save' AND resource_id='${seed.pipeline}'") shouldBe Vector("1")
    }
  }

  "a whole draft" should {
    "create, update, delete, reorder and edit Outputs in one call, and the stored definition equals the draft" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft = wholeDraft(seed, fingerprint, definition)
      val (code, body) = save(seed, userA, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)

      val savedFp = body.fields("saved").asJsObject.fields("fingerprint").convertTo[String]
      savedFp should not be fingerprint
      read(seed)._1 shouldBe savedFp

      val rows = stepRows(seed)
      rows.exists(_.startsWith(seed.t4)) shouldBe false
      rows should contain(s"${seed.t2}|limit|{\"count\":22}|true|${seed.t1}|-|1")
      rows should contain(s"${seed.t3}|limit|{\"count\":3}|true|${seed.t1}|-|0")
      val created = rows.filter(_.contains("{\"count\":9}"))
      created should have size 1
      created.head should include(s"|${seed.t3}|-|0")
      val outs = outputRows(seed)
      outs.exists(_.startsWith(seed.oc)) shouldBe false
      outs.exists(_.startsWith(s"${seed.ob}|ob2|")) shouldBe true
      outs.count(_.startsWith(s"${seed.id("")}")) shouldBe 3 // oa, ob, od survive; nc is created with a generated id
    }
  }

  "a stale base" should {
    "answer 409 PATCH_SET_STALE naming the pipeline and the current fingerprint, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      exec(s"UPDATE pipeline_steps SET config='{\"count\":77}' WHERE id='${seed.t2}'")
      val before = storedState(seed)
      val journals = journalCount(userA)
      val (code, body) = save(seed, userA, draftOf(fingerprint, definition))
      code shouldBe StatusCodes.Conflict
      body.fields("code") shouldBe JsString("PATCH_SET_STALE")
      val stale = body.fields("staleTargets").convertTo[Vector[JsObject]]
      stale.map(_.fields("kind")) shouldBe Vector(JsString("pipeline"))
      stale.map(_.fields("id")) shouldBe Vector(JsString(seed.pipeline))
      body.fields("currentFingerprint").convertTo[String] shouldBe read(seed)._1
      storedState(seed) shouldBe before
      journalCount(userA) shouldBe journals
    }

    "win over a draft that names a step another writer deleted: 409 to reload, not a 400 about an id" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      exec(s"DELETE FROM pipeline_steps WHERE id='${seed.t4}'")
      val before = storedState(seed)
      val (code, body) = save(seed, userA, draftOf(fingerprint, definition))
      code shouldBe StatusCodes.Conflict
      body.fields("code") shouldBe JsString("PATCH_SET_STALE")
      body.fields("currentFingerprint").convertTo[String] shouldBe read(seed)._1
      storedState(seed) shouldBe before
    }

    "have no force path: a request field cannot bypass the compare" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      exec(s"UPDATE pipeline_steps SET enabled=false WHERE id='${seed.t3}'")
      val (code, _) = save(seed, userA, JsObject(draftOf(fingerprint, definition).fields ++ Map("force" -> JsBoolean(true), "overwrite" -> JsBoolean(true))))
      code shouldBe StatusCodes.Conflict
    }

    "be refused when only an alert rule changed (the fingerprint covers state the save does not write)" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      exec(s"UPDATE alert_rules SET enabled=false WHERE id='${seed.rb}'")
      save(seed, userA, draftOf(fingerprint, definition))._1 shouldBe StatusCodes.Conflict
    }
  }

  "the cascade" should {
    "answer 422 listing the Outputs, panels (including another user's) and alert rules a removed step takes, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      // Remove t2 (and so the Outputs oa and ob on it, their panels pa and pb and their rules ra and rb) keeping nothing under it.
      val draft = withOutputs(withSteps(draft0, without(stepsOf(draft0), seed.t2)), without(outputsOf(draft0), seed.oa, seed.ob))
      val before = storedState(seed)
      val (code, body) = save(seed, userA, withConfirm(draft, confirm(steps = Seq(seed.t2), outputs = Seq(seed.oa, seed.ob), panels = Seq(seed.pa))))
      code shouldBe StatusCodes.UnprocessableEntity
      body.fields("code") shouldBe JsString("CASCADE_CONFIRMATION_REQUIRED")
      val impact = body.fields("impact").asJsObject
      impact.fields("stepIds").convertTo[Vector[String]] shouldBe Vector(seed.t2)
      impact.fields("outputIds").convertTo[Vector[String]].toSet shouldBe Set(seed.oa, seed.ob)
      impact.fields("panelIds").convertTo[Vector[String]].toSet shouldBe Set(seed.pa, seed.pb)
      impact.fields("alertRuleIds").convertTo[Vector[String]].toSet shouldBe Set(seed.ra, seed.rb)
      storedState(seed) shouldBe before
    }

    "delete exactly what the client confirmed" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      val draft = withOutputs(withSteps(draft0, without(stepsOf(draft0), seed.t2)), without(outputsOf(draft0), seed.oa, seed.ob))
      val (code, body) = save(seed, userA, withConfirm(draft, confirm(
        steps = Seq(seed.t2), outputs = Seq(seed.oa, seed.ob), panels = Seq(seed.pa, seed.pb), rules = Seq(seed.ra, seed.rb)
      )))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      queryStrings(s"SELECT id FROM panels WHERE id IN ('${seed.pa}','${seed.pb}')") shouldBe empty
      queryStrings(s"SELECT id FROM alert_rules WHERE id IN ('${seed.ra}','${seed.rb}')") shouldBe empty
      queryStrings(s"SELECT id FROM dashboards WHERE id='${seed.d3}'") shouldBe Vector(seed.d3)
    }

    "keep a head child: delete a step while the draft re-parents its children" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      // t1 goes; t2 becomes the root-level step of r1, t3 hangs under t2.
      val steps = replacing(replacing(without(stepsOf(draft0), seed.t1), seed.t2)(s => set(unset(s, "parentStepId"), "rootId", JsString(seed.r1))), seed.t3)(s => set(s, "parentStepId", JsString(seed.t2)))
      val (code, body) = save(seed, userA, withConfirm(withSteps(draft0, steps), confirm(steps = Seq(seed.t1))))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      val rows = stepRows(seed)
      rows should contain(s"${seed.t2}|limit|{\"count\":2}|true|-|${seed.r1}|0")
      rows should contain(s"${seed.t3}|limit|{\"count\":3}|true|${seed.t2}|-|1")
      outputRows(seed).count(_.startsWith(seed.oa)) shouldBe 1
    }

    "keep a tail child that the draft moves elsewhere (the server never deletes a step the draft keeps)" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft0 = draftOf(fingerprint, definition)
      // t3 is a tail of t1; the draft moves it under t4 on the other root and deletes t1 and its trunk child t2.
      val steps = replacing(without(stepsOf(draft0), seed.t1, seed.t2), seed.t3)(s => set(s, "parentStepId", JsString(seed.t4)))
      val draft = withOutputs(withSteps(draft0, steps), without(outputsOf(draft0), seed.oa, seed.ob))
      val (code, body) = save(seed, userA, withConfirm(draft, confirm(
        steps = Seq(seed.t1, seed.t2), outputs = Seq(seed.oa, seed.ob), panels = Seq(seed.pa, seed.pb), rules = Seq(seed.ra, seed.rb)
      )))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      stepRows(seed) should contain(s"${seed.t3}|limit|{\"count\":3}|true|${seed.t4}|-|1")
      outputRows(seed).count(_.startsWith(seed.oc)) shouldBe 1
    }
  }

  "access control" should {
    "answer 403 to a viewer, 404 to a stranger, and let an editor save with created rows owned by the pipeline owner" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val draft = draftOf(fingerprint, definition)
      save(seed, userC, draft)._1 shouldBe StatusCodes.NotFound
      exec(seed.grant(userB, "viewer"))
      save(seed, userB, draft)._1 shouldBe StatusCodes.Forbidden
      exec(s"UPDATE resource_permissions SET role='editor' WHERE resource_id='${seed.pipeline}' AND grantee_id='$userB'")
      val withNew = withSteps(draft, stepsOf(draft) :+ newStep("n1", Left(seed.t4)))
      val (code, body) = save(seed, userB, JsObject(withNew.fields + ("baseFingerprint" -> JsString(fingerprint))))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      queryStrings(s"SELECT owner_id FROM patch_set_applications WHERE owner_id='$userB'") shouldBe Vector(userB)
      stepRows(seed).count(_.contains("{\"count\":9}")) shouldBe 1
    }
  }

  "validation" should {
    def rejected(name: String)(mutate: (DraftSaveSeed, JsObject) => JsObject): Unit =
      s"answer 400 and write nothing: $name" in {
        val seed = seedPipeline()
        val (fingerprint, definition) = read(seed)
        val before = storedState(seed)
        val journals = journalCount(userA)
        val (code, body) = save(seed, userA, mutate(seed, draftOf(fingerprint, definition)))
        withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
        storedState(seed) shouldBe before
        journalCount(userA) shouldBe journals
      }

    rejected("a step config that fails the strict write check, naming the step") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "config", JsObject("count" -> JsString("many")))))
    }
    rejected("an unknown step type") { (seed, d) => withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "type", JsString("nonsense")))) }
    rejected("an explicit id that is not a step of this pipeline (explicit ids are undo-only)") { (_, d) =>
      withSteps(d, stepsOf(d) :+ JsObject("id" -> JsString("someone-elses-step"), "type" -> JsString("limit"), "config" -> limit(1), "position" -> JsNumber(0), "rootId" -> JsString("x")))
    }
    rejected("a parent that is not in the draft") { (seed, d) =>
      withSteps(d, stepsOf(d) :+ newStep("n1", Left("ghost")))
    }
    rejected("a parent cycle") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t1)(s => set(unset(s, "rootId"), "parentStepId", JsString(seed.t2))))
    }
    rejected("a step naming both a parent and a root") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "rootId", JsString(seed.r1))))
    }
    rejected("a step with neither a parent nor a root") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t1)(s => unset(s, "rootId")))
    }
    rejected("a root that is not a root of this pipeline") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t1)(s => set(s, "rootId", JsString("nope"))))
    }
    rejected("a duplicate clientId") { (seed, d) =>
      withSteps(d, stepsOf(d) :+ newStep("n1", Left(seed.t4)) :+ newStep("n1", Left(seed.t4)))
    }
    rejected("an Output on a step the draft removes") { (seed, d) =>
      withSteps(d, without(stepsOf(d), seed.t3))
    }
    rejected("a type change on an existing step") { (seed, d) =>
      withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "type", JsString("sort"))))
    }
    rejected("an Output that moves to another node") { (seed, d) =>
      withOutputs(d, replacing(outputsOf(d), seed.oc)(o => set(o, "nodeStepId", JsString(seed.t2))))
    }
    rejected("an Output with an unknown kind") { (seed, d) =>
      withOutputs(d, replacing(outputsOf(d), seed.oc)(o => set(o, "kind", JsString("sparkline"))))
    }
  }

  "an empty body shape" should {
    "answer 400 for a blank baseFingerprint" in {
      val seed = seedPipeline()
      val (_, definition) = read(seed)
      save(seed, userA, draftOf("", definition))._1 shouldBe StatusCodes.BadRequest
    }
  }
}
