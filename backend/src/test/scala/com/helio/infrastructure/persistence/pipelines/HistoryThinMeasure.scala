package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.UserTier
import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.OldSingleStatementThin
import org.flywaydb.core.Flyway
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.{Duration, Instant}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1435 measurement driver (NOT a spec; run by hand with `sbt "Test/runMain ...HistoryThinMeasure <mode> ..."`).
 *  It only ever talks to the literal JDBC URL it is given, which must be the local `hel1435` scratch container; it
 *  reads no environment and no `.env`. Output lines start with `@@` and are committed raw under `evidence/`.
 *
 *  Modes (url = jdbc:postgresql://127.0.0.1:55435/helio_hel1435_scratch or a clone):
 *   migrate <url>
 *   dry-new <url> <tag> <batchOutputs> <batchRows> <samples> <reps>   one batch at a time inside BEGIN..ROLLBACK
 *   drain-new <url> <tag> <batchOutputs> <batchRows> <maxBatches>     real thinPass loop to completion, committed
 *   drain-old <url> <tag>                                             verbatim old statements, one committed txn
 *  `now` is the scratch seed anchor (`perf_anchor.t`), pinned for every mode. */
object HistoryThinMeasure {

  private val policy = HistoryThinningPolicy()
  private val caps: Map[UserTier, Duration] =
    Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))
  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 6.hours)

  private def open(url: String): JdbcBackend.Database =
    JdbcBackend.Database.forURL(url, user = "postgres", driver = "org.postgresql.Driver", executor = AsyncExecutor("hel1435", 1, 1, 100, 1))

  private def anchor(db: JdbcBackend.Database): Instant =
    await(db.run(sql"SELECT (SELECT t FROM perf_anchor)".as[Timestamp].head)).toInstant

  private def lsn(): DBIO[String] = sql"SELECT pg_current_wal_insert_lsn()::text".as[String].head
  private def walDiff(a: String, b: String): DBIO[Long] = sql"SELECT pg_wal_lsn_diff($b::pg_lsn, $a::pg_lsn)::bigint".as[Long].head
  private def ms(from: Long): Double = (System.nanoTime() - from) / 1e6

  def main(args: Array[String]): Unit = {
    require(args.length >= 2 && args(1).startsWith("jdbc:postgresql://127.0.0.1:55435/"), "refusing: url must be the local hel1435 container")
    args(0) match {
      case "migrate" =>
        val r = Flyway.configure().dataSource(args(1), "postgres", "").locations("classpath:db/migration").load().migrate()
        println(s"@@RESULT migrations=${r.migrationsExecuted} success=${r.success} target=${r.targetSchemaVersion}")
      case "dry-new"   => dryNew(args)
      case "drain-new" => drainNew(args)
      case "drain-old" => drainOld(args)
      case other       => sys.error(s"unknown mode $other")
    }
  }

  // ---- dry-new: per-batch statements in BEGIN..ROLLBACK -------------------------------------------------------
  private final case class Rolled(stats: String) extends Exception

  private def dryNew(args: Array[String]): Unit = {
    val Array(_, url, tag, bo, br, samples, reps) = args
    val (n, r, k, reps_) = (bo.toInt, br.toInt, samples.toInt, reps.toInt)
    require(url.endsWith("helio_hel1435_scratch") || url.contains("hel1435"), "scratch only")
    val db  = open(url)
    val now = anchor(db)
    println(s"@@DRY tag=$tag now=$now batchOutputs=$n batchRows=$r")
    // Pristine-state batch chain: admission only (reads), so batch k here is exactly the real cycle's batch k.
    def chain(cursor: Option[String], acc: Vector[Vector[String]]): Vector[Vector[String]] = {
      val ids = await(db.run(HistoryThinBatching.candidates(cursor, n)))
      if (ids.isEmpty) acc
      else {
        val (batch, early) = await(db.run(HistoryThinBatching.admit(ids, r)))
        val next = acc :+ batch
        if (early || ids.size >= n) chain(Some(batch.last), next) else next
      }
    }
    val t0 = System.nanoTime()
    val batches = chain(None, Vector.empty)
    println(f"@@CHAIN tag=$tag batches=${batches.size} outputs=${batches.map(_.size).sum} chain_ms=${ms(t0)}%.1f")
    val picks = if (batches.size <= k) batches.indices else (0 until k).map(i => i * (batches.size - 1) / math.max(k - 1, 1)).distinct
    for (bi <- picks; mode <- Seq("explain", "timed"); rep <- 1 to reps_) {
      val batch = batches(bi)
      val csv   = batch.mkString(",") // scratch ids ('o123') contain no comma
      val rows  = await(db.run(sql"SELECT count(*) FROM output_snapshot_history WHERE output_id = ANY(string_to_array($csv, ','))".as[Int].head))
      var tAdmit, tAge, tThin = 0.0
      var aged, thinned = 0
      val label = s"hel1435-$tag-b$bi-$mode-r$rep"
      val explainOn = if (mode == "explain") "3" else "-1" // ms: logs the age/thin plans and any slow admission count, not every sub-ms count
      val work: DBIO[Unit] = for {
        _  <- sql"SELECT set_config('application_name', $label, true)".as[String].head
        _  <- sql"SELECT set_config('auto_explain.log_min_duration', $explainOn, true)".as[String].head
        l0 <- lsn()
        t  = System.nanoTime()
        _  <- sql"SELECT pg_try_advisory_xact_lock(${OutputHistoryRepository.PurgeAdvisoryLockKey})".as[Boolean].head
        c  <- HistoryThinBatching.candidates(if (bi == 0) None else Some(batches(bi - 1).last), n)
        a  <- HistoryThinBatching.admit(c, r)
        _  = tAdmit = ms(t)
        t1 = System.nanoTime()
        ag <- HistoryThinBatching.ageDelete(now, caps, a._1)
        _  = { aged = ag; tAge = ms(t1) }
        t2 = System.nanoTime()
        th <- HistoryThinBatching.thin(now, policy, 101, a._1)
        _  = { thinned = th; tThin = ms(t2) }
        l1 <- lsn()
        w  <- walDiff(l0, l1)
        total = ms(t)
        _  = println(f"@@BATCH tag=$tag batch=$bi mode=$mode rep=$rep outputs=${batch.size} history_rows=$rows admit_ms=$tAdmit%.1f age_ms=$tAge%.1f thin_ms=$tThin%.1f lock_hold_ms=$total%.1f age_deleted=$aged thin_deleted=$thinned wal_bytes=$w admitted_same=${a._1 == batch}")
        _  <- DBIO.failed(Rolled("rollback"))
      } yield ()
      try await(db.run(work.transactionally)) catch { case _: Rolled => () }
    }
    db.close()
  }

  // ---- drain-new: the real code, committed ---------------------------------------------------------------------
  private def drainNew(args: Array[String]): Unit = {
    val Array(_, url, tag, bo, br, mb) = args
    val db   = open(url)
    val now  = anchor(db)
    val repo = new OutputHistoryRepository(new DbContext(db, db))
    val limits = ThinBatchLimits(bo.toInt, br.toInt, mb.toInt)
    println(s"@@DRAIN tag=$tag now=$now limits=$limits")
    var cursor: Option[String] = None
    var pass = 0
    var total = 0
    var done = false
    val start = System.nanoTime()
    while (!done) {
      pass += 1
      val l0 = await(db.run(lsn())); val startedMs = System.currentTimeMillis(); val t = System.nanoTime()
      val out = await(repo.thinPass(now, policy, caps, limits, cursor))
      val dur = ms(t); val endedMs = System.currentTimeMillis()
      val w = await(db.run(lsn().flatMap(l1 => walDiff(l0, l1))))
      val (kind, deleted) = out match {
        case HistoryPassOutcome.Completed(d)    => done = true; ("completed", d)
        case HistoryPassOutcome.MoreWork(d, at) => cursor = Some(at); ("more", d)
        case HistoryPassOutcome.LockHeld(d, _)  => done = true; ("LOCKHELD", d)
      }
      total += deleted
      println(f"@@PASS tag=$tag pass=$pass outcome=$kind deleted=$deleted ms=$dur%.1f wal_bytes=$w start_epoch_ms=$startedMs end_epoch_ms=$endedMs")
    }
    println(f"@@DRAINED tag=$tag passes=$pass total_deleted=$total wall_ms=${ms(start)}%.1f")
    db.close()
  }

  // ---- drain-old: today's statements, one committed transaction ------------------------------------------------
  private def drainOld(args: Array[String]): Unit = {
    val Array(_, url, tag) = args
    val db  = open(url)
    val now = anchor(db)
    println(s"@@OLD tag=$tag now=$now")
    val startedMs = System.currentTimeMillis(); val t = System.nanoTime()
    val l0 = await(db.run(lsn()))
    val deleted = await(db.run(
      (sql"SELECT pg_try_advisory_xact_lock(${OutputHistoryRepository.PurgeAdvisoryLockKey})".as[Boolean].head
        .flatMap(_ => OldSingleStatementThin.run(now, policy, caps, 101))).transactionally))
    val dur = ms(t); val endedMs = System.currentTimeMillis()
    val w = await(db.run(lsn().flatMap(l1 => walDiff(l0, l1))))
    println(f"@@OLDDONE tag=$tag deleted=$deleted ms=$dur%.1f wal_bytes=$w start_epoch_ms=$startedMs end_epoch_ms=$endedMs")
    db.close()
  }
}
