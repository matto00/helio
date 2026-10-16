package com.helio.infrastructure.persistence.home

import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.{HomeSummarySeeding, TwoUserRlsApiFixture}
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1578 D3: owner scoping of the Home summary, proven two independent ways.
 *  (a) RLS on `pipeline_runs` / `pipeline_schedules`: raw selects with NO owner predicate, on a session that
 *      provably cannot bypass RLS, return none of A's rows for B; the privileged pool returns them (positive control).
 *  (b) The explicit `owner_id` filter: on a connection that DOES bypass RLS (the dev/CI superuser) the summary for B
 *      still excludes A's pipelines. */
class HomeSummaryScopingSpec extends TwoUserRlsApiFixture with HomeSummarySeeding {

  private def seedA(): Unit = {
    resetPipelines()
    val now = Instant.now()
    val p   = seedPipelineFor(userA, "a-pipe")
    seedRun(p, "failed", now.minusSeconds(3600), errorLog = Some("a"))
    seedRun(p, "running", now.minusSeconds(60))
    seedSchedule(p, "interval", "1h", Some(now.plusSeconds(600)))
  }

  private def count(table: String, ctxRun: DBIO[Vector[Int]] => Future[Vector[Int]]): Int =
    await(ctxRun(sql"SELECT count(*)::int FROM #$table".as[Int])).head

  "RLS on the summary's tables (no owner predicate in the query)" should {

    "run on a session that cannot bypass RLS" in {
      val flags = await(ctx.withUserContext(userB)(
        sql"SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user".as[(Boolean, Boolean)]
      ))
      flags shouldBe Vector((false, false))
    }

    "hide A's runs and schedules from B, show A their own, and show a privileged read all of them" in {
      seedA()
      count("pipeline_runs", a => ctx.withUserContext(userB)(a)) shouldBe 0
      count("pipeline_schedules", a => ctx.withUserContext(userB)(a)) shouldBe 0
      count("pipeline_runs", a => ctx.withUserContext(userA)(a)) shouldBe 2
      count("pipeline_schedules", a => ctx.withUserContext(userA)(a)) shouldBe 1
      // Positive control: the rows exist, so B's zero is RLS filtering, not data absence.
      count("pipeline_runs", a => ctx.withSystemContext(a)) shouldBe 2
      count("pipeline_schedules", a => ctx.withSystemContext(a)) shouldBe 1
    }
  }

  "the explicit owner filter" should {

    "exclude A's pipelines for B on a connection that bypasses RLS" in {
      seedA()
      val bypassing = new DbContext(superDb, superDb)(ExecutionContext.global)
      val repo      = new HomeSummaryRepository(bypassing)(ExecutionContext.global)
      val since     = Instant.now().minusSeconds(24 * 3600)
      // Control: this connection really does see everything (so the assertion below is the owner filter's doing).
      await(bypassing.withUserContext(userB)(sql"SELECT count(*)::int FROM pipeline_runs".as[Int])).head shouldBe 2
      val forB = await(repo.load(AuthenticatedUser(UserId(userB)), since))
      forB.runs shouldBe empty
      forB.schedules shouldBe empty
      val forA = await(repo.load(AuthenticatedUser(UserId(userA)), since))
      forA.runs should have size 2
      forA.schedules should have size 1
    }
  }
}
