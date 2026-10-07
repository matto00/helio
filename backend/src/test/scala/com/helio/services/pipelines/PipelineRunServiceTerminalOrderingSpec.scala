package com.helio.services.pipelines

import com.helio.api.routes.pipelines.{PipelineRunNotifyBus, PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule, UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.api.protocols.pipelines.RunResultResponse
import com.helio.services.ServiceError
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Paths
import java.sql.{Connection, DriverManager}
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._

/** HEL-1366: a run's terminal SSE event (`succeeded` / `failed` / `dry_run`) must be published
 *  only AFTER the run's durable terminal state is committed.
 *
 *  Deterministic, lock-holding proof (design.md D4) -- never timing-based. Each case holds a
 *  database lock, on its own dedicated JDBC connection outside the service's Hikari pool, that
 *  blocks exactly the write the terminal event must wait for. While the lock is held it asserts
 *  (1) no terminal event reached a registry subscriber, (2) the durable state is still
 *  pre-terminal, (3) the lock is really blocking a service backend (`pg_blocking_pids`, so the
 *  case cannot pass vacuously), and (4) after release the event arrives with the durable state
 *  readable and exactly one terminal event was published. */
class PipelineRunServiceTerminalOrderingSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with BeforeAndAfterEach with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "pipeline-run-terminal-ordering-spec")
  private val mat: Materializer = Materializer(typedSystem.classicSystem)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var stepRepo: PipelineStepRepository   = _
  private var dataSourceRepo: DataSourceRepository = _
  private var outputRepo: OutputRepository       = _
  private var pipelineRepo: PipelineRepository   = _
  private var runRepo: PipelineRunRepository     = _
  private var snapshotRepo: NodeSnapshotRepository = _

  private val openConns = new ConcurrentLinkedQueue[Connection]()
  private val openBuses = new ConcurrentLinkedQueue[PipelineRunNotifyBus]()
  private val heldLocks = new ConcurrentLinkedQueue[Held]()

  /** Every lock a case took is released after it, pass or fail: a failing assertion must never leave
   *  a lock held, or the service's blocked writes (and later DDL) would wait on it forever. */
  override def afterEach(): Unit =
    try heldLocks.asScala.foreach(_.release())
    finally { heldLocks.clear(); super.afterEach() }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx            = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo       = new PipelineStepRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    runRepo        = new PipelineRunRepository(ctx)
    outputRepo     = new OutputRepository(ctx)
    snapshotRepo   = new NodeSnapshotRepository(ctx)
  }

  override def afterAll(): Unit = {
    openBuses.asScala.foreach(b => scala.util.Try(b.shutdown()))
    openConns.asScala.foreach(c => scala.util.Try(c.close()))
    db.close(); embeddedPostgres.close(); typedSystem.terminate()
    super.afterAll()
  }

  private def await[T](f: Future[T], d: FiniteDuration = 20.seconds): T = Await.result(f, d)

  // ── Dedicated connections (outside the service's Hikari pool) ────────────

  private def openConn(autoCommit: Boolean): Connection = {
    val c = DriverManager.getConnection(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
    c.setAutoCommit(autoCommit)
    openConns.add(c)
    c
  }

  private def backendPid(c: Connection): Int = {
    val rs = c.createStatement().executeQuery("SELECT pg_backend_pid()")
    rs.next(); val p = rs.getInt(1); rs.close(); p
  }

  /** One held lock = one dedicated connection + its pid. Released by rolling the txn back. */
  private final class Held(val label: String, val conn: Connection) {
    val pid: Int = backendPid(conn)
    private var released = false
    /** Idempotent: a no-op once released (the case body and afterEach may both call it). */
    def release(): Unit = synchronized {
      if (!released) {
        released = true
        try conn.rollback() finally conn.close()
      }
    }
  }

  private def hold(label: String, sql: String): Held = {
    val c = openConn(autoCommit = false)
    val h = new Held(label, c)
    heldLocks.add(h)
    c.createStatement().execute(sql)
    h
  }

  /** Read-only observer connection (autocommit): plain SELECTs, which no lock held here blocks. */
  private lazy val observer: Connection = openConn(autoCommit = true)
  private lazy val observerPid: Int     = backendPid(observer)

  private def scalar(sql: String): Option[String] = {
    val rs = observer.createStatement().executeQuery(sql)
    try if (rs.next()) Option(rs.getString(1)) else None
    finally rs.close()
  }

  /** Every service backend (a pid that is NOT one of this spec's dedicated connections) that is
   *  currently blocked, mapped to the pids blocking it. */
  private def blockedServiceBackends(testPids: Set[Int]): Map[Int, Set[Int]] = {
    val rs = observer.createStatement().executeQuery(
      "SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity " +
        "WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0")
    try {
      Iterator.continually(rs).takeWhile(_.next()).map { r =>
        val blockers = r.getArray(2).getArray.asInstanceOf[Array[Integer]].map(_.intValue).toSet
        r.getInt(1) -> blockers
      }.toMap.filter { case (pid, _) => !testPids.contains(pid) }
    } finally rs.close()
  }

  /** Non-vacuity: poll (waiters attach asynchronously) until some service backend is blocked by
   *  `holder`'s connection. Never a single immediate sample. */
  private def awaitBlockedBy(holder: Held, testPids: Set[Int]): Unit = {
    val deadline = System.nanoTime() + 15.seconds.toNanos
    var seen = false
    while (!seen && System.nanoTime() < deadline) {
      seen = blockedServiceBackends(testPids).values.exists(_.contains(holder.pid))
      if (!seen) Thread.sleep(50)
    }
    withClue(s"lock '${holder.label}' (pid ${holder.pid}) never blocked a service backend -- the case would be vacuous: ") {
      seen shouldBe true
    }
  }

  // ── Registry subscriber ──────────────────────────────────────────────────

  private final class Subscriber(registry: PipelineRunRegistry, pipelineId: String) {
    val events = new ConcurrentLinkedQueue[RunStatusEvent]()
    // Live from subscribe(); the materialized stream is held for the whole run.
    registry.subscribe(pipelineId).runWith(Sink.foreach[RunStatusEvent](e => events.add(e)))(mat)

    def snapshot: Vector[RunStatusEvent]  = events.asScala.toVector
    def terminals: Vector[RunStatusEvent] = snapshot.filter(e => RunStatusEvent.isTerminal(e.status))

    def awaitTerminal(timeout: FiniteDuration = 15.seconds): RunStatusEvent = {
      val deadline = System.nanoTime() + timeout.toNanos
      while (terminals.isEmpty && System.nanoTime() < deadline) Thread.sleep(25)
      withClue(s"no terminal event arrived after the lock was released; events=$snapshot: ") { terminals should not be empty }
      terminals.head
    }
  }

  /** Bounded window with the lock held in which NO terminal event may arrive. */
  private val NoEventWindowMs = 1500L

  private def assertNoTerminalWhileBlocked(sub: Subscriber, stage: String): Unit = {
    val deadline = System.currentTimeMillis() + NoEventWindowMs
    while (sub.terminals.isEmpty && System.currentTimeMillis() < deadline) Thread.sleep(25)
    withClue(s"terminal event received while write blocked ($stage); events=${sub.snapshot}: ") {
      sub.terminals shouldBe empty
    }
  }

  // ── Gating backend (delegates to the REAL in-process engine) ─────────────

  private final class GatingBackend(
      delegate: PipelineExecutionBackend,
      entered: Promise[Unit],
      gate: Future[Unit],
      failWith: Option[Throwable]
  ) extends PipelineExecutionBackend {
    override def supportsWriteBack: Boolean = delegate.supportsWriteBack
    override def execute(
        pipeline: Pipeline,
        roots: Vector[(String, DataSource)],
        steps: Vector[PipelineStep],
        dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink,
        truncationSink: TruncationSink,
        onNodeProgress: (NodeKey, Long) => Unit = (_, _) => (),
        writeBackSink: WriteBackSink = new WriteBackSink,
        ownerUserId: Option[String] = None
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      entered.trySuccess(())
      gate.flatMap { _ =>
        failWith match {
          case Some(ex) => Future.failed(ex)
          case None     => delegate.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink, ownerUserId)
        }
      }
    }
  }

  /** Publish-level counter. The registry drops a subscriber on its first terminal event, so a
   *  second publish is invisible to `Subscriber`. A second, independent bus on the same Postgres
   *  receives EVERY NOTIFY the service's registry sends (no subscriber removal), so counting there
   *  can really fail on a double publish (HEL-1366 D2). */
  private final class PublishCounter(pipelineId: String) {
    val terminals = new ConcurrentLinkedQueue[RunStatusEvent]()
    def snapshot: Vector[RunStatusEvent] = terminals.asScala.toVector
  }

  private final case class Harness(
      service: PipelineRunService,
      sub: Subscriber,
      counter: PublishCounter,
      entered: Promise[Unit],
      gate: Promise[Unit]
  )

  private val SettleWindowMs = 1500L

  /** Exactly one terminal event of `status` was PUBLISHED for the run: wait for the first, then a
   *  bounded window in which a duplicate would show up, then assert the count. */
  private def assertExactlyOneTerminalPublished(h: Harness, status: String): Unit = {
    val deadline = System.nanoTime() + 15.seconds.toNanos
    while (h.counter.snapshot.isEmpty && System.nanoTime() < deadline) Thread.sleep(25)
    Thread.sleep(SettleWindowMs)
    withClue(s"published terminal events: ${h.counter.snapshot}: ") {
      h.counter.snapshot.map(_.status) shouldBe Seq(status)
    }
  }

  private def harness(pipelineId: PipelineId, failWith: Option[Throwable] = None): Harness = {
    val url      = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    val bus      = new PipelineRunNotifyBus(db, url, "postgres", "postgres")
    val witness  = new PipelineRunNotifyBus(db, url, "postgres", "postgres")
    openBuses.add(bus); openBuses.add(witness)
    val counter  = new PublishCounter(pipelineId.value)
    witness.onReceive((pid, e) => if (pid == pipelineId.value && RunStatusEvent.isTerminal(e.status)) counter.terminals.add(e))
    val registry = new PipelineRunRegistry(bus)
    val sub      = new Subscriber(registry, pipelineId.value)
    val entered  = Promise[Unit]()
    val gate     = Promise[Unit]()
    val fs       = new LocalFileSystem(Paths.get("/"))
    val real     = new InProcessExecutionBackend(new InProcessPipelineEngine(fs), stepRepo)
    val service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry, fs,
      executionBackend = new GatingBackend(real, entered, gate.future, failWith),
      outputRepo = outputRepo, nodeSnapshotRepo = snapshotRepo
    )
    Harness(service, sub, counter, entered, gate)
  }

  // ── Fixtures ─────────────────────────────────────────────────────────────

  private final case class Fx(owner: AuthenticatedUser, pid: PipelineId, sourceId: String)

  private def seed(extraSteps: (Fx => Unit) = _ => (), withRootOutput: Boolean = false): Fx = {
    import PostgresProfile.api._
    val owner = AuthenticatedUser(UserId(UUID.randomUUID().toString))
    val dsId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    val payload = """{"columns":[{"name":"name","type":"string"}],"rows":[["alice"],["bob"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.id.value}::uuid, ${s"${owner.id.value}@test.local"}, now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.id.value}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val fx = Fx(owner, PipelineId(pid), dsId)
    extraSteps(fx)
    // Bound to the root so `materializedWrites` is a real `node_snapshots` replace, not a no-op.
    if (withRootOutput)
      await(outputRepo.insertInternal(fx.pid, None, owner.id, "root-out", OutputKind.Table, explicitRootId = Some(PipelineRootId(pid))))
    fx
  }

  private def runStatus(pid: PipelineId): Option[String] =
    scalar(s"SELECT status FROM pipeline_runs WHERE pipeline_id = '${pid.value}' ORDER BY started_at DESC LIMIT 1")

  private def runCount(pid: PipelineId): Int =
    scalar(s"SELECT count(*) FROM pipeline_runs WHERE pipeline_id = '${pid.value}'").get.toInt

  private def snapshotCount(pid: PipelineId): Int =
    scalar(s"SELECT count(*) FROM node_snapshots WHERE pipeline_id = '${pid.value}'").get.toInt

  private def isTerminalStatus(s: String) = Set("succeeded", "failed", "dry_run").contains(s)

  /** Shared body for the four real-run `failed`/`succeeded` shapes: submit against the gating
   *  backend, lock the run row once `execute` is entered, then open the gate. Returns the locks
   *  (row lock first) and the in-flight submit. */
  private def startAndLockRunRow(h: Harness, fx: Fx): (Held, Future[Either[ServiceError, RunResultResponse]]) = {
    val submitted = h.service.submit(fx.pid, isDry = false, fx.owner)
    await(h.entered.future)
    // `execute` is entered, so the run row is already committed (preExec resolved before it).
    val rowLock = hold("pipeline_runs row", s"SELECT 1 FROM pipeline_runs WHERE pipeline_id = '${fx.pid.value}' FOR UPDATE")
    (rowLock, submitted)
  }

  private def finishFailedCase(h: Harness, fx: Fx, rowLock: Held, submitted: Future[Either[ServiceError, RunResultResponse]], expectedErrorFragment: Option[String]): Unit = {
    val testPids = Set(observerPid, rowLock.pid)
    h.gate.success(())
    awaitBlockedBy(rowLock, testPids)
    assertNoTerminalWhileBlocked(h.sub, "pipeline_runs row locked")
    withClue("run status while the terminal write is blocked: ") {
      runStatus(fx.pid).foreach(s => isTerminalStatus(s) shouldBe false)
    }
    rowLock.release()
    val ev = h.sub.awaitTerminal()
    ev.status shouldBe "failed"
    expectedErrorFragment.foreach(f => ev.errorLog.getOrElse("") should include(f))
    // Durable at the moment the event is observed.
    runStatus(fx.pid) shouldBe Some("failed")
    scalar(s"SELECT last_run_status FROM pipelines WHERE id = '${fx.pid.value}'") shouldBe Some("failed")
    await(submitted)
    h.sub.terminals should have size 1
    assertExactlyOneTerminalPublished(h, "failed")
  }

  /** Test-only BEFORE UPDATE trigger on `pipeline_runs` that raises when a run of `pid` is moved to
   *  a terminal status; dropped afterwards. Autocommit on its own dedicated connection. */
  private def withFailingTerminalUpdate(pid: PipelineId)(body: => Unit): Unit = {
    val ddl    = openConn(autoCommit = true)
    // Never wait forever behind a lock (DDL queues behind the service's blocked UPDATEs).
    ddl.createStatement().execute("SET lock_timeout = '5s'")
    val suffix = pid.value.replace("-", "")
    val trg    = s"hel1366_fail_terminal_$suffix"
    try {
      ddl.createStatement().execute(
        s"""CREATE OR REPLACE FUNCTION $trg() RETURNS trigger AS $$$$
           |BEGIN
           |  IF NEW.pipeline_id = '${pid.value}' AND NEW.status IN ('succeeded','failed') THEN
           |    RAISE EXCEPTION 'hel1366 test: terminal write refused';
           |  END IF;
           |  RETURN NEW;
           |END $$$$ LANGUAGE plpgsql""".stripMargin)
      ddl.createStatement().execute(s"CREATE TRIGGER $trg BEFORE UPDATE ON pipeline_runs FOR EACH ROW EXECUTE FUNCTION $trg()")
      body
    }
    finally {
      try ddl.createStatement().execute(s"DROP TRIGGER IF EXISTS $trg ON pipeline_runs")
      finally ddl.createStatement().execute(s"DROP FUNCTION IF EXISTS $trg()")
    }
  }

  private def awaitCompleted(f: Future[_]): Unit =
    withClue("submit never completed after the terminal write failed: ") { Await.ready(f, 20.seconds) }

  // ── Cases ────────────────────────────────────────────────────────────────

  "PipelineRunService terminal event ordering (HEL-1366)" should {

    "publish `succeeded` only after the run status AND the materialized snapshots are durable (staged release)" in {
      val fx = seed(withRootOutput = true)
      val h  = harness(fx.pid)
      observerPid // force the observer's connection open before any lock
      // Table lock first, before submit: nothing on the run path before the publish writes node_snapshots.
      val tableLock = hold("node_snapshots table", "LOCK TABLE node_snapshots IN EXCLUSIVE MODE")
      val (rowLock, submitted) = startAndLockRunRow(h, fx)
      val testPids = Set(observerPid, tableLock.pid, rowLock.pid)

      h.gate.success(())
      awaitBlockedBy(rowLock, testPids)
      awaitBlockedBy(tableLock, testPids)
      assertNoTerminalWhileBlocked(h.sub, "both pipeline_runs row and node_snapshots locked")
      withClue("run status while both locks are held: ")(runStatus(fx.pid).foreach(s => isTerminalStatus(s) shouldBe false))
      snapshotCount(fx.pid) shouldBe 0

      // Stage 2: release ONLY the row lock; the snapshot replace is still blocked.
      rowLock.release()
      val testPids2 = Set(observerPid, tableLock.pid)
      awaitBlockedBy(tableLock, testPids2)
      assertNoTerminalWhileBlocked(h.sub, "node_snapshots still locked after the run-status lock was released")
      snapshotCount(fx.pid) shouldBe 0

      tableLock.release()
      val ev = h.sub.awaitTerminal()
      ev.status shouldBe "succeeded"
      ev.rowCount shouldBe Some(2)
      // Durable at the moment the event is observed.
      runStatus(fx.pid) shouldBe Some("succeeded")
      snapshotCount(fx.pid) shouldBe 2
      await(submitted) shouldBe a[Right[_, _]]
      h.sub.terminals should have size 1
      assertExactlyOneTerminalPublished(h, "succeeded")
    }

    "publish `failed` (execution exception) only after the run's failed status is durable" in {
      val fx = seed()
      val h  = harness(fx.pid, failWith = Some(new RuntimeException("boom")))
      observerPid
      val (rowLock, submitted) = startAndLockRunRow(h, fx)
      finishFailedCase(h, fx, rowLock, submitted, Some("Pipeline execution failed"))
    }

    "publish `failed` (assertion-blocked) only after the run's failed status is durable" in {
      val blocking = AssertRule("rowCountMax", None, JsObject("count" -> JsNumber(1)), "error")
      val fx = seed(extraSteps = f => await(stepRepo.insertInternal(f.pid, "assert", AssertConfig(Vector(blocking)), enabled = true, None, explicitRootId = None)))
      val h  = harness(fx.pid)
      observerPid
      val (rowLock, submitted) = startAndLockRunRow(h, fx)
      finishFailedCase(h, fx, rowLock, submitted, None)
    }

    "publish `failed` (write-back failure) only after the run's failed status is durable" in {
      import PostgresProfile.api._
      val targetId = UUID.randomUUID().toString
      val fx = seed(extraSteps = f => {
        // Target declares no columns, so the source's `name` column is undeclared: the write-back fails.
        await(db.run(DBIO.seq(
          sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($targetId, 'ds-target', 'dataset', '{}', ${f.owner.id.value}::uuid, now(), now())""",
          DatasetRowsTestSupport.seedActionsFromRaw(targetId, """{"columns":[],"rows":[]}""")
        )))
        await(stepRepo.insertInternal(f.pid, "upsertsource", UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), UpsertMode.Append),
          enabled = true, None, explicitRootId = None, actingUserId = f.owner.id.value))
      })
      val h = harness(fx.pid)
      observerPid
      val (rowLock, submitted) = startAndLockRunRow(h, fx)
      finishFailedCase(h, fx, rowLock, submitted, Some("upsertsource"))
    }

    "publish `dry_run` only after the dry run's record is durable" in {
      val fx = seed()
      val h  = harness(fx.pid)
      observerPid
      // A dry run inserts its (already terminal) pipeline_runs row only at the end; the FK check
      // takes KEY SHARE on the parent pipelines row, which FOR UPDATE (not FOR NO KEY UPDATE) blocks.
      val parentLock = hold("pipelines row", s"SELECT 1 FROM pipelines WHERE id = '${fx.pid.value}' FOR UPDATE")
      val testPids   = Set(observerPid, parentLock.pid)
      val submitted  = h.service.submit(fx.pid, isDry = true, fx.owner)
      await(h.entered.future)
      h.gate.success(())
      awaitBlockedBy(parentLock, testPids)
      assertNoTerminalWhileBlocked(h.sub, "pipelines row locked")
      withClue("no pipeline_runs row exists for a dry run until insertDryRun: ")(runCount(fx.pid) shouldBe 0)
      parentLock.release()
      val ev = h.sub.awaitTerminal()
      ev.status shouldBe "dry_run"
      // Durable at the moment the event is observed.
      scalar(s"SELECT status FROM pipeline_runs WHERE id = '${ev.runId.get}'") shouldBe Some("dry_run")
      await(submitted) shouldBe a[Right[_, _]]
      h.sub.terminals should have size 1
      assertExactlyOneTerminalPublished(h, "dry_run")
    }

    // The terminal write chain FAILS: a test-only trigger makes the terminal UPDATE of this
    // pipeline's runs raise. The event must still be published exactly once (subscribers are never
    // left waiting) and submit must complete.
    "publish exactly one `failed` event and complete submit even when the terminal write fails (execution exception)" in {
      val fx = seed()
      val h  = harness(fx.pid, failWith = Some(new RuntimeException("boom")))
      withFailingTerminalUpdate(fx.pid) {
        val submitted = h.service.submit(fx.pid, isDry = false, fx.owner)
        await(h.entered.future)
        h.gate.success(())
        val ev = h.sub.awaitTerminal()
        ev.status shouldBe "failed"
        awaitCompleted(submitted)
        assertExactlyOneTerminalPublished(h, "failed")
        withClue("the terminal write really failed (run left non-terminal): ")(runStatus(fx.pid).foreach(s => isTerminalStatus(s) shouldBe false))
      }
    }

    "publish exactly one `succeeded` event and complete submit even when the terminal write fails" in {
      val fx = seed(withRootOutput = true)
      val h  = harness(fx.pid)
      withFailingTerminalUpdate(fx.pid) {
        val submitted = h.service.submit(fx.pid, isDry = false, fx.owner)
        await(h.entered.future)
        h.gate.success(())
        val ev = h.sub.awaitTerminal()
        ev.status shouldBe "succeeded"
        awaitCompleted(submitted)
        assertExactlyOneTerminalPublished(h, "succeeded")
        withClue("the terminal write really failed (run left non-terminal): ")(runStatus(fx.pid).foreach(s => isTerminalStatus(s) shouldBe false))
      }
    }
  }
}
