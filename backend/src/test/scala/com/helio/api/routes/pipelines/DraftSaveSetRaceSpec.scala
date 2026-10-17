package com.helio.api.routes.pipelines

import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, UserId}
import com.helio.infrastructure.persistence.pipelines.LockSite
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository.TeardownOutcome
import com.helio.testsupport.{DraftRaceFixture, DraftSaveSeed, RaceWriter}

/** HEL-1629 task 6.3b (C8): a writer that takes lock (3) over a SET it READ gets a three-session race, red first. The
 *  reader is a source delete (and the workspace teardown); the grower is a root add on the SAME source; the subject is the
 *  draft save. See [[DraftRaceFixture.race3]] for the interleaving the round-3 skeptic found. */
class DraftSaveSetRaceSpec extends DraftRaceFixture {

  private val owner = AuthenticatedUser(UserId(userA))
  private def thirdSource(s: DraftSaveSeed): Unit =
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${s.id("ds3")}','ds3','dataset','{}',now(),now(),'$userA','[]') ON CONFLICT (id) DO NOTHING")

  private val rootAdd = RaceWriter("root add", Set(LockSite.RootAdd),
    (h, s) => h.rootRepo.add(PipelineId(s.pipeline), DataSourceId(s.id("ds3")), owner), thirdSource)

  private val sourceDelete = RaceWriter("source delete", Set(LockSite.SourceDelete, LockSite.SourceDeleteSourceRow),
    (h, s) => h.dataSourceRepo.delete(DataSourceId(s.id("ds3")), owner), didWrite = _.toOption.contains(true))

  private def teardownTag(s: DraftSaveSeed): String = s.id("tag")

  private val teardown = RaceWriter("workspace teardown", Set(LockSite.TeardownSourcesFirst, LockSite.TeardownPipelines),
    (h, s) => h.teardownRepo.teardown(teardownTag(s), dryRun = false, owner),
    s => { thirdSource(s); exec(s"UPDATE data_sources SET tag='${teardownTag(s)}' WHERE id='${s.id("ds3")}'") },
    didWrite = _.toOption.exists { case o: TeardownOutcome => o.committed; case _ => true })

  "a source delete racing a root add on the same source and a draft save" should {
    "never commit inside the save's window, and never deadlock" in {
      val o = race3(sourceDelete, rootAdd)
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.violation shouldBe false
        o.blockedObserved shouldBe true
      }
    }

    "be a violation when the source delete does not lock the source row first (the set-membership race)" in {
      val o = race3(sourceDelete, rootAdd, removed = Set(LockSite.SourceDeleteSourceRow))
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.violation shouldBe true
      }
    }

    "be a violation when the source delete takes no pipeline lock at all" in {
      val o = race3(sourceDelete, rootAdd, removed = Set(LockSite.SourceDelete, LockSite.SourceDeleteSourceRow))
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.violation shouldBe true
      }
    }
  }

  "a workspace teardown racing a root add on a tagged source and a draft save" should {
    "refuse to delete once the root exists (it re-checks after locking the source) and never commit inside the save's window" in {
      val o = race3(teardown, rootAdd)
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.violation shouldBe false
        o.writerResult.get.asInstanceOf[TeardownOutcome].blocked shouldBe true
      }
    }

    "be a violation when the teardown locks no source row first (it deletes the new root away)" in {
      val o = race3(teardown, rootAdd, removed = Set(LockSite.TeardownSourcesFirst, LockSite.TeardownPipelines))
      withClue(o.toString) {
        o.deadlock shouldBe false
        o.violation shouldBe true
      }
    }
  }
}
