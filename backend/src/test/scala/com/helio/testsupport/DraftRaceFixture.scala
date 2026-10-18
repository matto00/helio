package com.helio.testsupport

import com.helio.api.protocols.pipelines.{DraftSaveRequest, DraftSaveResponse}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.LockSite
import com.helio.services.ServiceError
import com.helio.services.pipelines.draft.{DraftHookPoint, DraftSaveHooks}
import org.postgresql.util.PSQLException
import slick.dbio.DBIO
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.sql.Connection
import java.util.concurrent.atomic.AtomicInteger
import scala.annotation.tailrec
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.util.{Failure, Success, Try}

/** Which transaction was open first. */
sealed trait RaceOrder
case object WriterFirst extends RaceOrder
case object SaveFirst extends RaceOrder
/** A set-reading writer (a source delete, a teardown), a set-growing writer (a root add) and the save, in the round-3
 *  interleaving: the reader reads its set, the grower commits into it, the save compares and parks, the reader resumes. */
case object ThreeSession extends RaceOrder

/** A writer of fingerprinted state, exercised through its REAL production method. `protectedBy` are the protocol lock sites
 *  whose removal must turn the race into a violation (the spec's recorded mutation). */
final case class RaceWriter(
    name: String,
    protectedBy: Set[LockSite],
    run: (DraftSaveHarness, DraftSaveSeed) => Future[Any],
    prepare: DraftSaveSeed => Unit = _ => (),
    // False for a writer whose commit leaves the save nothing it could wrongly succeed at (a pipeline delete): removing the
    // lock cannot make the save return 200, so there is no G1 breach to show; its mutation is in the deadlock spec.
    hasViolationControl: Boolean = true,
    // Whether a COMPLETED run actually changed state: a teardown that refuses, or a delete that found nothing, committed no change.
    didWrite: Try[Any] => Boolean = _.isSuccess,
    // The draft the save runs with when the default one-config-change draft would not exercise the interleaving.
    draft: Option[(DraftSaveSeed, String, JsObject) => JsObject] = None,
    // The stored state must equal the outcome of ONE of the two serial orders, not merely avoid a fingerprint violation. When
    // the save committed (200) AND the writer succeeded, the only serial order is save-then-writer; this returns whether the
    // stored state is that outcome. A writer that derives its write from a row it read before its lock fails this, and so does one that fails instead of completing.
    serialCheck: Option[(DraftSaveSeed, String => Vector[String]) => Boolean] = None
)

/** What one choreographed race did. `violation` is the G1 breach: the save returned 200 although the writer committed a
 *  change to fingerprinted state between the save's fingerprint compare and its commit. `blockedObserved` records that
 *  Postgres itself (`pg_blocking_pids`) showed one transaction waiting on the other, so a green race is not green by luck. */
final case class RaceOutcome(
    order: RaceOrder,
    saveResult: Either[ServiceError, DraftSaveResponse],
    writerResult: Try[Any],
    violation: Boolean,
    deadlock: Boolean,
    blockedObserved: Boolean,
    trace: Vector[String]
) {
  def saveCommitted: Boolean = saveResult.isRight
  def saveStale: Boolean     = saveResult.left.exists(_.isInstanceOf[ServiceError.PatchSetStale])
  override def toString: String = s"RaceOutcome($order, save=${saveResult.fold(_.toString.take(80), _ => "200")}, writer=${writerResult.fold(_.toString.take(120), _ => "ok")}, violation=$violation, deadlock=$deadlock, blockedObserved=$blockedObserved)\n  " + trace.mkString("\n  ")
}

/** The two-connection race choreography of HEL-1629 task 6.3: a writer and a draft save are run on separate connection pools
 *  (separate Postgres backends, each tagged by `application_name`), and Postgres's own `pg_locks` / `pg_blocking_pids`
 *  decide when each is where, never a sleep.
 *
 *  A statement-level `AFTER` trigger on every table a writer touches blocks on a shared advisory lock the coordinator holds
 *  (the GATE), except inside the save (it sets `race.exempt`). That holds a writer's transaction OPEN right after its first
 *  write, with the locks it took so far. The save is parked, through its own hook seam, after the lock protocol and the
 *  fingerprint compare and BEFORE any write. The violation oracle:
 *   - WriterFirst: the writer holds its transaction open; the save starts. Protected, the save waits behind the writer and
 *     then answers 409. Unprotected, the save parks past the compare; the gate opens; the writer commits while the save is
 *     parked; the save then commits: the writer's change landed inside the save's window.
 *   - SaveFirst: the save parks past the compare; the writer starts. Protected, the writer waits behind the save. Unprotected,
 *     the writer commits while the save is parked.
 *  `40P01` is a failure in every case.
 *
 *  Every wait that decides a verdict is a condition wait bounded only by `HangGuardMs`; its expiry fails the test as a harness
 *  fault (HEL-1654), and "parked" is confirmed from Postgres (`idle in transaction`) as well as from the hook's promise. */
abstract class DraftRaceFixture extends DraftSaveApiFixture {

  protected val GateKey: Long = 7770001L
  private val GatedTables = Vector(
    "panels", "dashboards", "alert_rules", "pipeline_steps", "outputs", "pipeline_roots", "pipeline_schedules", "pipelines",
    "data_sources", "dataset_rows", "output_snapshot_history", "alert_events"
  )

  override def beforeAll(): Unit = {
    super.beforeAll()
    exec(
      s"""CREATE OR REPLACE FUNCTION race_gate() RETURNS trigger LANGUAGE plpgsql AS $$$$
         |BEGIN
         |  IF current_setting('race.exempt', true) IS DISTINCT FROM '1' THEN PERFORM pg_advisory_xact_lock_shared($GateKey); END IF;
         |  RETURN NULL;
         |END $$$$""".stripMargin
    )
    GatedTables.foreach(t => exec(s"CREATE TRIGGER race_gate_$t AFTER INSERT OR UPDATE OR DELETE ON $t FOR EACH STATEMENT EXECUTE FUNCTION race_gate()"))
  }

  private final class RaceSaveHooks(parkAfter: Option[LockSite]) extends DraftSaveHooks {
    val backendPid = Promise[Int]()
    val parked     = Promise[Unit]()
    val release    = Promise[Unit]()
    @volatile var failure: Option[Throwable] = None
    def at(point: DraftHookPoint): DBIO[Unit] = point match {
      case DraftHookPoint.Begin =>
        sql"SELECT set_config('race.exempt','1',true)".as[String].andThen(sql"SELECT pg_backend_pid()".as[Int].head).map(pid => { backendPid.trySuccess(pid); () })
      case DraftHookPoint.AfterCompare if parkAfter.isEmpty => park
      case DraftHookPoint.AfterLock(site) if parkAfter.contains(site) => park
      case _ => DBIO.successful(())
    }
    /** `parked` completes when this DBIO EXECUTES, never when it is built: production composes some `AfterLock(site)` hooks
     *  eagerly (`PipelineDraftWrites.lockDefinition` builds them all up front), so a signal raised at construction would
     *  declare the save parked before it had taken a single lock (HEL-1654). Slick runs a transaction's actions in order,
     *  so by the time this runs every earlier statement, the site's lock included, has returned. */
    private def park: DBIO[Unit] = DBIO.successful(()).flatMap { _ => parked.trySuccess(()); DBIO.from(release.future) }
    override def failed(ex: Throwable): Unit = failure = Some(ex)
  }

  private final class Gate {
    private val conn: Connection = superDb.createSession().conn
    def close(): Unit = { release(); conn.close() }
    def hold(): Unit = { val st = conn.createStatement(); try st.execute(s"SELECT pg_advisory_lock($GateKey)") finally st.close() }
    def release(): Unit = { val st = conn.createStatement(); try st.execute(s"SELECT pg_advisory_unlock_all()") finally st.close() }
  }

  private def waitFor(timeoutMs: Long)(cond: => Boolean): Boolean = {
    val deadline = System.nanoTime() + timeoutMs * 1000000L
    while (!cond && System.nanoTime() < deadline) Thread.sleep(25)
    cond
  }

  private def gateWaiters(): Vector[Int] =
    queryStrings(s"SELECT pid::text FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$GateKey AND NOT granted").map(_.toInt)

  private def blockers(pid: Int): Set[Int] = queryStrings(s"SELECT unnest(pg_blocking_pids($pid))::text").map(_.toInt).toSet

  /** Whether `pid` waits, directly or through a chain of waiters, on `target`. */
  private def waitsOn(pid: Int, target: Int): Boolean = {
    @tailrec def loop(frontier: Set[Int], seen: Set[Int]): Boolean = {
      val next = frontier.flatMap(blockers) -- seen
      if (next.contains(target)) true else if (next.isEmpty) false else loop(next, seen ++ next)
    }
    loop(Set(pid), Set(pid))
  }

  /** Every non-idle backend tagged `application` (a participant runs on two pools, so more than one can be live). */
  private def activeBackends(application: String): Vector[Int] =
    queryStrings(s"SELECT pid::text FROM pg_stat_activity WHERE application_name='$application' AND state<>'idle'").map(_.toInt)

  /** Whether any live backend tagged `application` waits, directly or through a chain, on `target`. */
  private def anyWaitsOn(application: String, target: Int): Boolean = activeBackends(application).exists(waitsOn(_, target))

  /** The upper bound of every wait that decides a verdict. A HANG GUARD, not a window: the green path returns the moment the
   *  decisive state is observed, and expiry is a harness failure (`harnessFail`), never read as "the writer did not block". */
  private val HangGuardMs = 60000L

  private def harnessFail(what: String, trace: Vector[String]): Nothing =
    fail(s"HARNESS: $what (no verdict is drawn)\n  " + trace.mkString("\n  "))

  /** The relation locks `pid` holds granted, as text, for the trace. */
  private def heldLocks(pid: Int): String =
    queryStrings(s"""SELECT DISTINCT c.relname FROM pg_locks l JOIN pg_class c ON c.oid=l.relation WHERE l.pid=$pid AND l.granted AND l.locktype='relation' AND c.relname IN ('panels','dashboards','pipelines','alert_rules','outputs') ORDER BY 1""").mkString(",")

  /** D3: cross-checks the promise against Postgres. A save that is really parked has run every statement up to its hook and
   *  holds its transaction open: `idle in transaction`. Anything else is a harness fault, not a verdict. */
  private def confirmParked(sPid: Int, label: String, note: String => Unit, trace: => Vector[String]): Unit = {
    def state: String = queryStrings(s"SELECT state FROM pg_stat_activity WHERE pid=$sPid").headOption.getOrElse("gone")
    if (!waitFor(HangGuardMs)(state == "idle in transaction"))
      harnessFail(s"save (backend $sPid) was declared parked $label but is '$state', not idle in transaction", trace)
    note(s"save (backend $sPid) is idle in transaction $label, holding relation locks on [${heldLocks(sPid)}]")
  }

  @tailrec private def sqlStateOf(t: Throwable, depth: Int = 0): Option[String] = t match {
    case e: PSQLException => Option(e.getSQLState)
    case e if e.getCause != null && depth < 10 => sqlStateOf(e.getCause, depth + 1)
    case _ => None
  }

  private def isDeadlock(t: Throwable): Boolean = sqlStateOf(t).contains("40P01")

  /** The draft every race saves: one config change, so the save has a write to make after its compare. */
  protected def raceDraft(seed: DraftSaveSeed, fingerprint: String, definition: JsObject): JsObject = {
    val d = draftOf(fingerprint, definition)
    withSteps(d, replacing(stepsOf(d), seed.t2)(s => set(s, "config", limit(22))))
  }

  /** A writer-first race is lost-update-free only if the save answers 409 (or 404 for a vanished pipeline): the client's base was
   *  read before the writer's transaction opened, so a 200 after the writer COMMITTED a change means the save overwrote or
   *  dropped it (a writer that commits only AFTER the save committed is a valid serialization, `writerCommittedFirst`). This catches a save that waited on the writer and then compared a fingerprint read BEFORE it locked (the
   *  evaluator's mutation D), which the "committed while parked" half of the oracle cannot see (C4: only locks taken
   *  before the fingerprint read protect). */
  private def lostUpdate(order: RaceOrder, writer: RaceWriter, writerResult: Try[Any], writerCommittedFirst: Boolean): Boolean =
    order == WriterFirst && writerCommittedFirst && writer.didWrite(writerResult)

  /** The save committed and the writer succeeded, yet the stored state is not save-then-writer: a lost update of the save's change
   *  by a writer that worked from a stale read (the class `lostUpdate` cannot see, because the writer WAITED correctly). */
  private def notSerial(writer: RaceWriter, writerResult: Try[Any], seed: DraftSaveSeed): Boolean =
    writer.serialCheck.exists(check => writerResult.isFailure || !check(seed, queryStrings))

  /** Runs one race on a fresh seed with the lock sites in `removed` switched off, for the given order. */
  protected def race(writer: RaceWriter, order: RaceOrder, removed: Set[LockSite] = Set.empty, parkAfter: Option[LockSite] = None): RaceOutcome = {
    val seed = seedPipeline()
    writer.prepare(seed)
    val actor = AuthenticatedUser(UserId(userA))
    val snapshot   = await(new DraftSaveHarness(ctx).service.read(PipelineId(seed.pipeline), actor, includeDefinition = true)).toOption.get
    val fingerprint = snapshot.fingerprint.get
    val definition  = snapshot.definition.get.asJsObject
    val request = writer.draft.fold(raceDraft(seed, fingerprint, definition))(f => f(seed, fingerprint, definition)).convertTo[DraftSaveRequest]
    val locks   = LocksWithout(removed)
    val savePools   = (newPool(Some("helio_app_test"), 3, Some("race-save")), newPool(Some("helio_privileged"), 3, Some("race-save")))
    val writerPools = (newPool(Some("helio_app_test"), 3, Some("race-writer")), newPool(Some("helio_privileged"), 3, Some("race-writer")))
    val hooks   = new RaceSaveHooks(parkAfter)
    val saveH   = new DraftSaveHarness(new DbContext(savePools._1, savePools._2), locks, hooks)
    val writerH = new DraftSaveHarness(new DbContext(writerPools._1, writerPools._2), locks)
    val gate    = new Gate
    val trace   = Vector.newBuilder[String]
    def note(s: String): Unit = trace += s
    val parkedAt = parkAfter.fold("past its compare")(site => s"after the $site lock")
    val completions = new AtomicInteger(0)
    val saveDone, writerDone = new AtomicInteger(Int.MaxValue)
    def startSave(): Future[Either[ServiceError, DraftSaveResponse]] = {
      val f = saveH.service.save(PipelineId(seed.pipeline), request, actor)
      f.onComplete(_ => saveDone.set(completions.incrementAndGet()))(ExecutionContext.parasitic)
      f
    }
    def startWriter(): Future[Any] = {
      val f = Try(writer.run(writerH, seed)).fold(Future.failed, identity)
      f.onComplete(_ => writerDone.set(completions.incrementAndGet()))(ExecutionContext.parasitic)
      f
    }
    try {
      var blockedObserved = false
      var committedWhileParked = false
      // Which transaction Postgres showed waiting on the other (WriterFirst). The commit ORDER is read from these, not from the order
      // the two Futures completed in: the save's Future completes after a few more steps than its commit, so a writer that waited
      // for the save can complete its Future first on a loaded runner (seen: HEL-1654, DraftSaveRaceSpec dashboard import).
      var saveWaitedOnWriter = false
      var writerWaitedOnSave = false
      val (sf, wf) = order match {
        case WriterFirst =>
          gate.hold()
          val w = startWriter()
          if (!waitFor(HangGuardMs)(gateWaiters().nonEmpty || w.isCompleted)) harnessFail("writer neither reached the gate nor finished", trace.result())
          if (w.isCompleted) note(s"writer finished before reaching the gate: ${w.value.get}")
          val wPid = gateWaiters().headOption
          note(s"writer held open at its first write (backend ${wPid.getOrElse("?")})")
          val s = startSave()
          val sPid = Await.result(hooks.backendPid.future, 15.seconds)
          val settled = waitFor(HangGuardMs)(hooks.parked.isCompleted || s.isCompleted || wPid.exists(w0 => waitsOn(sPid, w0)))
          if (!settled) harnessFail("save neither parked, waited nor finished", trace.result())
          if (wPid.exists(w0 => waitsOn(sPid, w0))) { blockedObserved = true; saveWaitedOnWriter = true; note(s"save (backend $sPid) is WAITING on the writer") }
          else if (hooks.parked.isCompleted) { note(s"save (backend $sPid) PARKED $parkedAt, holding no wait on the writer"); confirmParked(sPid, parkedAt, note, trace.result()) }
          else note("save finished early")
          gate.release()
          note("gate released: writer may commit")
          if (hooks.parked.isCompleted && !s.isCompleted) {
            var sawWaiting = false
            if (!waitFor(HangGuardMs) { if (wPid.exists(w0 => waitsOn(w0, sPid))) sawWaiting = true; w.isCompleted || sawWaiting })
              harnessFail("writer neither completed nor waited on the parked save", trace.result())
            if (sawWaiting) { blockedObserved = true; writerWaitedOnSave = true; note("writer is WAITING on the parked save") }
            committedWhileParked = w.isCompleted && w.value.exists(writer.didWrite)
            if (committedWhileParked) note("writer COMMITTED while the save was parked")
            hooks.release.trySuccess(())
          }
          (s, w)
        case SaveFirst =>
          val s = startSave()
          val sPid = Await.result(hooks.backendPid.future, 15.seconds)
          // A save that never parks means the choreography did not happen: the writer is NOT started and no verdict is drawn.
          if (!waitFor(HangGuardMs)(hooks.parked.isCompleted || s.isCompleted)) harnessFail("save neither parked nor finished; the writer was not started", trace.result())
          note(if (hooks.parked.isCompleted) s"save (backend $sPid) PARKED $parkedAt" else s"save finished before parking: ${s.value}")
          if (hooks.parked.isCompleted) confirmParked(sPid, parkedAt, note, trace.result())
          val w = startWriter()
          var sawWaiting = false
          if (!waitFor(HangGuardMs) { if (anyWaitsOn("race-writer", sPid)) sawWaiting = true; w.isCompleted || sawWaiting })
            harnessFail("writer neither completed nor waited on the parked save", trace.result())
          if (sawWaiting) { blockedObserved = true; note("writer is WAITING on the parked save") }
          committedWhileParked = w.isCompleted && w.value.exists(writer.didWrite)
          if (committedWhileParked) note("writer COMMITTED while the save was parked")
          hooks.release.trySuccess(())
          (s, w)
      }
      hooks.release.trySuccess(())
      val saveResult   = Try(Await.result(sf, 30.seconds)).fold(e => Left(ServiceError.InternalError(e.toString)), identity)
      val writerResult = Try(Await.result(wf, 30.seconds))
      note(s"save: ${saveResult.fold(_.toString.take(100), _ => "200 committed")}; writer: ${writerResult.fold(_.toString.take(140), _ => "ok")}")
      val deadlock = hooks.failure.exists(isDeadlock) || writerResult.failed.toOption.exists(isDeadlock)
      val writerCommittedFirst =
        if (saveWaitedOnWriter) true       // the save could not proceed until the writer's transaction ended
        else if (writerWaitedOnSave) false // the writer could not commit until the save's transaction ended
        else writerDone.get < saveDone.get // neither wait observed: the order the two Futures completed in
      note(s"commit order: ${if (saveWaitedOnWriter) "save waited on the writer" else if (writerWaitedOnSave) "writer waited on the save" else "no wait observed"}; futures completed save=${saveDone.get} writer=${writerDone.get}")
      RaceOutcome(order, saveResult, writerResult, violation = saveResult.isRight && (committedWhileParked || lostUpdate(order, writer, writerResult, writerCommittedFirst) || notSerial(writer, writerResult, seed)), deadlock = deadlock, blockedObserved = blockedObserved, trace = trace.result())
    } finally {
      hooks.release.trySuccess(())
      gate.close()
      Seq(savePools._1, savePools._2, writerPools._1, writerPools._2).foreach(_.close())
    }
  }

  /** The three-session race (HEL-1629 task 6.3b, C8). A transaction `blocker` holds `FOR KEY SHARE` on the source `X`
   *  (`seed.id("ds3")`), so the READER (a source delete or a teardown) stalls on its delete of `X`. Meanwhile the GROWER adds a
   *  root on `X` to the pipeline and COMMITS, the client reads its base (which includes that root), and the SAVE compares
   *  and parks. Then the blocker lets go and the reader resumes. If the reader read its set of pipelines BEFORE the grower
   *  committed, it cascades the grower's root away without ever having locked the pipeline: it commits inside the save's
   *  window. A reader that locks `X` first reads its set only after the blocker is gone, so the set includes the pipeline
   *  and it waits behind the save instead. */
  protected def race3(reader: RaceWriter, grower: RaceWriter, removed: Set[LockSite] = Set.empty): RaceOutcome = {
    val seed = seedPipeline()
    reader.prepare(seed); grower.prepare(seed)
    val locks   = LocksWithout(removed)
    val actor   = AuthenticatedUser(UserId(userA))
    val hooks   = new RaceSaveHooks(None)
    def pools(app: String) = (newPool(Some("helio_app_test"), 3, Some(app)), newPool(Some("helio_privileged"), 3, Some(app)))
    val (rA, rP) = pools("race-reader"); val (gA, gP) = pools("race-grower"); val (sA, sP) = pools("race-save")
    val readerH = new DraftSaveHarness(new DbContext(rA, rP), locks)
    val growerH = new DraftSaveHarness(new DbContext(gA, gP), locks)
    val saveH   = new DraftSaveHarness(new DbContext(sA, sP), locks, hooks)
    val blockerConn = superDb.createSession().conn
    val trace = Vector.newBuilder[String]
    def note(s: String): Unit = trace += s
    def lockWaiting(app: String): Boolean =
      queryStrings(s"SELECT 1 FROM pg_stat_activity WHERE application_name='$app' AND wait_event_type='Lock'").nonEmpty
    try {
      val source = seed.id("ds3")
      blockerConn.setAutoCommit(false)
      val st = blockerConn.createStatement(); try st.execute(s"SELECT 1 FROM data_sources WHERE id='$source' FOR KEY SHARE") finally st.close()
      note(s"blocker holds FOR KEY SHARE on $source")

      val d = Try(reader.run(readerH, seed)).fold(Future.failed, identity)
      if (!waitFor(HangGuardMs)(lockWaiting("race-reader") || d.isCompleted)) harnessFail("reader neither stalled nor finished", trace.result())
      note(if (d.isCompleted) s"reader finished without stalling: ${d.value.get}" else "reader STALLED on the source (it has read its set, if it reads one before locking)")

      val r = Try(grower.run(growerH, seed)).fold(Future.failed, identity)
      if (!waitFor(HangGuardMs)(r.isCompleted)) harnessFail("grower did not finish", trace.result())
      note(s"grower: ${r.value.fold("still running")(_.fold(e => s"FAILED $e", _ => "COMMITTED its root"))}")

      val snapshot = await(new DraftSaveHarness(ctx).service.read(PipelineId(seed.pipeline), actor, includeDefinition = true)).toOption.get
      val request  = raceDraft(seed, snapshot.fingerprint.get, snapshot.definition.get.asJsObject).convertTo[DraftSaveRequest]
      val s        = saveH.service.save(PipelineId(seed.pipeline), request, actor)
      val sPid     = Await.result(hooks.backendPid.future, 15.seconds)
      if (!waitFor(HangGuardMs)(hooks.parked.isCompleted || s.isCompleted)) harnessFail("save neither parked nor finished", trace.result())
      note(if (hooks.parked.isCompleted) s"save (backend $sPid) PARKED past its compare (its base includes the grower's root)" else s"save finished: ${s.value}")
      if (hooks.parked.isCompleted) confirmParked(sPid, "past its compare", note, trace.result())

      blockerConn.rollback()
      note("blocker released")
      var blockedObserved = false
      var committedWhileParked = false
      var sawWaiting = false
      if (!waitFor(HangGuardMs) { if (anyWaitsOn("race-reader", sPid)) sawWaiting = true; d.isCompleted || sawWaiting })
        harnessFail("reader neither completed nor waited on the parked save", trace.result())
      if (sawWaiting) { blockedObserved = true; note("reader is WAITING on the parked save") }
      committedWhileParked = hooks.parked.isCompleted && !s.isCompleted && d.isCompleted && d.value.exists(reader.didWrite)
      if (committedWhileParked) note("reader COMMITTED while the save was parked")
      hooks.release.trySuccess(())
      val saveResult   = Try(Await.result(s, 30.seconds)).fold(e => Left(ServiceError.InternalError(e.toString)), identity)
      val readerResult = Try(Await.result(d, 30.seconds))
      val growerResult = Try(Await.result(r, 30.seconds))
      note(s"save: ${saveResult.fold(_.toString.take(100), _ => "200 committed")}; reader: ${readerResult.fold(_.toString.take(140), r => s"ok ${r.toString.take(160)}")}; grower: ${growerResult.fold(_.toString.take(80), _ => "ok")}")
      val deadlock = hooks.failure.exists(isDeadlock) || readerResult.failed.toOption.exists(isDeadlock) || growerResult.failed.toOption.exists(isDeadlock)
      RaceOutcome(ThreeSession, saveResult, readerResult, violation = saveResult.isRight && committedWhileParked, deadlock = deadlock, blockedObserved = blockedObserved, trace = trace.result())
    } finally {
      hooks.release.trySuccess(())
      Try(blockerConn.rollback()); Try(blockerConn.close())
      Seq(rA, rP, gA, gP, sA, sP).foreach(_.close())
    }
  }

  /** Two WRITERS against each other, no save (HEL-1629 task 6.4): `first` runs to the gate, holding what it took before its
   *  first write; `second` starts and is observed waiting on it (or finishing); the gate opens. Used for pairs of
   *  participants whose lock orders must not form a cycle: a teardown against a source delete. */
  protected def duel(first: RaceWriter, second: RaceWriter, removed: Set[LockSite] = Set.empty): (Try[Any], Try[Any], Boolean, Boolean, Vector[String]) = {
    val seed = seedPipeline()
    first.prepare(seed); second.prepare(seed)
    val locks = LocksWithout(removed)
    def pools(app: String) = (newPool(Some("helio_app_test"), 3, Some(app)), newPool(Some("helio_privileged"), 3, Some(app)))
    val (aA, aP) = pools("race-writer"); val (bA, bP) = pools("race-second")
    val firstH  = new DraftSaveHarness(new DbContext(aA, aP), locks)
    val secondH = new DraftSaveHarness(new DbContext(bA, bP), locks)
    val gate    = new Gate
    val trace   = Vector.newBuilder[String]
    def note(s: String): Unit = trace += s
    try {
      gate.hold()
      val f = Try(first.run(firstH, seed)).fold(Future.failed, identity)
      if (!waitFor(HangGuardMs)(gateWaiters().nonEmpty || f.isCompleted)) harnessFail("first neither reached the gate nor finished", trace.result())
      val fPid = gateWaiters().headOption
      note(s"first held open at its first write (backend ${fPid.getOrElse("?")})")
      val sec = Try(second.run(secondH, seed)).fold(Future.failed, identity)
      var blocked = false
      if (!waitFor(HangGuardMs) { if (fPid.exists(fp => anyWaitsOn("race-second", fp))) blocked = true; sec.isCompleted || blocked })
        harnessFail("second neither completed nor waited on first", trace.result())
      note(if (blocked) "second is WAITING on first" else s"second ${if (sec.isCompleted) "finished" else "is running"} without waiting on first")
      gate.release()
      note("gate released")
      val fr = Try(Await.result(f, 30.seconds)); val sr = Try(Await.result(sec, 30.seconds))
      note(s"first: ${fr.fold(_.toString.take(120), _ => "ok")}; second: ${sr.fold(_.toString.take(120), _ => "ok")}")
      (fr, sr, fr.failed.toOption.exists(isDeadlock) || sr.failed.toOption.exists(isDeadlock), blocked, trace.result())
    } finally { gate.close(); Seq(aA, aP, bA, bP).foreach(_.close()) }
  }
}
