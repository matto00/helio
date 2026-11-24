package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.PipelineId
import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.TwoUserRlsApiFixture
import org.scalatest.BeforeAndAfterEach
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1833: `findActiveRunInternal` picks the newest open run, `(started_at DESC, id DESC)`, when several are open
 *  (overlapping manual submits are allowed). Every case seeds BOTH insertion orders and repeats the call, so an
 *  un-ordered query (which returns heap order) is wrong in at least one of them. */
class PipelineRunActiveLookupSpec extends TwoUserRlsApiFixture with BeforeAndAfterEach {

  override protected def beforeEach(): Unit = {
    super.beforeEach()
    await(privilegedDb.run(sqlu"TRUNCATE pipelines CASCADE"))
    ()
  }

  private val ec0: ExecutionContext = ExecutionContext.global
  private lazy val repo: PipelineRunRepository = new PipelineRunRepository(ctx)(ec0)

  override protected def pipelineRunRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): PipelineRunRepository =
    new PipelineRunRepository(ctx)

  private val Lo   = "00000000-0000-4000-8000-000000000001"
  private val Mid  = "7777aaaa-0000-4000-8000-000000000002"
  private val Hi   = "ffffffff-ffff-4fff-8fff-ffffffffffff"
  private val T0   = Instant.parse("2026-01-01T00:00:00.123456Z")

  private def ts(i: Instant) = Timestamp.from(i)
  private def exec(a: DBIO[_]*): Unit = await(privilegedDb.run(DBIO.seq(a: _*)))

  private def pipeline(): String = {
    val id = UUID.randomUUID().toString
    exec(sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($id, 'p', $userA::uuid, now(), now())")
    id
  }

  private def run(pid: String, id: String, at: Instant, status: String = "running", done: Boolean = false): Unit = {
    val completed = if (done) Some(ts(at.plusSeconds(1))) else None
    exec(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, trigger_source)
               VALUES ($id, $pid, $status, ${ts(at)}, $completed, 'manual')""")
  }

  private def active(pid: String): Option[String] =
    await(repo.findActiveRunInternal(PipelineId(pid))).map(_.id)

  private def repeated(pid: String): Set[Option[String]] = (1 to 5).map(_ => active(pid)).toSet

  private val orders = Seq("newer inserted last" -> false, "newer inserted first" -> true)

  "findActiveRunInternal" should {
    orders.foreach { case (label, newerFirst) =>
      s"return the later started_at of two open runs ($label)" in {
        val pid   = pipeline()
        val older = Lo; val newer = Mid
        val seq   = Seq(older -> T0, newer -> T0.plusSeconds(5))
        (if (newerFirst) seq.reverse else seq).foreach { case (id, at) => run(pid, id, at) }
        repeated(pid) shouldBe Set(Some(newer))
      }
      s"return the later started_at even when its id is the smaller ($label)" in {
        val pid = pipeline()
        val seq = Seq(Hi -> T0, Lo -> T0.plusSeconds(5))
        (if (newerFirst) seq.reverse else seq).foreach { case (id, at) => run(pid, id, at) }
        repeated(pid) shouldBe Set(Some(Lo))
      }
      s"return the greatest id of tied started_at open runs ($label)" in {
        val pid = pipeline()
        val ids = Seq(Lo, Mid, Hi)
        (if (newerFirst) ids.reverse else ids).foreach(run(pid, _, T0))
        repeated(pid) shouldBe Set(Some(Hi))
      }
      s"ignore completed runs, dry runs and other pipelines' open runs ($label)" in {
        val pid   = pipeline()
        val other = pipeline()
        val open  = Seq(Lo -> T0, Mid -> T0.plusSeconds(1), "aaaaaaaa-open-3" -> T0.plusSeconds(2))
        val noise = () => {
          run(pid, "zz-completed-newer", T0.plusSeconds(60), "succeeded", done = true)
          run(pid, "zz-dry-newer", T0.plusSeconds(61), "dry_run", done = true)
          run(other, "zz-other-open", T0.plusSeconds(62))
        }
        if (newerFirst) { noise(); open.reverse.foreach { case (id, at) => run(pid, id, at) } }
        else { open.foreach { case (id, at) => run(pid, id, at) }; noise() }
        repeated(pid) shouldBe Set(Some("aaaaaaaa-open-3"))
      }
    }
    "return None when no run is open" in {
      val pid = pipeline()
      run(pid, Lo, T0, "succeeded", done = true)
      active(pid) shouldBe None
    }
  }
}
