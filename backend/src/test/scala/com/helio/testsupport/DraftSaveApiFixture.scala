package com.helio.testsupport

import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode}
import slick.jdbc.PostgresProfile.api._
import spray.json._

/** The full route tree over a non-BYPASSRLS app pool (the production shape) plus the helpers every draft-save spec uses:
 *  seeding a pipeline by SQL, reading its definition and fingerprint through the API, turning a definition back into the
 *  draft body a client would send, and posting a save. User A owns every seeded pipeline, B is the user a spec makes an
 *  editor or viewer, C owns the "third user" dashboard and alert rule of the seed. */
abstract class DraftSaveApiFixture extends TwoUserRlsApiFixture {

  protected def seedPipeline(): DraftSaveSeed = {
    val seed = DraftSaveSeed.fresh(userA, userC)
    await(superDb.run(DBIO.seq(seed.statements.map(s => sqlu"#$s"): _*).transactionally))
    seed
  }

  protected def exec(sql: String): Unit = await(superDb.run(sqlu"#$sql")).intValue()

  protected def queryStrings(sql: String): Vector[String] = await(superDb.run(sql"#$sql".as[String])).toVector

  protected def get(path: String, user: String): (StatusCode, JsObject) =
    req(HttpMethods.GET, path, user) ~> routes ~> check { (status, responseAs[String].parseJson.asJsObject) }

  /** `(fingerprint, definition)` as a client reads them: one `GET /api/pipelines/:id?definition=true`. */
  protected def read(seed: DraftSaveSeed, user: String = userA): (String, JsObject) = {
    val (code, body) = get(s"/api/pipelines/${seed.pipeline}?definition=true", user)
    withClue(body.compactPrint)(code.intValue shouldBe 200)
    (body.fields("fingerprint").convertTo[String], body.fields("definition").asJsObject)
  }

  protected def save(seed: DraftSaveSeed, user: String, body: JsObject): (StatusCode, JsObject) =
    req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft/save", user, Some(body.compactPrint)) ~> routes ~> check {
      (status, responseAs[String].parseJson.asJsObject)
    }

  protected def stepRows(seed: DraftSaveSeed): Vector[String] = queryStrings(
    s"""SELECT id||'|'||op||'|'||config||'|'||enabled||'|'||coalesce(parent_step_id,'-')||'|'||coalesce(root_id,'-')||'|'||position
        FROM pipeline_steps WHERE pipeline_id='${seed.pipeline}' ORDER BY id""")

  protected def outputRows(seed: DraftSaveSeed): Vector[String] = queryStrings(
    s"""SELECT id||'|'||name||'|'||kind||'|'||config||'|'||coalesce(node_step_id,'-')||'|'||coalesce(root_id,'-')||'|'||position||'|'||owner_id
        FROM outputs WHERE pipeline_id='${seed.pipeline}' ORDER BY id""")

  /** Every row of the fingerprinted state, as text, for "nothing was written" assertions: steps, Outputs with their panels
   *  and alert rules, roots, the schedule, the pipeline head. */
  protected def storedState(seed: DraftSaveSeed): Vector[String] =
    stepRows(seed) ++ outputRows(seed) ++
      queryStrings(s"SELECT 'panel '||id||'|'||dashboard_id||'|'||coalesce(output_id,'-') FROM panels WHERE output_id IN (SELECT id FROM outputs WHERE pipeline_id='${seed.pipeline}') ORDER BY id") ++
      queryStrings(s"SELECT 'rule '||id||'|'||target_output_id FROM alert_rules WHERE target_output_id IN (SELECT id FROM outputs WHERE pipeline_id='${seed.pipeline}') ORDER BY id") ++
      queryStrings(s"SELECT 'root '||id||'|'||data_source_id||'|'||position FROM pipeline_roots WHERE pipeline_id='${seed.pipeline}' ORDER BY id") ++
      queryStrings(s"SELECT 'schedule '||kind||'|'||expression FROM pipeline_schedules WHERE pipeline_id='${seed.pipeline}'") ++
      queryStrings(s"SELECT 'pipeline '||name||'|'||coalesce(tag,'-') FROM pipelines WHERE id='${seed.pipeline}'")

  protected def journalCount(user: String): Int = queryStrings(s"SELECT count(*) FROM patch_set_applications WHERE owner_id='$user'").head.toInt

  /** The draft body for a definition read from the API: the same final tree, expressed as a client would send it. */
  protected def draftOf(fingerprint: String, definition: JsObject, extra: Map[String, JsValue] = Map.empty): JsObject = {
    def strOpt(o: JsObject, k: String): Option[JsValue] = o.fields.get(k).filter(_ != JsNull)
    val steps = definition.fields("steps").convertTo[Vector[JsObject]].map { s =>
      JsObject(
        Map("id" -> s.fields("id"), "type" -> s.fields("type"), "config" -> s.fields("config"), "enabled" -> s.fields("enabled"), "position" -> s.fields("position")) ++
          strOpt(s, "parentStepId").map("parentStepId" -> _) ++ strOpt(s, "rootId").map("rootId" -> _)
      )
    }
    val outputs = definition.fields("outputs").convertTo[Vector[JsObject]].map { o =>
      JsObject(
        Map("id" -> o.fields("id"), "name" -> o.fields("name"), "kind" -> o.fields("kind"), "config" -> o.fields("config")) ++
          strOpt(o, "nodeStepId").map("nodeStepId" -> _) ++ strOpt(o, "rootId").map("rootId" -> _)
      )
    }
    JsObject(Map("baseFingerprint" -> JsString(fingerprint), "steps" -> JsArray(steps), "outputs" -> JsArray(outputs)) ++ extra)
  }

  protected def withSteps(draft: JsObject, steps: Vector[JsObject]): JsObject = JsObject(draft.fields + ("steps" -> JsArray(steps)))
  protected def withOutputs(draft: JsObject, outputs: Vector[JsObject]): JsObject = JsObject(draft.fields + ("outputs" -> JsArray(outputs)))
  protected def stepsOf(draft: JsObject): Vector[JsObject]   = draft.fields("steps").convertTo[Vector[JsObject]]
  protected def outputsOf(draft: JsObject): Vector[JsObject] = draft.fields("outputs").convertTo[Vector[JsObject]]
  protected def byId(items: Vector[JsObject], id: String): JsObject = items.find(_.fields("id") == JsString(id)).get
  protected def replacing(items: Vector[JsObject], id: String)(f: JsObject => JsObject): Vector[JsObject] =
    items.map(o => if (o.fields("id") == JsString(id)) f(o) else o)
  protected def without(items: Vector[JsObject], ids: String*): Vector[JsObject] = items.filterNot(o => ids.contains(o.fields("id").convertTo[String]))
  protected def set(o: JsObject, key: String, value: JsValue): JsObject = JsObject(o.fields + (key -> value))
  protected def unset(o: JsObject, key: String): JsObject = JsObject(o.fields - key)
  protected def limit(n: Int): JsObject = JsObject("count" -> JsNumber(n))

  protected def newStep(clientId: String, parent: Either[String, String], position: Int = 0, count: Int = 9): JsObject =
    JsObject(
      Map("clientId" -> JsString(clientId), "type" -> JsString("limit"), "config" -> limit(count), "position" -> JsNumber(position)) ++
        (parent match {
          case Left(parentId)      => Map("parentStepId" -> JsString(parentId))
          case Right(parentClient) => Map("parentClientId" -> JsString(parentClient))
        })
    )

  protected def confirm(steps: Seq[String] = Nil, outputs: Seq[String] = Nil, panels: Seq[String] = Nil, rules: Seq[String] = Nil): JsObject =
    JsObject("confirmCascade" -> JsObject(
      "stepIds" -> JsArray(steps.map(JsString(_)).toVector), "outputIds" -> JsArray(outputs.map(JsString(_)).toVector),
      "panelIds" -> JsArray(panels.map(JsString(_)).toVector), "alertRuleIds" -> JsArray(rules.map(JsString(_)).toVector)
    ))

  protected def withConfirm(draft: JsObject, c: JsObject): JsObject = JsObject(draft.fields ++ c.fields)

  /** A draft that creates, updates, deletes, reorders and edits Outputs at once: t4 removed, t2 re-configured and moved to
   *  position 1, t3 to position 0, a new step under t3, `oc` removed, `ob` renamed, a new Output on the new step. */
  protected def wholeDraft(seed: DraftSaveSeed, fingerprint: String, definition: JsObject): JsObject = {
    val draft0 = draftOf(fingerprint, definition)
    val steps = replacing(replacing(without(stepsOf(draft0), seed.t4), seed.t2)(s => set(set(s, "config", limit(22)), "position", JsNumber(1))), seed.t3)(s => set(s, "position", JsNumber(0))) :+
      newStep("n1", Left(seed.t3), count = 9)
    val outputs = replacing(without(outputsOf(draft0), seed.oc), seed.ob)(o => set(o, "name", JsString("ob2"))) :+
      JsObject("clientId" -> JsString("nc"), "name" -> JsString("nc"), "kind" -> JsString("table"), "nodeStepClientId" -> JsString("n1"), "config" -> JsObject.empty)
    withConfirm(withOutputs(withSteps(draft0, steps), outputs), confirm(steps = Seq(seed.t4), outputs = Seq(seed.oc)))
  }
}
