package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule, UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunGuardRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.spark.PipelineRunCache
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.DatasetRowsTestSupport
import com.typesafe.config.ConfigFactory
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.sql.DriverManager
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.util.{Failure, Success}

/** HEL-1492: an editor grantee's run is recorded exactly like the owner's (run row, assertions, `last_run_*`,
 *  retention), counted against the pipeline OWNER's concurrency budget, and attributed to the triggering user.
 *
 *  Runs as a non-superuser NOBYPASSRLS app role (shape copied from `V100ZeroRootGuardNonSuperuserSpec`) so RLS
 *  applies exactly as in production; a superuser pool would make the owner-only write filters look like the only
 *  barrier. Seeding and measuring use the privileged pool. */
class PipelineRunEditorPersistenceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var pg: EmbeddedPostgres                  = _
  private var url: String                           = _
  private var appDb: JdbcBackend.Database           = _
  private var privDb: JdbcBackend.Database          = _
  private var ctx: DbContext                        = _
  private var pipelineRepo: PipelineRepository      = _
  private var stepRepo: PipelineStepRepository      = _
  private var runRepo: PipelineRunRepository        = _
  private var guardRepo: PipelineRunGuardRepository = _
  private var dsRepo: DataSourceRepository          = _
  private var snapRepo: NodeSnapshotRepository      = _
  private var outRepo: OutputRepository             = _

  private val owner = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    val sc = pg.getPostgresDatabase.getConnection
    try {
      val st = sc.createStatement()
      st.execute("CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
      st.execute("ALTER SCHEMA public OWNER TO helio_migration_test")
      st.execute("GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
      st.execute("CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
      st.execute("GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
      st.close()
    } finally sc.close()
    url = pg.getJdbcUrl("helio_migration_test", "postgres")
    Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration").load().migrate()
    val full = s"$url${if (url.contains('?')) "&" else "?"}stringtype=unspecified"
    appDb = JdbcBackend.Database.forURL(full, user = "helio_migration_test", password = "test", driver = "org.postgresql.Driver")
    privDb = JdbcBackend.Database.forConfig("privileged", ConfigFactory.parseString(
      s"""privileged { url = "$full", user = "helio_migration_test", password = "test",
         |  driver = "org.postgresql.Driver", connectionInitSql = "SET ROLE helio_privileged",
         |  numThreads = 4, connectionPool = "HikariCP" }""".stripMargin))
    ctx          = new DbContext(appDb, privDb)
    dsRepo       = new DataSourceRepository(ctx)
    stepRepo     = new PipelineStepRepository(ctx)
    pipelineRepo = new PipelineRepository(ctx, dsRepo)
    runRepo      = new PipelineRunRepository(ctx)
    guardRepo    = new PipelineRunGuardRepository(ctx)
    snapRepo     = new NodeSnapshotRepository(ctx)
    outRepo      = new OutputRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close(); privDb.close(); pg.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)
  private def priv[T](a: slick.dbio.DBIO[T]): T = await(privDb.run(a))

  /** Counts executions, optionally fails or gates the run, and can append a failing `error` assertion so the real
   *  engine's result is turned into a blocked run. Everything else delegates to the real in-process engine. */
  private final class ScriptedBackend(
      failWith: Option[Throwable] = None,
      gate: Option[Future[Unit]] = None,
      entered: Option[Promise[Unit]] = None
  ) extends PipelineExecutionBackend {
    val executions = new AtomicInteger(0)
    private val fs   = new LocalFileSystem(Paths.get("/"))
    private val real = new InProcessExecutionBackend(new InProcessPipelineEngine(fs), stepRepo)
    override def supportsWriteBack: Boolean = real.supportsWriteBack
    override def execute(
        pipeline: Pipeline,
        roots: Vector[(String, DataSource)],
        steps: Vector[PipelineStep],
        dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink,
        truncationSink: TruncationSink,
        onNodeProgress: (NodeKey, Long) => Unit,
        writeBackSink: WriteBackSink,
        ownerUserId: Option[String]
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      executions.incrementAndGet()
      entered.foreach(_.trySuccess(()))
      val waited = gate.getOrElse(Future.unit)
      waited.flatMap { _ =>
        failWith match {
          case Some(ex) => Future.failed(ex)
          case None     => real.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink, ownerUserId)
        }
      }
    }
  }

  private def service(cfg: PipelineRunGuardConfig, backend: PipelineExecutionBackend = null): PipelineRunService =
    new PipelineRunService(
      pipelineRepo, stepRepo, dsRepo, runRepo, new PipelineRunCache(), registry = null,
      new LocalFileSystem(Paths.get("/")),
      outputRepo = outRepo, nodeSnapshotRepo = snapRepo,
      pipelineRunGuardRepo = guardRepo,
      executionBackend = backend,
      guardConfig = cfg
    )

  private val roomy = PipelineRunGuardConfig(1000, 3600, 1000, 15, 1000)
  private val passRule  = AssertRule("notNull", Some("name"), JsObject.empty, "error")
  private val blockRule = AssertRule("rowCountMax", None, JsObject("count" -> JsNumber(1)), "error")

  private val DefaultOwnerId = "00000000-0000-0000-0000-000000000001"

  private def seedPipeline(rule: AssertRule = passRule, writeBackColumns: Option[String] = None, ownerId: String = DefaultOwnerId): (PipelineId, Option[String]) = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    val cfg  = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    priv(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, cfg),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    ))
    val p = PipelineId(pid)
    val parent0 = stepRepo.trunkOf(await(stepRepo.listByPipelineInternal(p))).lastOption.map(_.id)
    val assertStep = await(stepRepo.insertInternal(p, "assert", AssertConfig(Vector(rule)), true, parent0, explicitRootId = None))
    val targetId = writeBackColumns.map { columns =>
      val tid = UUID.randomUUID().toString
      priv(DBIO.seq(
        sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($tid, 'ds-target', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
        DatasetRowsTestSupport.seedActionsFromRaw(tid, columns)
      ))
      await(stepRepo.insertInternal(p, "upsertsource", UpsertSourceConfig(UpsertTarget.ExistingSource(tid), UpsertMode.Append),
        enabled = true, Some(assertStep.id), explicitRootId = None, actingUserId = owner.id.value))
      tid
    }
    (p, targetId)
  }

  private def seedPipelineId(rule: AssertRule = passRule): PipelineId = seedPipeline(rule)._1

  private def seedPipelineOwnedBy(ownerId: String): PipelineId = seedPipeline(ownerId = ownerId)._1

  /** A pipeline of a brand-new owner: the HEL-505 cap counts across every pipeline an owner has, so cap cases must not
   *  share the default owner (rows left `queued` by one case would fill the next one's budget). */
  private def freshOwnerPipelines(n: Int): (AuthenticatedUser, Vector[PipelineId]) = {
    val ownerId = seedUser()
    (AuthenticatedUser(UserId(ownerId)), Vector.fill(n)(seedPipelineOwnedBy(ownerId)))
  }

  private def seedUser(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    priv(sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                VALUES ($id::uuid, ${"u-" + id + "@test"}, 'U', now(), now())""")
    id
  }

  private def grant(p: PipelineId, role: String): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = seedUser()
    priv(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                VALUES ('pipeline', ${p.value}, $id::uuid, $role, now())""")
    AuthenticatedUser(UserId(id))
  }

  private def seedEditor(p: PipelineId): AuthenticatedUser = grant(p, "editor")

  private final case class RunRow(status: String, rowCount: Option[Int], errorLog: Option[String])
  private final case class LastRun(status: Option[String], at: Option[String], rowCount: Option[Long], truncated: Option[Boolean])

  private def runs(p: PipelineId): Vector[RunRow] = {
    import PostgresProfile.api._
    priv(sql"SELECT status, row_count, error_log FROM pipeline_runs WHERE pipeline_id = ${p.value} ORDER BY started_at".as[(String, Option[Int], Option[String])])
      .map(r => RunRow(r._1, r._2, r._3)).toVector
  }
  private def assertionRows(p: PipelineId): Int = {
    import PostgresProfile.api._
    priv(sql"SELECT COUNT(*) FROM pipeline_run_assertions a JOIN pipeline_runs r ON r.id = a.run_id WHERE r.pipeline_id = ${p.value}".as[Int].head)
  }
  private def lastRun(p: PipelineId): LastRun = {
    import PostgresProfile.api._
    val r = priv(sql"SELECT last_run_status, last_run_at::text, last_run_row_count, last_run_truncated FROM pipelines WHERE id = ${p.value}".as[(Option[String], Option[String], Option[Long], Option[Boolean])].head)
    LastRun(r._1, r._2, r._3, r._4)
  }
  private def isTooMany(r: Either[ServiceError, _]): Boolean = r.left.toOption.exists(_.isInstanceOf[ServiceError.TooManyRequests])

  "an editor grantee's REAL run" should {

    "write a succeeded run row with row_count and assertion rows, and update last_run_*" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val r = await(service(roomy).submit(p, isDry = false, ed))
      r.isRight shouldBe true
      runs(p) shouldBe Vector(RunRow("succeeded", Some(2), None))
      assertionRows(p) shouldBe 1
      val lr = lastRun(p)
      lr.status shouldBe Some("succeeded")
      lr.at should not be None
      lr.rowCount shouldBe Some(2L)
      lr.truncated shouldBe Some(false)
    }

    "write a failed run row and failed last_run_* when execution fails" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val r = await(service(roomy, new ScriptedBackend(failWith = Some(new RuntimeException("boom")))).submit(p, isDry = false, ed))
      r.isLeft shouldBe true
      val rs = runs(p)
      rs.map(_.status) shouldBe Vector("failed")
      rs.head.errorLog should not be None
      lastRun(p).status shouldBe Some("failed")
    }

    "write a failed run row with the blocked summary, its assertion rows and failed last_run_* when an error assertion blocks it" in {
      val p = seedPipelineId(blockRule); val ed = seedEditor(p)
      val r = await(service(roomy).submit(p, isDry = false, ed))
      r.toOption.get.blocked shouldBe true
      val rs = runs(p)
      rs.map(_.status) shouldBe Vector("failed")
      rs.head.errorLog.getOrElse("") should startWith("Run blocked")
      assertionRows(p) shouldBe 1
      lastRun(p).status shouldBe Some("failed")
    }

    "reach terminal failed in pipeline_runs and last_run_* when the write-back returns Left" in {
      // Target declares no columns, so the source's `name` column is undeclared: the write-back yields a Left.
      val (p, _) = seedPipeline(writeBackColumns = Some("""{"columns":[],"rows":[]}"""))
      val ed = seedEditor(p)
      val r = await(service(roomy).submit(p, isDry = false, ed))
      r.isLeft shouldBe true
      val rs = runs(p)
      rs.map(_.status) shouldBe Vector("failed")
      rs.head.errorLog.getOrElse("") should include("upsertsource")
      assertionRows(p) shouldBe 1
      lastRun(p).status shouldBe Some("failed")
    }

    "reach terminal failed in pipeline_runs and last_run_* when the write-back throws" in {
      import PostgresProfile.api._
      val (p, target) = seedPipeline(writeBackColumns = Some("""{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[]}"""))
      val tid = target.get
      val trg = s"hel1492_fail_rows_${tid.replace("-", "")}"
      val fn  = s"CREATE OR REPLACE FUNCTION $trg() RETURNS trigger AS $$f$$ BEGIN IF NEW.data_source_id = '$tid' THEN RAISE EXCEPTION 'hel1492 test: row write refused'; END IF; RETURN NEW; END $$f$$ LANGUAGE plpgsql"
      await(appDb.run(sqlu"#$fn"))
      await(appDb.run(sqlu"#${s"CREATE TRIGGER $trg BEFORE INSERT ON dataset_rows FOR EACH ROW EXECUTE FUNCTION $trg()"}"))
      try {
        val ed = seedEditor(p)
        val r  = Await.ready(service(roomy).submit(p, isDry = false, ed), 30.seconds)
        r.value.get match {
          case Failure(_) => succeed
          case Success(v) => fail(s"submit should fail with the write-back exception, got $v")
        }
        runs(p).map(_.status) shouldBe Vector("failed")
        assertionRows(p) shouldBe 1
        lastRun(p).status shouldBe Some("failed")
      } finally {
        await(appDb.run(sqlu"#${s"DROP TRIGGER IF EXISTS $trg ON dataset_rows"}"))
        await(appDb.run(sqlu"#${s"DROP FUNCTION IF EXISTS $trg()"}"))
      }
    }

    "prune runs older than 24h to the newest 10 after an editor run, and keep the editor's own (retention applies to editors)" in {
      import PostgresProfile.api._
      val p = seedPipelineId(); val ed = seedEditor(p)
      // HEL-1578 (keep-24h): runs inside the last 24h are spared, so the pruning is proven on 12 runs from 3 days ago.
      (1 to 12).foreach { i =>
        priv(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count)
                    VALUES (${UUID.randomUUID().toString}, ${p.value}, 'succeeded', now() - interval '3 days' + ${i} * interval '1 minute',
                            now() - interval '3 days' + ${i} * interval '1 minute', 1)""")
      }
      await(service(roomy).submit(p, isDry = false, ed)).isRight shouldBe true
      runs(p).map(_.status) shouldBe Vector.fill(10)("succeeded")
    }

    "keep every editor run inside the last 24h (keep-24h)" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val svc = service(roomy)
      (1 to 11).foreach(_ => await(svc.submit(p, isDry = false, ed)).isRight shouldBe true)
      runs(p).map(_.status) shouldBe Vector.fill(11)("succeeded")
    }
  }

  "an editor grantee's DRY run" should {

    "write a dry_run row and its assertion rows and leave last_run_* untouched" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      await(service(roomy).submit(p, isDry = true, ed)).isRight shouldBe true
      runs(p) shouldBe Vector(RunRow("dry_run", Some(2), None))
      assertionRows(p) shouldBe 1
      lastRun(p) shouldBe LastRun(None, None, None, None)
    }

    "keep exactly 10 dry_run rows after 11 editor dry runs" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val svc = service(roomy)
      (1 to 11).foreach(_ => await(svc.submit(p, isDry = true, ed)).isRight shouldBe true)
      runs(p).map(_.status) shouldBe Vector.fill(10)("dry_run")
    }

    "not be counted against the concurrency cap" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val svc = service(PipelineRunGuardConfig(1000, 3600, 1, 15, 1000))
      await(svc.submit(p, isDry = true, ed)).isRight shouldBe true
      await(svc.submit(p, isDry = true, ed)).isRight shouldBe true
    }
  }

  "the HEL-505 concurrency cap" should {

    "reject an editor's real submit 429 without executing when the pipeline OWNER is at the cap" in {
      import PostgresProfile.api._
      val (_, pipelines) = freshOwnerPipelines(2)
      val Vector(p, other) = pipelines // same owner, two pipelines
      val ed = seedEditor(p)
      priv(sqlu"""INSERT INTO pipeline_runs (id, pipeline_id, status, started_at)
                  VALUES (${UUID.randomUUID().toString}, ${other.value}, 'queued', now())""")
      val backend = new ScriptedBackend()
      val r = await(service(PipelineRunGuardConfig(1000, 3600, 1, 15, 1000), backend).submit(p, isDry = false, ed))
      isTooMany(r) shouldBe true
      r.left.toOption.get.asInstanceOf[ServiceError.TooManyRequests].retryAfterSeconds shouldBe 15L
      backend.executions.get shouldBe 0
      runs(p) shouldBe empty
    }

    "occupy one of the OWNER's slots while an editor run is in flight (owner's next submit is 429 at cap 1)" in {
      val (cappedOwner, pipelines) = freshOwnerPipelines(2)
      val Vector(p, other) = pipelines
      val ed = seedEditor(p)
      val gate    = Promise[Unit]()
      val entered = Promise[Unit]()
      val cfg     = PipelineRunGuardConfig(1000, 3600, 1, 15, 1000)
      val editorRun = service(cfg, new ScriptedBackend(gate = Some(gate.future), entered = Some(entered))).submit(p, isDry = false, ed)
      await(entered.future)
      val ownerBackend = new ScriptedBackend()
      val ownerSubmit  = await(service(cfg, ownerBackend).submit(other, isDry = false, cappedOwner))
      gate.success(())
      await(editorRun).isRight shouldBe true
      isTooMany(ownerSubmit) shouldBe true
      ownerBackend.executions.get shouldBe 0
      runs(p).map(_.status) shouldBe Vector("succeeded")
    }
  }

  "viewer and non-grantee submits" should {
    "write nothing (viewer 403, non-grantee 404)" in {
      val p = seedPipelineId()
      val viewer = grant(p, "viewer")
      val stranger = AuthenticatedUser(UserId(seedUser()))
      val svc = service(roomy)
      await(svc.submit(p, isDry = false, viewer)) shouldBe Left(ServiceError.Forbidden("Forbidden"))
      await(svc.submit(p, isDry = true, viewer)) shouldBe Left(ServiceError.Forbidden("Forbidden"))
      await(svc.submit(p, isDry = false, stranger)).left.toOption.exists(_.isInstanceOf[ServiceError.NotFound]) shouldBe true
      runs(p) shouldBe empty
      lastRun(p) shouldBe LastRun(None, None, None, None)
    }
  }

  "run attribution (triggered_by_user_id)" should {

    def triggeredBy(p: PipelineId): Vector[Option[String]] = {
      import PostgresProfile.api._
      priv(sql"SELECT triggered_by_user_id::text FROM pipeline_runs WHERE pipeline_id = ${p.value} ORDER BY started_at".as[Option[String]]).toVector
    }

    "record the submitting user on an owner's real run, an editor's real run, an editor's dry run and a scheduled run" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      val svc = service(roomy)
      await(svc.submit(p, isDry = false, owner)).isRight shouldBe true
      await(svc.submit(p, isDry = false, ed)).isRight shouldBe true
      await(svc.submit(p, isDry = true, ed)).isRight shouldBe true
      await(svc.submit(p, isDry = false, owner, triggerSource = TriggerSource.Scheduled)).isRight shouldBe true
      triggeredBy(p) shouldBe Vector(Some(owner.id.value), Some(ed.id.value), Some(ed.id.value), Some(owner.id.value))
    }

    "record the submitting user on a run recorded as unrunnable" in {
      val p = seedPipelineId()
      await(service(roomy).recordUnrunnable(p, "cannot run", owner))
      triggeredBy(p) shouldBe Vector(Some(owner.id.value))
    }
  }

  "the grantee admission insert (insertGranteeRunIfUnderOwnerCap)" should {
    import PipelineRunRepository.ConcurrencyCapResult

    def admit(p: PipelineId, who: AuthenticatedUser, max: Int = 1000): ConcurrencyCapResult =
      await(runRepo.insertGranteeRunIfUnderOwnerCap(PipelineRunId(UUID.randomUUID().toString), p, Instant.now(), who, "manual", None, max, Some(who.id.value)))

    "admit an editor and write the row on the owner's pipeline" in {
      val p = seedPipelineId(); val ed = seedEditor(p)
      admit(p, ed) shouldBe ConcurrencyCapResult.Inserted
      runs(p).map(_.status) shouldBe Vector("queued")
    }

    "answer NotAuthorized and write nothing for a viewer, a non-grantee and a grant revoked since submit's check" in {
      import PostgresProfile.api._
      val p = seedPipelineId()
      val viewer   = grant(p, "viewer")
      val stranger = AuthenticatedUser(UserId(seedUser()))
      val revoked  = seedEditor(p)
      priv(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${p.value} AND grantee_id = ${revoked.id.value}::uuid")
      admit(p, viewer) shouldBe ConcurrencyCapResult.NotAuthorized
      admit(p, stranger) shouldBe ConcurrencyCapResult.NotAuthorized
      admit(p, revoked) shouldBe ConcurrencyCapResult.NotAuthorized
      runs(p) shouldBe empty
    }

    "answer PipelineGone (HEL-1503: not NotAuthorized) for a pipeline that no longer exists, on both the grantee and the owner path" in {
      val gone = PipelineId(UUID.randomUUID().toString)
      val ed   = AuthenticatedUser(UserId(seedUser()))
      admit(gone, ed) shouldBe ConcurrencyCapResult.PipelineGone
      await(runRepo.insertRunIfUnderConcurrencyCap(PipelineRunId(UUID.randomUUID().toString), gone, Instant.now(), owner, "manual", None, 5)) shouldBe ConcurrencyCapResult.PipelineGone
    }

    "count against the OWNER's cap, not the submitter's" in {
      val (capOwner, pipelines) = freshOwnerPipelines(1)
      val p = pipelines.head; val ed = seedEditor(p)
      admit(p, ed, max = 1) shouldBe ConcurrencyCapResult.Inserted
      admit(p, ed, max = 1) shouldBe ConcurrencyCapResult.CapExceeded
      await(runRepo.insertRunIfUnderConcurrencyCap(PipelineRunId(UUID.randomUUID().toString), p, Instant.now(), capOwner, "manual", None, 1)) shouldBe ConcurrencyCapResult.CapExceeded
    }

    "take the advisory lock keyed by the pipeline OWNER's id: a held owner-key lock blocks the editor's insert until released" in {
      import PostgresProfile.api._
      val ownerId = seedUser()
      val p  = seedPipelineOwnedBy(ownerId)
      val ed = seedEditor(p)
      val holder = DriverManager.getConnection(url, "helio_migration_test", "test")
      try {
        val st = holder.prepareStatement("SELECT pg_advisory_lock(hashtext(?))")
        st.setString(1, "pipeline-run-concurrency:" + ownerId); st.execute(); st.close()
        val insert = Future(admit(p, ed))
        Thread.sleep(1500)
        withClue("the editor's admission must wait on the owner-keyed lock: ") { insert.isCompleted shouldBe false }
        val un = holder.prepareStatement("SELECT pg_advisory_unlock(hashtext(?))")
        un.setString(1, "pipeline-run-concurrency:" + ownerId); un.execute(); un.close()
        await(insert) shouldBe ConcurrencyCapResult.Inserted
        runs(p).map(_.status) shouldBe Vector("queued")
      } finally holder.close()
    }
  }

  "an admitted editor run whose grant is revoked mid-run" should {

    "still reach terminal succeeded with last_run_* (lifecycle writes never re-authorize), so it cannot hold the owner's slot" in {
      import PostgresProfile.api._
      val p = seedPipelineId(); val ed = seedEditor(p)
      val gate = Promise[Unit](); val entered = Promise[Unit]()
      val run = service(roomy, new ScriptedBackend(gate = Some(gate.future), entered = Some(entered))).submit(p, isDry = false, ed)
      await(entered.future)
      priv(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${p.value} AND grantee_id = ${ed.id.value}::uuid")
      gate.success(())
      await(run).isRight shouldBe true
      runs(p).map(_.status) shouldBe Vector("succeeded")
      lastRun(p).status shouldBe Some("succeeded")
    }

    "write no dry_run row for a revoked editor's dry run, and still answer the run (assertions have no parent row)" in {
      import PostgresProfile.api._
      val p = seedPipelineId(); val ed = seedEditor(p)
      val gate = Promise[Unit](); val entered = Promise[Unit]()
      val run = service(roomy, new ScriptedBackend(gate = Some(gate.future), entered = Some(entered))).submit(p, isDry = true, ed)
      await(entered.future)
      priv(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${p.value} AND grantee_id = ${ed.id.value}::uuid")
      gate.success(())
      await(run).isRight shouldBe true
      runs(p) shouldBe empty
    }
  }

  "a grant revoked between submit's ACL check and admission" should {

    /** `submit`'s read of the grant is modelled as stale: the repository still reports the editor grant, while the row
     *  has in fact been removed, so only the in-transaction re-authorization can refuse it. */
    final class StaleGrantPipelineRepository extends PipelineRepository(ctx, dsRepo) {
      override def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] = findByIdInternal(id)
      override def findGrantRole(id: PipelineId, user: AuthenticatedUser): Future[Option[String]] = Future.successful(Some("editor"))
    }

    "be refused 403 without executing or writing anything" in {
      val p = seedPipelineId()
      val formerEditor = AuthenticatedUser(UserId(seedUser())) // never granted: the stale check is the only thing admitting it
      val backend = new ScriptedBackend()
      val svc = new PipelineRunService(
        new StaleGrantPipelineRepository, stepRepo, dsRepo, runRepo, new PipelineRunCache(), registry = null,
        new LocalFileSystem(Paths.get("/")), outputRepo = outRepo, nodeSnapshotRepo = snapRepo,
        pipelineRunGuardRepo = guardRepo, executionBackend = backend, guardConfig = roomy
      )
      await(svc.submit(p, isDry = false, formerEditor)) shouldBe Left(ServiceError.Forbidden("Forbidden"))
      backend.executions.get shouldBe 0
      runs(p) shouldBe empty
      lastRun(p) shouldBe LastRun(None, None, None, None)
    }
  }
}
