package com.helio.services.pipelines

import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule}
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
import slick.jdbc.PostgresProfile.api.DBIO
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.sql.{DriverManager, SQLException}
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1503: the follow-ups to HEL-1492 -- an editor's successful run refreshes the schema-drift baseline exactly
 *  as the owner's run would; a pipeline deleted mid-submit answers 404 (never 403/5xx) on both admission paths;
 *  a dry run re-verifies owner-or-editor immediately before it executes.
 *
 *  Runs as a NOSUPERUSER NOBYPASSRLS role (shape of `PipelineRunEditorPersistenceSpec`) so RLS applies exactly as
 *  in production. Seeding and measuring use the privileged pool.
 *
 *  Two deletion seams: S1 "delete at access check" (the pipeline is deleted right after `submit`'s ACL read) and S2
 *  "delete after root resolution" (deleted when the step list is read, after roots resolved, before admission). */
class Hel1503EditorRunGapsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
  private def priv[T](a: DBIO[T]): T = await(privDb.run(a))

  /** Counts executions and delegates to the real in-process engine. */
  private final class SpyBackend extends PipelineExecutionBackend {
    val executions = new AtomicInteger(0)
    private val real = new InProcessExecutionBackend(new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))), stepRepo)
    override def supportsWriteBack: Boolean = real.supportsWriteBack
    override def execute(
        pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink, truncationSink: TruncationSink, retain: Set[NodeKey], onNodeProgress: (NodeKey, Long) => Unit,
        writeBackSink: WriteBackSink, ownerUserId: Option[String]
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      executions.incrementAndGet()
      real.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, retain, onNodeProgress, writeBackSink, ownerUserId)
    }
  }

  private val roomy = PipelineRunGuardConfig(1000, 3600, 1000, 15, 1000)

  private def service(backend: PipelineExecutionBackend, pRepo: PipelineRepository = pipelineRepo, sRepo: PipelineStepRepository = stepRepo): PipelineRunService =
    new PipelineRunService(
      pRepo, sRepo, dsRepo, runRepo, new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")),
      outputRepo = outRepo, nodeSnapshotRepo = snapRepo, pipelineRunGuardRepo = guardRepo,
      executionBackend = backend, guardConfig = roomy
    )

  private val SrcSchema = """[{"name":"name","type":"string"},{"name":"score","type":"float"}]"""
  private val Rows      = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""

  private def seedUser(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    priv(sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                VALUES ($id::uuid, ${"u-" + id + "@test"}, 'U', now(), now())""")
    id
  }

  private def seedSource(ownerId: String, inferred: String = SrcSchema): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    priv(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, Rows),
      sqlu"UPDATE data_sources SET inferred_schema = $inferred::jsonb WHERE id = $dsId"
    ))
    dsId
  }

  /** A pipeline of a brand-new owner over a source that owner owns, with one passing assert step. */
  private def seedPipeline(ownerId: String): PipelineId = {
    import PostgresProfile.api._
    val dsId = seedSource(ownerId)
    val pid  = UUID.randomUUID().toString
    priv(DBIO.seq(
      sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerId::uuid, now(), now())",
      sqlu"INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"
    ))
    val p = PipelineId(pid)
    val parent0 = stepRepo.trunkOf(await(stepRepo.listByPipelineInternal(p))).lastOption.map(_.id)
    await(stepRepo.insertInternal(p, "assert", AssertConfig(Vector(AssertRule("notNull", Some("name"), JsObject.empty, "error"))), true, parent0, explicitRootId = None))
    p
  }

  private def grantEditor(p: PipelineId): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = seedUser()
    priv(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                VALUES ('pipeline', ${p.value}, $id::uuid, 'editor', now())""")
    AuthenticatedUser(UserId(id))
  }

  private def revoke(p: PipelineId, who: AuthenticatedUser): Unit = {
    import PostgresProfile.api._
    priv(sqlu"DELETE FROM resource_permissions WHERE resource_type = 'pipeline' AND resource_id = ${p.value} AND grantee_id = ${who.id.value}::uuid")
  }

  private def deletePipeline(p: PipelineId): Unit = {
    import PostgresProfile.api._
    priv(sqlu"DELETE FROM pipelines WHERE id = ${p.value}")
  }

  private def baseline(p: PipelineId): Option[JsValue] = {
    import PostgresProfile.api._
    priv(sql"SELECT last_source_schema::text FROM pipelines WHERE id = ${p.value}".as[Option[String]].head).map(_.parseJson)
  }

  private def runStatuses(p: PipelineId): Vector[String] = {
    import PostgresProfile.api._
    priv(sql"SELECT status FROM pipeline_runs WHERE pipeline_id = ${p.value} ORDER BY started_at".as[String]).toVector
  }

  private def isNotFound(r: Either[ServiceError, _]): Boolean = r.left.toOption.exists(_.isInstanceOf[ServiceError.NotFound])

  /** S1: the pipeline is deleted right after `submit`'s ACL read returned it; the (stale) editor grant still reads as editor. */
  private final class DeleteAtAccessCheckRepository extends PipelineRepository(ctx, dsRepo) {
    override def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] =
      super.findByIdShared(id, callerOpt).map { found => deletePipeline(id); found }
    override def findGrantRole(id: PipelineId, user: AuthenticatedUser): Future[Option[String]] = Future.successful(Some("editor"))
  }

  /** S2: the pipeline is deleted when the step list is read -- after the roots resolved, before admission / the dry-run check. */
  private final class DeleteAtStepListRepository extends PipelineStepRepository(ctx) {
    private val armed = new AtomicBoolean(true)
    override def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[PipelineStep]] =
      super.listByPipelineInternal(pipelineId).map { steps => if (armed.compareAndSet(true, false)) deletePipeline(pipelineId); steps }
  }

  "an editor grantee's successful REAL run" should {

    "persist last_source_schema equal to the source schema the pipeline owner sees" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      await(service(new SpyBackend).submit(p, isDry = false, ed)).isRight shouldBe true
      baseline(p) shouldBe Some(SrcSchema.parseJson)
    }

    "store what the owner's own run stores when the primary root's source belongs to the editor (the owner cannot see it)" in {
      import PostgresProfile.api._
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      val edSource = seedSource(ed.id.value, """[{"name":"editor_only","type":"string"}]""")
      priv(sqlu"UPDATE pipeline_roots SET data_source_id = $edSource WHERE pipeline_id = ${p.value}")
      val ownerRun = AuthenticatedUser(UserId(ownerId))
      await(service(new SpyBackend).submit(p, isDry = false, ownerRun)).isRight shouldBe true
      val ownerBaseline = baseline(p)
      ownerBaseline shouldBe Some(JsArray.empty)
      priv(sqlu"UPDATE pipelines SET last_source_schema = NULL WHERE id = ${p.value}")
      await(service(new SpyBackend).submit(p, isDry = false, ed)).isRight shouldBe true
      baseline(p) shouldBe ownerBaseline
    }

    "[regression pin] leave the owner's own run unchanged: the baseline is the owner-owned source's schema" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId)
      await(service(new SpyBackend).submit(p, isDry = false, AuthenticatedUser(UserId(ownerId)))).isRight shouldBe true
      baseline(p) shouldBe Some(SrcSchema.parseJson)
    }
  }

  "a pipeline deleted mid-submit (S1: at the access check)" should {

    "answer an owner's real run 404, never executing and writing no run row" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId)
      val backend = new SpyBackend
      val r = await(service(backend, new DeleteAtAccessCheckRepository).submit(p, isDry = false, AuthenticatedUser(UserId(ownerId))))
      withClue(s"got $r: ") { isNotFound(r) shouldBe true }
      backend.executions.get shouldBe 0
      runStatuses(p) shouldBe empty
    }

    "answer an editor's real run 404, never executing and writing no run row" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      val backend = new SpyBackend
      val r = await(service(backend, new DeleteAtAccessCheckRepository).submit(p, isDry = false, ed))
      withClue(s"got $r: ") { isNotFound(r) shouldBe true }
      backend.executions.get shouldBe 0
      runStatuses(p) shouldBe empty
    }

    "answer owner and editor dry runs 404, never executing and writing no run row" in {
      val ownerId = seedUser(); val p1 = seedPipeline(ownerId); val p2 = seedPipeline(ownerId); val ed = grantEditor(p2)
      val backend = new SpyBackend
      val rOwner  = await(service(backend, new DeleteAtAccessCheckRepository).submit(p1, isDry = true, AuthenticatedUser(UserId(ownerId))))
      val rEditor = await(service(backend, new DeleteAtAccessCheckRepository).submit(p2, isDry = true, ed))
      withClue(s"owner got $rOwner: ") { isNotFound(rOwner) shouldBe true }
      withClue(s"editor got $rEditor: ") { isNotFound(rEditor) shouldBe true }
      backend.executions.get shouldBe 0
      (runStatuses(p1) ++ runStatuses(p2)) shouldBe empty
    }

    "keep the 422 for a pipeline that exists but has no root" in {
      import PostgresProfile.api._
      val ownerId = seedUser()
      val pid = UUID.randomUUID().toString
      priv(sqlu"INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'rootless', $ownerId::uuid, now(), now())")
      val r = await(service(new SpyBackend).submit(PipelineId(pid), isDry = false, AuthenticatedUser(UserId(ownerId))))
      r.left.toOption.exists(_.isInstanceOf[ServiceError.UnprocessableEntity]) shouldBe true
    }
  }

  "a pipeline deleted mid-submit (S2: after root resolution, before admission)" should {

    "answer an owner's and an editor's real run 404 -- never 403 or a server error -- without executing or writing a run row" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId))
      val p1 = seedPipeline(ownerId); val p2 = seedPipeline(ownerId); val ed = grantEditor(p2)
      val backend = new SpyBackend
      val rOwner  = await(service(backend, sRepo = new DeleteAtStepListRepository).submit(p1, isDry = false, owner))
      val rEditor = await(service(backend, sRepo = new DeleteAtStepListRepository).submit(p2, isDry = false, ed))
      withClue(s"owner got $rOwner: ") { isNotFound(rOwner) shouldBe true }
      withClue(s"editor got $rEditor: ") { isNotFound(rEditor) shouldBe true }
      backend.executions.get shouldBe 0
      (runStatuses(p1) ++ runStatuses(p2)) shouldBe empty
    }

    "answer an owner's and an editor's dry run 404 without executing" in {
      val ownerId = seedUser(); val owner = AuthenticatedUser(UserId(ownerId))
      val p1 = seedPipeline(ownerId); val p2 = seedPipeline(ownerId); val ed = grantEditor(p2)
      val backend = new SpyBackend
      val rOwner  = await(service(backend, sRepo = new DeleteAtStepListRepository).submit(p1, isDry = true, owner))
      val rEditor = await(service(backend, sRepo = new DeleteAtStepListRepository).submit(p2, isDry = true, ed))
      withClue(s"owner got $rOwner: ") { isNotFound(rOwner) shouldBe true }
      withClue(s"editor got $rEditor: ") { isNotFound(rEditor) shouldBe true }
      backend.executions.get shouldBe 0
      (runStatuses(p1) ++ runStatuses(p2)) shouldBe empty
    }
  }

  "admission" should {
    import PipelineRunRepository.ConcurrencyCapResult

    /** Holds the owner-keyed advisory lock so an admission started after it parks on that lock, then proves the
     *  parked admission already holds a lock on the pipeline row: a `DELETE` from a third session (privileged, so RLS
     *  cannot filter it to 0 rows) must time out with SQLState 55P03. After release the admission inserts, and the
     *  delete then removes exactly one row. */
    def assertRowLockedWhileParked(ownerId: String, p: PipelineId, admit: () => Future[ConcurrencyCapResult]): Unit = {
      import PostgresProfile.api._
      val holder = DriverManager.getConnection(url, "helio_migration_test", "test")
      var admission: Option[Future[ConcurrencyCapResult]] = None
      try {
        val lock = holder.prepareStatement("SELECT pg_advisory_lock(hashtext(?))")
        lock.setString(1, "pipeline-run-concurrency:" + ownerId); lock.execute(); lock.close()
        admission = Some(admit())
        val deadline = System.nanoTime() + 20.seconds.toNanos
        def parked: Boolean = priv(sql"SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted".as[Int].head) > 0
        while (!parked && System.nanoTime() < deadline) Thread.onSpinWait()
        withClue("the admission must park on the owner-keyed advisory lock: ") { parked shouldBe true }
        val third = DriverManager.getConnection(url, "helio_migration_test", "test")
        try {
          third.createStatement().execute("SET ROLE helio_privileged")
          third.createStatement().execute("SET lock_timeout = '500ms'")
          val del = third.prepareStatement("DELETE FROM pipelines WHERE id = ?")
          del.setString(1, p.value)
          val ex = intercept[SQLException](del.executeUpdate())
          ex.getSQLState shouldBe "55P03"
        } finally third.close()
      } finally {
        val un = holder.prepareStatement("SELECT pg_advisory_unlock(hashtext(?))")
        un.setString(1, "pipeline-run-concurrency:" + ownerId); un.execute(); un.close()
        holder.close()
      }
      await(admission.get) shouldBe ConcurrencyCapResult.Inserted
      priv(sqlu"DELETE FROM pipelines WHERE id = ${p.value}") shouldBe 1
    }

    "hold a key-share lock on the pipeline row while the OWNER path waits for the advisory lock" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId)
      assertRowLockedWhileParked(ownerId, p, () =>
        runRepo.insertRunIfUnderConcurrencyCap(PipelineRunId(UUID.randomUUID().toString), p, Instant.now(), AuthenticatedUser(UserId(ownerId)), "manual", None, 1000))
    }

    "hold a key-share lock on the pipeline row while the GRANTEE path waits for the advisory lock" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      assertRowLockedWhileParked(ownerId, p, () =>
        runRepo.insertGranteeRunIfUnderOwnerCap(PipelineRunId(UUID.randomUUID().toString), p, Instant.now(), ed, "manual", None, 1000, Some(ed.id.value)))
    }
  }

  "a dry run" should {

    /** Models `submit`'s grant read as the last thing before the grant is revoked: the grant exists for the ACL
     *  check, and is gone by the time the run would execute. */
    final class RevokeAfterGrantCheckRepository(who: AuthenticatedUser, p: PipelineId) extends PipelineRepository(ctx, dsRepo) {
      override def findGrantRole(id: PipelineId, user: AuthenticatedUser): Future[Option[String]] =
        super.findGrantRole(id, user).map { role => revoke(p, who); role }
    }

    "be refused 403 for an editor revoked before it executes: nothing executes, no row is written" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      val backend = new SpyBackend
      val r = await(service(backend, new RevokeAfterGrantCheckRepository(ed, p)).submit(p, isDry = true, ed))
      r shouldBe Left(ServiceError.Forbidden("Forbidden"))
      backend.executions.get shouldBe 0
      runStatuses(p) shouldBe empty
    }

    "[regression pin] still run and record a dry_run row for a live editor and for the owner" in {
      val ownerId = seedUser(); val p = seedPipeline(ownerId); val ed = grantEditor(p)
      val backend = new SpyBackend
      await(service(backend).submit(p, isDry = true, ed)).isRight shouldBe true
      await(service(backend).submit(p, isDry = true, AuthenticatedUser(UserId(ownerId)))).isRight shouldBe true
      backend.executions.get shouldBe 2
      runStatuses(p) shouldBe Vector("dry_run", "dry_run")
    }
  }
}
