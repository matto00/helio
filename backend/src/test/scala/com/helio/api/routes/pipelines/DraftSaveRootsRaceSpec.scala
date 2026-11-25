package com.helio.api.routes.pipelines

import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.LockSite
import com.helio.services.ServiceError
import com.helio.testsupport.{DraftRaceFixture, DraftSaveSeed, RaceOrder, RaceOutcome, RaceWriter, SaveFirst, WriterFirst}
import spray.json._

import java.time.Instant

/** HEL-1734 task 3.2: the save's root writes against the writers they can race (a source delete, a standalone root add or
 *  remove, a dataset append), both orders, each asserted by Postgres's own lock-wait view (see [[DraftRaceFixture]]).
 *  The protected run must show no violation, no `40P01` and an observed wait; the control removes the protecting site and
 *  the SAME race must then be a violation (the recorded mutation). */
class DraftSaveRootsRaceSpec extends DraftRaceFixture {

  private val owner = AuthenticatedUser(UserId(userA))
  private def pid(seed: DraftSaveSeed) = PipelineId(seed.pipeline)

  private def seedDs3(s: DraftSaveSeed): Unit =
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${s.id("ds3")}','ds3','dataset','{}',now(),now(),'$userA','[]')")

  private def keep(id: String): JsObject = JsObject("id" -> JsString(id))
  private def withRoots(d: JsObject, roots: JsObject*): JsObject = JsObject(d.fields + ("roots" -> JsArray(roots.toVector)))

  /** The save adds `ds3` as a new last root. */
  private val addsDs3: (DraftSaveSeed, String, JsObject) => JsObject = (s, fp, def0) =>
    withRoots(draftOf(fp, def0), keep(s.r1), keep(s.r2), JsObject("clientId" -> JsString("nr"), "sourceId" -> JsString(s.id("ds3"))))

  /** The save removes r2 (its step t4 is omitted; its Output `od` is deleted in `prepare`). */
  private val removesR2: (DraftSaveSeed, String, JsObject) => JsObject = (s, fp, def0) => {
    val d = draftOf(fp, def0)
    confirm2(withSteps(withRoots(d, keep(s.r1)), without(stepsOf(d), s.t4)), s)
  }

  private def confirm2(d: JsObject, s: DraftSaveSeed): JsObject =
    JsObject(d.fields + ("confirmCascade" -> JsObject(
      "stepIds" -> JsArray(JsString(s.t4)), "outputIds" -> JsArray(), "panelIds" -> JsArray(), "alertRuleIds" -> JsArray(), "rootIds" -> JsArray(JsString(s.r2))
    )))

  private def dropOd(s: DraftSaveSeed): Unit = exec(s"DELETE FROM outputs WHERE id='${s.od}'")

  private val writers: Vector[RaceWriter] = Vector(
    RaceWriter("root add (standalone) vs a root-REMOVING save", Set(LockSite.RootAdd),
      (h, s) => h.rootRepo.add(pid(s), DataSourceId(s.id("ds3")), owner),
      s => { seedDs3(s); dropOd(s) }, draft = Some(removesR2)),
    RaceWriter("root remove (standalone) vs a root-ADDING save", Set(LockSite.RootRemove),
      (h, s) => h.rootRepo.removeRoot(h.stepRepo, pid(s), PipelineRootId(s.r2), actor = owner),
      s => { seedDs3(s); dropOd(s) }, draft = Some(addsDs3)),
    RaceWriter("source delete of a removed root's source vs a root-REMOVING save", Set(LockSite.SourceDelete),
      (h, s) => h.dataSourceRepo.delete(DataSourceId(s.ds2), owner),
      s => dropOd(s), didWrite = _.toOption.contains(true), draft = Some(removesR2)),
  )

  // A dataset writer changes no fingerprinted state, so the fingerprint-violation oracle does not apply to it. What the
  // protocol promises is that it SERIALISES with a root-adding save on the added source's row (the writer's own `lockSource`
  // is FOR UPDATE on the row the save key-shares at (0)) and that the pair cannot deadlock. The control removes (0): the same
  // race then shows no wait at all.
  private val datasetAppend = RaceWriter("dataset append to the added source", Set(LockSite.SaveRootSources),
    (h, s) => h.dataSourceRepo.appendRows(DataSourceId(s.id("ds3")), Vector.empty, 100, Instant.now(), owner),
    s => seedDs3(s), didWrite = _ => false, hasViolationControl = false, draft = Some(addsDs3))

  private def protectedRun(writer: RaceWriter, order: RaceOrder): Unit = {
    val o = race(writer, order)
    withClue(s"protected: $o") { o.deadlock shouldBe false; o.violation shouldBe false; o.blockedObserved shouldBe true }
  }

  private def controlRun(writer: RaceWriter, order: RaceOrder): Unit = {
    val o = race(writer, order, removed = writer.protectedBy)
    withClue(s"control without ${writer.protectedBy.mkString(",")}: $o") { o.deadlock shouldBe false; o.violation shouldBe true }
  }

  writers.foreach { w =>
    w.name should {
      "writer-first: be excluded from the save's window" in protectedRun(w, WriterFirst)
      "save-first: be excluded from the save's window" in protectedRun(w, SaveFirst)
      "writer-first control: be a violation without the protecting site" in controlRun(w, WriterFirst)
      "save-first control: be a violation without the protecting site" in controlRun(w, SaveFirst)
    }
  }

  "a dataset append racing a root-adding save" should {
    Seq(WriterFirst, SaveFirst).foreach { order =>
      s"$order: wait on the source row, commit both, no deadlock" in {
        val o = race(datasetAppend, order)
        withClue(o.toString) {
          o.deadlock shouldBe false
          o.blockedObserved shouldBe true
          o.saveResult.isRight shouldBe true
          o.writerResult.isSuccess shouldBe true
        }
      }
      s"$order control without lock (0): no wait is observed" in {
        val o = race(datasetAppend, order, removed = Set(LockSite.SaveRootSources))
        withClue(o.toString) {
          o.deadlock shouldBe false
          o.blockedObserved shouldBe false
        }
      }
    }
  }

  // A source delete racing a save that adds that source. The oracle `violation` needs a 200 save, which the foreign key makes
  // impossible once the source is gone, so this block states the outcome itself.
  private val sourceDelete = RaceWriter("source delete of the ADDED source",  Set(LockSite.SaveRootSources),
    (h, s) => h.dataSourceRepo.delete(DataSourceId(s.id("ds3")), owner),
    s => seedDs3(s), didWrite = _.toOption.contains(true), hasViolationControl = false, draft = Some(addsDs3))

  private def rootsOnDs3(s: DraftSaveSeed): Vector[String] =
    queryStrings(s"SELECT id FROM pipeline_roots WHERE data_source_id='${s.id("ds3")}'")

  "a source delete racing a save that adds that source" should {
    "writer-first: answer 404 Data source not found (never a 500), write nothing and leave no root on the deleted source" in {
      val o = race(sourceDelete, WriterFirst)
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.blockedObserved shouldBe true
        o.saveResult.left.toOption.get shouldBe a[ServiceError.NotFound]
        o.saveResult.left.toOption.get.message should include("Data source not found")
      }
    }

    "save-first: serialise on the source row, the save committing and the delete then cascading the new root away" in {
      val o = race(sourceDelete, SaveFirst)
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.blockedObserved shouldBe true
        o.saveResult.isRight shouldBe true
        o.writerResult.isSuccess shouldBe true
      }
    }

    "writer-first control without lock (0): the save does NOT answer the clean 404; it fails inside the transaction on the foreign key" in {
      val o = race(sourceDelete, WriterFirst, removed = Set(LockSite.SaveRootSources))
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.saveResult.isLeft shouldBe true
        o.saveResult.left.toOption.get.message should (include("Referenced resource not found") and not include "Data source not found")
      }
    }

    "save-first control without lock (0): the delete commits inside the save's window and the save then fails" in {
      val o = race(sourceDelete, SaveFirst, removed = Set(LockSite.SaveRootSources))
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.saveResult.isLeft shouldBe true
      }
    }
  }
}
