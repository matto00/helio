package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{AssertionResult, AuthenticatedUser, PipelineId, PipelineRunId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.home.HomeSummaryRepository
import com.helio.services.pipelines.PipelineRunService
import com.helio.testsupport.TwoUserRlsApiFixture
import org.scalatest.BeforeAndAfterEach
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1626: every read that picks a latest run, or orders runs or assertion results, has a total order when the
 *  sort keys tie. Run ids are random UUIDs, so the `id` tie-break makes the order DETERMINISTIC, not "more recent".
 *
 *  Every test forces the tie explicitly (a fixed `started_at` / `created_at`, hand-picked ids) and, for the runs
 *  reads, seeds BOTH insertion orders, so an un-tie-broken query (which returns heap/index insertion order) is wrong
 *  in at least one of them. RLS-context reads run on the non-BYPASSRLS `helio_app_test` pool of the fixture. */
class PipelineRunOrderTiebreakSpec extends TwoUserRlsApiFixture with BeforeAndAfterEach {

  // The run ids below are fixed (the tie-break is what is under test), so each test starts from no runs.
  override protected def beforeEach(): Unit = {
    super.beforeEach()
    await(privilegedDb.run(sqlu"TRUNCATE pipelines CASCADE"))
    ()
  }

  private val ec0: ExecutionContext = ExecutionContext.global

  private lazy val repo: PipelineRunRepository = new PipelineRunRepository(ctx)(ec0)

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository =
    new PipelineRunRepository(ctx)

  private val Lo  = "00000000-0000-4000-8000-000000000001"
  private val Mid = "7777aaaa-0000-4000-8000-000000000002"
  private val Hi  = "ffffffff-ffff-4fff-8fff-ffffffffffff"
  private val Tie = Instant.parse("2026-01-01T00:00:00.123456Z")
  private val owner = AuthenticatedUser(UserId(userA))

  private def ts(i: Instant) = Timestamp.from(i)
  private def exec(a: DBIO[_]*): Unit = await(privilegedDb.run(DBIO.seq(a: _*)))

  private def pipeline(user: String = userA): String = {
    val id = UUID.randomUUID().toString
    exec(sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, 'p', $user::uuid, now(), now())")
    id
  }

  private def run(pid: String, id: String, at: Instant, status: String = "succeeded"): Unit = {
    val done = if (status == "running" || status == "queued") None else Some(ts(at.plusSeconds(1)))
    exec(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
               VALUES ($id, $pid, $status, ${ts(at)}, $done, 'manual')""")
  }

  private val bothOrders = Seq("greater id first" -> Seq(Hi, Mid, Lo), "greater id last" -> Seq(Lo, Mid, Hi))

  private def tiedPipeline(order: Seq[String]): String = {
    val pid = pipeline()
    order.foreach(run(pid, _, Tie))
    pid
  }

  "runs reads with equal started_at" should {
    bothOrders.foreach { case (label, order) =>
      s"list newest-first by (started_at, id) descending, $label inserted first -- listByPipeline (RLS pool)" in {
        val pid   = tiedPipeline(order)
        val newer = "00000000-0000-4000-8000-000000000000"
        run(pid, newer, Tie.plusSeconds(5))
        await(repo.listByPipeline(PipelineId(pid), owner)).map(_.id) shouldBe Vector(newer, Hi, Mid, Lo)
      }
      s"list the same -- listByPipelineInternal, $label inserted first" in {
        val pid   = tiedPipeline(order)
        val newer = "00000000-0000-4000-8000-000000000000"
        run(pid, newer, Tie.plusSeconds(5))
        await(repo.listByPipelineInternal(PipelineId(pid))).map(_.id) shouldBe Vector(newer, Hi, Mid, Lo)
      }
      s"pick the greatest id -- latestRunInternal, $label inserted first" in {
        await(repo.latestRunInternal(PipelineId(tiedPipeline(order)))).map(_.id) shouldBe Some(Hi)
      }
      s"pick the greatest non-dry id -- latestNonDryRunInternal, $label inserted first" in {
        val pid = pipeline()
        (order :+ "zzzzzzzz-dry").foreach(id => run(pid, id, Tie, if (id == "zzzzzzzz-dry") "dry_run" else "succeeded"))
        await(repo.latestNonDryRunInternal(PipelineId(pid))).map(_.id) shouldBe Some(Hi)
      }
      s"pick the greatest id per pipeline -- latestRunIdsInternalBatch, $label inserted first" in {
        val p1 = tiedPipeline(order)
        val p2 = pipeline()
        order.reverse.foreach(i => run(p2, "b-" + i, Tie))
        await(repo.latestRunIdsInternalBatch(Set(PipelineId(p1), PipelineId(p2)))) shouldBe
          Map(PipelineId(p1) -> Hi, PipelineId(p2) -> ("b-" + Hi))
      }
      s"list newest-first -- HomeSummaryRepository.load (RLS pool), $label inserted first" in {
        val pid  = pipeline()
        val base = Instant.now().minusSeconds(3600)
        order.foreach(run(pid, _, base))
        val rows = await(new HomeSummaryRepository(ctx)(ec0).load(owner, base.minusSeconds(60))).runs.filter(_.pipelineId == pid)
        rows.map(_.runId) shouldBe Vector(Hi, Mid, Lo)
      }
    }
  }

  "retention with tied started_at" should {
    bothOrders.foreach { case (label, order) =>
      s"keep the greatest id of a tie older than the 24 h window (newestN), $label inserted first" in {
        val pid = pipeline()
        val old = Instant.now().minusSeconds(3 * 86400)
        order.foreach(run(pid, _, old)) // one shared started_at, outside the window: the tie alone decides the survivor
        await(repo.deleteOldRunsInternal(PipelineId(pid), keepN = 1))
        await(repo.listByPipelineInternal(PipelineId(pid))).map(_.id) shouldBe Vector(Hi)
      }
      s"keep the greatest id of a tie at the RetentionMaxRuns cap, $label inserted first" in {
        val pid  = pipeline()
        val tied = Instant.now().minusSeconds(20 * 3600)
        // 299 distinct newer runs + a tied pair = 301 in-window runs; the cap (300) must drop exactly one of the pair.
        exec(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
                   SELECT 'n-' || $pid || '-' || g, $pid, 'succeeded', now() - (g || ' seconds')::interval, now(), 'manual'
                   FROM generate_series(1, 299) g""")
        order.take(2).foreach(run(pid, _, tied))
        await(repo.deleteOldRunsInternal(PipelineId(pid)))
        val ids = await(repo.listByPipelineInternal(PipelineId(pid))).map(_.id)
        ids should have size PipelineRunRepository.RetentionMaxRuns
        ids should contain (order.take(2).max)
        ids should not contain order.take(2).min
      }
      s"keep the greatest id of tied dry runs, $label inserted first" in {
        val pid = pipeline()
        order.foreach(run(pid, _, Tie, "dry_run"))
        await(repo.deleteOldDryRunsInternal(PipelineId(pid), keepN = 1))
        await(repo.listByPipelineInternal(PipelineId(pid))).map(_.id) shouldBe Vector(Hi)
      }
    }
  }

  "the stale-run reaper with a tied started_at" should {
    def lastRunStatusAfterReap(otherId: String, reapedId: String): Option[String] = {
      val pid = pipeline()
      exec(sqlu"UPDATE pipelines SET last_run_status = 'succeeded', last_run_at = ${ts(Tie)} WHERE id = $pid")
      run(pid, otherId, Tie)
      exec(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, heartbeat_at, trigger_source)
                 VALUES ($reapedId, $pid, 'running', ${ts(Tie)}, ${ts(Tie)}, 'manual')""")
      val reaped = await(repo.reapStaleRunsInternal(Instant.now(), 600L, 3600L, PipelineRunService.EmptyTruncationJson))
      reaped.map(_.runId.value) should contain (reapedId)
      await(privilegedDb.run(sql"SELECT last_run_status FROM pipelines WHERE id = $pid".as[Option[String]])).head
    }
    "leave last_run_* alone when a tied run with a greater id exists (that run is the latest)" in {
      lastRunStatusAfterReap(otherId = Hi, reapedId = Lo) shouldBe Some("succeeded")
    }
    "mark last_run_* failed when the reaped run has the greater id of the tie" in {
      lastRunStatusAfterReap(otherId = Lo, reapedId = Hi) shouldBe Some("failed")
    }
  }

  private def assertionRow(id: String, runId: String, createdAt: Instant, msg: String): DBIO[Int] =
    sqlu"""INSERT INTO pipeline_run_assertions (id, run_id, step_id, kind, field, severity, passed, message, created_at)
           VALUES ($id, $runId, 's', 'k', 'f', 'error', false, $msg, ${ts(createdAt)})"""

  private def runWithAssertions(rows: Seq[(String, Instant)]): String = {
    val pid = pipeline(); val rid = UUID.randomUUID().toString
    run(pid, rid, Tie)
    rows.foreach { case (id, at) => exec(assertionRow(id, rid, at, id)) }
    rid
  }

  "assertion reads" should {
    "order same-created_at rows by id regardless of insert order" in {
      val rid = runWithAssertions(Seq("z-3" -> Tie, "a-1" -> Tie, "m-2" -> Tie))
      val expected = Vector("a-1", "m-2", "z-3")
      await(repo.listAssertionsByRunInternal(PipelineRunId(rid))).map(_.id) shouldBe expected
      await(repo.listAssertionsByRun(PipelineRunId(rid), owner)).map(_.id) shouldBe expected
      await(repo.listAssertionsByRunsInternalBatch(Set(rid)))(rid).map(_.id) shouldBe expected
    }
    "order by created_at before id" in {
      val rid = runWithAssertions(Seq("a-late" -> Tie.plusSeconds(10), "z-early" -> Tie, "m-mid" -> Tie.plusSeconds(5)))
      val expected = Vector("z-early", "m-mid", "a-late")
      await(repo.listAssertionsByRunInternal(PipelineRunId(rid))).map(_.id) shouldBe expected
      await(repo.listAssertionsByRun(PipelineRunId(rid), owner)).map(_.id) shouldBe expected
      await(repo.listAssertionsByRunsInternalBatch(Set(rid)))(rid).map(_.id) shouldBe expected
    }
    "return rows inserted by insertAssertions in evaluation order (12 rows), with batch-prefixed 5-digit-index ids" in {
      val pid = pipeline(); val rid = UUID.randomUUID().toString
      run(pid, rid, Tie)
      val results = (0 until 12).map(i => AssertionResult("s", "k", Some("f"), "error", false, None, Some(f"m$i%02d")))
      await(repo.insertAssertions(PipelineRunId(rid), results))
      val rows = await(repo.listAssertionsByRunInternal(PipelineRunId(rid)))
      rows.map(_.message.get) shouldBe results.map(_.message.get).toVector
      await(repo.listAssertionsByRunsInternalBatch(Set(rid)))(rid).map(_.message.get) shouldBe results.map(_.message.get).toVector
      await(repo.listAssertionsByRun(PipelineRunId(rid), owner)).map(_.message.get) shouldBe results.map(_.message.get).toVector
      val Pattern = """([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{5})""".r
      rows.map(_.id).foreach(_ should fullyMatch regex Pattern)
      val parsed  = rows.map(_.id).map { case Pattern(prefix, idx) => (prefix, idx.toInt) }
      parsed.map(_._1).distinct should have size 1
      parsed.map(_._2) shouldBe (0 until 12).toVector
    }
  }

  "the run-history, runs/latest and context-details routes" should {
    bothOrders.foreach { case (label, order) =>
      s"agree on the latest run when runs share a started_at, $label inserted first" in {
        val pid = pipeline()
        val src = UUID.randomUUID().toString
        exec(
          sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($src::uuid, 's', 'csv', '{"path":"x.csv"}'::jsonb, $userA::uuid, now(), now())""",
          sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $src::uuid, 0)"
        )
        order.foreach { id =>
          run(pid, id, Tie)
          exec(assertionRow(UUID.randomUUID().toString, id, Tie, "from-" + id))
        }
        def get(path: String): JsValue = req(HttpMethods.GET, path, userA) ~> routes ~> check {
          status shouldBe StatusCodes.OK; responseAs[String].parseJson
        }
        val history = get(s"/api/pipelines/$pid/run-history").convertTo[Vector[JsObject]]
        history.map(_.fields("id").convertTo[String]) shouldBe Vector(Hi, Mid, Lo)
        get(s"/api/pipelines/$pid/runs/latest").asJsObject.fields("id") shouldBe JsString(Hi)
        val item = get("/api/pipelines/context-details").asJsObject.fields("items").convertTo[Vector[JsObject]]
          .find(_.fields("pipelineId") == JsString(pid)).get
        item.fields("latestRunAssertions") shouldBe history.head.fields("assertions")
        item.fields("latestRunAssertions").toString should include ("from-" + Hi)
      }
    }
  }

  "the RLS pool" should {
    "be a role that cannot bypass RLS" in {
      await(ctx.withUserContext(userA)(
        sql"SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user".as[(Boolean, Boolean)]
      )) shouldBe Vector((false, false))
    }
  }
}
