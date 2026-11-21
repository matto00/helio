package com.helio.services.pipelines.draft

import com.helio.domain.model._
import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.testsupport.{DraftSaveHarness, DraftUndoRlsFixture}
import slick.jdbc.PostgresProfile
import spray.json._

import java.util.UUID
import scala.concurrent.Future

/** HEL-1792: undoing a pipeline draft save refuses (409, nothing changed) when it would delete panels the save did not
 *  create, and the refusal follows HEL-1720's naming rule: a blocking panel the undoing user can read is named by title and
 *  dashboard name, every other one is only counted, and no panel id, alert rule id, or unreadable panel title / dashboard
 *  name appears in the message or in any log line. Runs on `helio_app_test` (see [[DraftUndoRlsFixture]]). Cases (a)-(c),
 *  (e), (f) are red-first; (d) is a GUARD that is green on main (the fingerprint backstop). */
class DraftUndoPanelNamingSpec extends DraftUndoRlsFixture {

  import PostgresProfile.api._

  // ── the specs ───────────────────────────────────────────────────────────────────────────────

  "the harness" should {
    "run on a role that does not bypass RLS" in {
      await(db.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_app_test'".as[Boolean].head)) shouldBe false
      await(appDb.run(sql"SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user".as[Boolean].head)) shouldBe false
    }
  }

  "undo of a draft save that created an Output now carrying panels" should {

    "name the panels A can read by title and dashboard, count the one A cannot read, and leak no id" in {
      val s = seedStandings(suffix = " hel1792 a")
      val (appId, o) = saveCreatingOutput(s, "Created by draft A")
      val (fpAfterSave, _) = fingerprintAndDraft(s.pipelineId, owner)

      // P1: A binds a panel to O on D.
      val p1 = bindPanel(s.dashboardId, o, owner, "P1 visible one")
      // P2: B (editor on D) duplicates P1 and owns the copy; A reads it through D's owner branch.
      grantRole("dashboard", s.dashboardId, otherIdStr, "editor")
      val p2 = await(appPanels.duplicate(p1, otherUser)) match {
        case Right((p, _)) => p
        case Left(e)       => fail(s"B's PanelService.duplicate failed: $e")
      }
      p2.ownerId shouldBe otherUser.id
      // P3: B owns dashboard E and lets A edit it; A binds P3 to O there; B then revokes A's grant through the real
      // PermissionService; afterwards A cannot read E, so P3 is counted.
      val e = await(appDashboards.create(DashboardService.CreateDashboardInput(Some("B private board E")), otherUser))._1
      grantRole("dashboard", e.id.value, ownerIdStr, "editor")
      val p3 = bindPanel(e.id.value, o, owner, "P3 hidden panel")
      await(permissions.revoke(e.id.value, owner.id, otherUser)) shouldBe Right(())
      val (fpBefore, _) = fingerprintAndDraft(s.pipelineId, owner)

      var msg = ""
      val logs = logsDuring { msg = conflictMessage(appId, owner) }

      msg should include("\"P1 visible one\" on dashboard \"Standings hel1792 a\"")
      msg should include("\"P1 visible one (copy)\" on dashboard \"Standings hel1792 a\"")
      msg should include("1 panel(s) on dashboards you cannot see")
      Seq(p1.value, p2.id.value, p3.value, o, e.id.value).foreach { id =>
        withClue(s"id $id in the message: ")(msg should not include id)
      }
      msg should not include "P3 hidden panel"
      msg should not include "B private board E"
      logs.foreach { line =>
        Seq(p1.value, p2.id.value, p3.value, "P3 hidden panel", "B private board E").foreach(x => withClue(s"log line: $line")(line should not include x))
      }
      // nothing changed
      Seq(p1.value, p2.id.value, p3.value).foreach(id => panelExists(id) shouldBe true)
      outputExists(o) shouldBe true
      fingerprintAndDraft(s.pipelineId, owner)._1 shouldBe fpBefore
      fpBefore should not be fpAfterSave // the three binds moved it, so the refusal is the pre-check's, not a stale base
    }

    "not begin the panel clause with \"and\" when every panel is unreadable" in {
      val s = seedStandings(suffix = " hel1792 u")
      val (appId, o) = saveCreatingOutput(s, "Created for unreadable u")
      val e = await(appDashboards.create(DashboardService.CreateDashboardInput(Some("B private board U")), otherUser))._1
      grantRole("dashboard", e.id.value, ownerIdStr, "editor")
      val p = bindPanel(e.id.value, o, owner, "Hidden u")
      await(permissions.revoke(e.id.value, owner.id, otherUser)) shouldBe Right(())

      val msg = conflictMessage(appId, owner)
      msg should include("1 panel(s) (1 panel(s) on dashboards you cannot see)")
      msg should not include "(and"
      msg should not include p.value
      msg should not include "Hidden u"
    }

    "name an alert rule the undoing user owns by its name only, and carry no rule id" in {
      val s = seedStandings(suffix = " hel1792 e")
      val (appId, o) = saveCreatingOutput(s, "Created for rule E")
      val rule = createRule(o, owner, "Revenue floor rule")

      val msg = conflictMessage(appId, owner)
      msg should include("alert rule \"Revenue floor rule\"")
      msg should not include rule
      msg should not include o
      msg should not include "you do not own"
      ruleExists(rule) shouldBe true
      outputExists(o) shouldBe true
    }

    "count an alert rule another user owns, carrying neither its id nor its name (editor-saver undo)" in {
      val s = seedStandings(suffix = " hel1792 f")
      grantRole("pipeline", s.pipelineId, otherIdStr, "editor")
      val (appId, o) = saveCreatingOutput(s, "Created by editor B", otherUser)
      // A (the Output owner, though B's save created it) later puts a rule on O; create succeeding proves A owns O
      val rule = createRule(o, owner, "A secret rule name")

      val msg = conflictMessage(appId, otherUser)
      msg should include("1 alert rule(s) you do not own")
      msg should not include " and 1 alert rule(s)"
      msg should not include rule
      msg should not include "A secret rule name"
      msg should not include o
      ruleExists(rule) shouldBe true
      outputExists(o) shouldBe true
    }
  }

  "undo of a draft save whose cascade removed an Output with dependents" should {

    "be count-only: no panel id, no alert rule id, no rule name" in {
      val s = seedStandings(suffix = " hel1792 b")
      grantRole("dashboard", s.dashboardId, otherIdStr, "editor")
      val copy = await(appPanels.duplicate(PanelId(s.tablePanelId), otherUser)) match {
        case Right((p, _)) => p
        case Left(e)       => fail(s"B's duplicate failed: $e")
      }
      val rule = insertRule(s.tableOutputId, otherIdStr, "B removed rule")
      val appId = saveRemovingStandingsOutput(s, None, Seq(s.tablePanelId, copy.id.value), Seq(rule))
      panelExists(copy.id.value) shouldBe false // the save's cascade really removed it

      val msg = conflictMessage(appId, owner)
      msg should include("the save removed 2 panel(s) and 1 alert rule(s) with its Outputs")
      Seq(s.tablePanelId, copy.id.value, rule, s.tableOutputId, "B removed rule").foreach { x =>
        withClue(s"leaked $x: ")(msg should not include x)
      }
    }

    "combine with the created-Outputs refusal under one prefix and one suffix (D2a)" in {
      val s = seedStandings(suffix = " hel1792 c")
      val rule = createRule(s.tableOutputId, owner, "Removed rule c")
      val appId = saveRemovingStandingsOutput(s, Some("Created in the same save"), Seq(s.tablePanelId), Seq(rule))
      val created = outputIdByName(s.pipelineId, "Created in the same save")
      val later = bindPanel(s.dashboardId, created, owner, "Bound to created c")

      val msg = conflictMessage(appId, owner)
      msg should include("the save removed 1 panel(s) and 1 alert rule(s) with its Outputs")
      msg should include("\"Bound to created c\" on dashboard \"Standings hel1792 c\"")
      occurrences(msg, "Undo refused:") shouldBe 1
      occurrences(msg, "nothing was changed.") shouldBe 1
      msg.indexOf("the save removed") should be < msg.indexOf("Bound to created c")
      Seq(s.tablePanelId, later.value, rule, created, "Removed rule c").foreach(x => withClue(s"leaked $x: ")(msg should not include x))
      panelExists(later.value) shouldBe true
    }
  }

  "a panel bound to a created Output after the pre-check (a GUARD, green on main via the fingerprint backstop)" should {
    "answer PATCH_SET_STALE naming no panel id, and change nothing" in {
      val s = seedStandings(suffix = " hel1792 d")
      val (appId, o) = saveCreatingOutput(s, "Created for race d")
      val panelId = UUID.randomUUID().toString
      @volatile var armed = false
      val hooks = new DraftSaveHooks {
        def at(point: DraftHookPoint): DBIO[Unit] =
          if (armed && point == DraftHookPoint.Begin) {
            armed = false
            DBIO.from(Future {
              val conn = embeddedPostgres.getPostgresDatabase.getConnection
              try {
                conn.setAutoCommit(true)
                conn.createStatement().execute(
                  s"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, output_id)
                     |VALUES ('$panelId', '${s.dashboardId}', 'Raced d', '$ownerIdStr', now(), now(),
                     |'{"background":"transparent","color":"inherit","transparency":0.0}', 'output', '$ownerIdStr'::uuid, '$o')""".stripMargin
                )
              } finally conn.close()
            })
          } else DBIO.successful(())
      }
      val racing = new DraftSaveHarness(appCtx, hooks = hooks)
      val racingUndo = undoServiceOver(racing)
      armed = true
      val err = undoRefusal(appId, owner, racingUndo)
      err shouldBe a[ServiceError.PatchSetStale]
      val text = err.message
      text should not include panelId
      text should not include "Raced d"
      panelExists(panelId) shouldBe true
      outputExists(o) shouldBe true
    }
  }
}
