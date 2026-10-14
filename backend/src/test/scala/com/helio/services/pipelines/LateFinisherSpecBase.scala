package com.helio.services.pipelines

import com.helio.api.routes.pipelines.{PipelineRunRegistry, RunStatusEvent}
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionBackend, PipelineExecutionOutcome}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, NodeSnapshotRepository, OutputRepository, PipelineRunRepository}
import spray.json.JsObject
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.spark.PipelineRunCache
import com.helio.testsupport.NodePayloadFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._
import scala.util.{Failure, Try}

/** Shared fixture for the late-finisher specs (HEL-1518 / HEL-1544 / HEL-1564): the seams that force interleavings
 *  (backend wrapper after the engine, Output-list hook, gated/observed terminal write, snapshot and binary-reference
 *  wrappers) and the seed/count/submit helpers. Healthy fixture: two materialized nodes (a step node with an opted-in
 *  payload Output, and a root node), history on. */
abstract class LateFinisherSpecBase extends AnyWordSpec with Matchers with BeforeAndAfterAll with BeforeAndAfterEach with NodePayloadFixtures {

  override protected def harnessEc: ExecutionContext = ExecutionContext.global
  protected implicit val ec: ExecutionContext          = harnessEc
  protected implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "late-finisher-run-spec")
  protected val mat: Materializer = Materializer(typedSystem.classicSystem)

  @volatile protected var afterEngine: () => Future[Unit]  = () => Future.unit
  @volatile protected var beforeNodeFold: () => Future[Unit] = () => Future.unit
  @volatile protected var beforeOutputList: () => Future[Unit] = () => Future.unit

  protected final class HookBackend(delegate: PipelineExecutionBackend) extends PipelineExecutionBackend {
    override def supportsWriteBack: Boolean = delegate.supportsWriteBack
    override def execute(
        pipeline: Pipeline, roots: Vector[(String, DataSource)], steps: Vector[PipelineStep], dataSourceRepo: DataSourceRepository,
        assertionSink: AssertionSink, truncationSink: TruncationSink, onNodeProgress: (NodeKey, Long) => Unit = (_, _) => (),
        writeBackSink: WriteBackSink = new WriteBackSink, ownerUserId: Option[String] = None
    )(implicit ec: ExecutionContext): Future[PipelineExecutionOutcome] = {
      // HEL-1565: bind the hook at call start -- a call outliving its test must not run the NEXT test's hook.
      val hook = afterEngine
      delegate.execute(pipeline, roots, steps, dataSourceRepo, assertionSink, truncationSink, onNodeProgress, writeBackSink, ownerUserId)
        .flatMap(outcome => hook().map(_ => outcome))
    }
  }

  /** `beforeOutputList` fires once BEFORE the success chain lists the pipeline's Outputs (a pipeline deleted there has
   *  already lost its Outputs to the cascade, so no node guard ever runs). `beforeNodeFold` fires once right AFTER the
   *  list (after the early open-check, before the first node's write), so a pipeline deleted there still has its
   *  stale Output list and the node guard is what catches it. */
  protected final class HookOutputRepo(c: DbContext) extends OutputRepository(c) {
    override def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[Output]] = {
      val before = beforeOutputList
      beforeOutputList = () => Future.unit
      val hook = beforeNodeFold
      beforeNodeFold = () => Future.unit
      before().flatMap(_ => super.listByPipelineInternal(pipelineId)).flatMap(outputs => hook().map(_ => outputs))
    }
  }

  /** The success chain starts its own `succeeded` terminal write EAGERLY, concurrently with the node fold, so a hook that
   *  must land before it has to hold it back: `terminalGate` (open by default) delays that one write. */
  @volatile protected var terminalGate: Future[Unit] = Future.unit
  /** Completed once the run's own terminal write has returned (committed or lost), so a hook can wait for it. */
  @volatile protected var terminalWritten: Promise[Unit] = Promise[Unit]()
  protected final class GatedRunRepo(c: DbContext) extends PipelineRunRepository(c) {
    override def updateRunTerminal(
        runId: PipelineRunId, status: String, completedAt: Instant, rowCount: Option[Int], errorLog: Option[String],
        user: AuthenticatedUser, truncatedReadsJson: Option[String]
    ): Future[Boolean] = {
      val gate    = terminalGate
      val written = terminalWritten // HEL-1565: bound at call start, so a late write completes ITS test's promise only
      gate.flatMap(_ => super.updateRunTerminal(runId, status, completedAt, rowCount, errorLog, user, truncatedReadsJson))
        .andThen { case _ => written.trySuccess(()) }
    }
  }

  /** HEL-1564 seams. `afterNodeWrite(n)` runs right after the n-th node's snapshot transaction COMMITTED (the fold waits
   *  on it); `foldDone` is completed once every node write has committed. */
  @volatile protected var afterNodeWrite: Int => Future[Unit] = _ => Future.unit
  @volatile protected var foldDone: Promise[Unit]             = Promise[Unit]()
  /** Per-test counter: replaced (not `set(0)`) by [[resetSeams]] so a seam call can capture ITS test's counter. */
  @volatile protected var nodeWrites: AtomicInteger           = new AtomicInteger(0)
  /** HEL-1594: completed when a node write FAILS (the chain's failure point), whatever the error; the error itself is re-failed unchanged. */
  @volatile protected var nodeWriteFailed: Promise[Unit]      = Promise[Unit]()
  protected final class HookSnapshotRepo(c: DbContext) extends NodeSnapshotRepository(c) {
    override def overwriteRowsWith(
        pipelineId: String, nodeStepId: Option[String], rows: Seq[JsObject], explicitRootId: Option[String],
        andThen: DBIO[Unit], guard: Option[DBIO[Unit]] = None
    ): Future[Unit] = {
      // HEL-1565: per-test state bound at call start, never re-read after the transaction commits.
      val counter = nodeWrites
      val fold    = foldDone
      val hook    = afterNodeWrite
      val failed  = nodeWriteFailed
      super.overwriteRowsWith(pipelineId, nodeStepId, rows, explicitRootId, andThen, guard).andThen { case Failure(_) => failed.trySuccess(()) }.flatMap { _ =>
        val n = counter.incrementAndGet()
        if (n == 2) fold.trySuccess(())
        hook(n)
      }
    }
  }

  /** `beforeBinaryWrite` runs when the success chain reaches its (eager) binary-reference upsert; the upsert is then a
   *  REAL `binary_refs` insert for `binaryTarget` -- a genuine foreign-key violation when that pipeline is gone or unknown. */
  @volatile protected var beforeBinaryWrite: () => Future[Unit] = () => Future.unit
  @volatile protected var binaryTarget: (String, String)         = ("", "")
  /** HEL-1594: `binaryEntered` is completed when the upsert is reached, `binarySettled` once it has settled (success or failure). */
  @volatile protected var binaryEntered: Promise[Unit]           = Promise[Unit]()
  @volatile protected var binarySettled: Promise[Unit]           = Promise[Unit]()
  protected final class HookBinaryRepo(c: DbContext) extends BinaryRefRepository(c) {
    override def overwriteForNode(pipelineId: String, nodeStepId: Option[String], refs: Vector[BinaryRef], explicitRootId: Option[String]): Future[Unit] = {
      val (pid, step) = binaryTarget
      val ref = BinaryRef(UUID.randomUUID().toString, pid, Some(step), 0, "f", "k", "image/png", "f.png", 1L, Instant.now())
      val entered = binaryEntered // HEL-1565: bound at call start
      val settled = binarySettled
      entered.trySuccess(())
      beforeBinaryWrite().flatMap(_ => super.overwriteForNode(pid, Some(step), Vector(ref), None)).andThen { case _ => settled.trySuccess(()) }
    }
  }

  protected val registry = new PipelineRunRegistry()
  protected val events   = new ConcurrentLinkedQueue[(String, RunStatusEvent)]()

  override def beforeAll(): Unit = {
    startHarness()
    // The harness grants the app role tables only; `PipelineRepository.delete` calls the HEL-1498 panel-lock function.
    awaitDb(db.run(sqlu"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO helio_app_test_output_history"))
  }
  override def afterAll(): Unit  = { stopHarness(); typedSystem.terminate() }
  /** The one definition of the per-test seam reset: `afterEach` calls it, and [[LateFinisherSeamIsolationSpec]] calls it
   *  to simulate a test boundary while a seam call is still in flight. */
  protected def resetSeams(): Unit = {
    afterEngine = () => Future.unit
    beforeNodeFold = () => Future.unit
    beforeOutputList = () => Future.unit
    terminalGate = Future.unit
    terminalWritten = Promise[Unit]()
    afterNodeWrite = _ => Future.unit
    foldDone = Promise[Unit]()
    nodeWrites = new AtomicInteger(0)
    beforeBinaryWrite = () => Future.unit
    binaryTarget = ("", "")
    binaryEntered = Promise[Unit]()
    binarySettled = Promise[Unit]()
    nodeWriteFailed = Promise[Unit]()
  }
  override def afterEach(): Unit = {
    resetSeams()
    super.afterEach()
  }

  protected def service(hookedSnapshots: Boolean = false, binaryRefs: BinaryRefRepository = null): PipelineRunService = {
    val fs = new LocalFileSystem(Paths.get("/"))
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new GatedRunRepo(ctx), new PipelineRunCache(), registry, fs,
      executionBackend = new HookBackend(new InProcessExecutionBackend(new InProcessPipelineEngine(fs), stepRepo)),
      outputRepo = new HookOutputRepo(ctx), nodeSnapshotRepo = if (hookedSnapshots) new HookSnapshotRepo(ctx) else snapshotRepo, outputHistoryRepo = historyRepo,
      binaryRefRepo = binaryRefs, nodePayloadRepo = payloadRepo, payloadConfig = payloadConfig
    )
  }

  protected final case class Fx(owner: String, p: PayloadFx) { def pid: PipelineId = p.pid }

  /** Beta owner (payloads on), a step node with an opted-in Output, plus a root-bound Output: two materialized nodes. */
  protected def seed(): Fx = {
    val owner = seedUser("beta")
    val p     = seedPayloadPipeline(owner)
    awaitDb(outputRepo.insertInternal(p.pid, None, UserId(owner), "root-out", OutputKind.Table, explicitRootId = Some(PipelineRootId(p.pid.value))))
    Fx(owner, p)
  }

  protected def scalar(sqlText: String): String =
    awaitDb(db.run(sql"#$sqlText".as[String].head))
  protected def count(table: String, col: String, id: String): Int =
    scalar(s"SELECT count(*) FROM $table WHERE $col = '$id'").toInt
  protected def runStatus(fx: Fx): String = scalar(s"SELECT status FROM pipeline_runs WHERE pipeline_id = '${fx.pid.value}'")

  /** The real reaper statement, with `now` two hours ahead so the (heartbeat-less or heartbeat-stamped) open run is stale. */
  protected def reapIds(): Future[Vector[String]] =
    runRepo.reapStaleRunsInternal(Instant.now().plusSeconds(7200), 600L, 3600L, PipelineRunService.EmptyTruncationJson).map(_.map(_.runId.value))
  protected def reapAll(): Future[Unit] = reapIds().map(_ => ())

  protected def deletePipeline(fx: Fx): Future[Unit] =
    pipelineRepo.delete(fx.pid, AuthenticatedUser(UserId(fx.owner))).map(deleted => require(deleted, "fixture pipeline was not deleted"))

  protected def submit(fx: Fx) = {
    val sub = registry.subscribe(fx.pid.value).runWith(Sink.foreach[RunStatusEvent](e => events.add(fx.pid.value -> e)))(mat)
    val res = awaitDb(service().submit(fx.pid, isDry = false, AuthenticatedUser(UserId(fx.owner))))
    (res, sub)
  }

  /** Like [[submit]] for the HEL-1564 wiring (hooked snapshot + binary-reference repos); a failed Future is returned, not thrown. */
  protected def submitWith(fx: Fx, binary: Boolean = true): Try[Either[ServiceError, _]] = Try(Await.result(submitAsync(fx, binary), 60.seconds))

  /** Non-blocking [[submitWith]] (HEL-1594): the caller owns the wait, so it can observe the answer NOT having arrived. */
  protected def submitAsync(fx: Fx, binary: Boolean = true): Future[Either[ServiceError, _]] = {
    registry.subscribe(fx.pid.value).runWith(Sink.foreach[RunStatusEvent](e => events.add(fx.pid.value -> e)))(mat)
    service(hookedSnapshots = true, binaryRefs = if (binary) new HookBinaryRepo(ctx) else null).submit(fx.pid, isDry = false, AuthenticatedUser(UserId(fx.owner)))
  }

  protected def eventsOf(fx: Fx): Vector[String] = {
    Thread.sleep(300) // delivery to the subscriber is asynchronous; absence needs a settle window
    events.asScala.collect { case (p, e) if p == fx.pid.value => e.status }.toVector
  }

  /** Positive check: poll (bounded) until the run's `succeeded` event arrives, rather than trust a fixed settle window. */
  protected def awaitSucceeded(fx: Fx): Boolean = {
    val deadline = System.nanoTime() + 15.seconds.toNanos
    def seen = events.asScala.exists { case (p, e) => p == fx.pid.value && e.status == "succeeded" }
    while (!seen && System.nanoTime() < deadline) Thread.sleep(20)
    seen
  }

  protected def nothingWritten(fx: Fx): Unit = {
    count("node_snapshots", "pipeline_id", fx.pid.value) shouldBe 0
    count("output_snapshot_history", "pipeline_id", fx.pid.value) shouldBe 0
    count("node_payload_history", "pipeline_id", fx.pid.value) shouldBe 0
  }
}
