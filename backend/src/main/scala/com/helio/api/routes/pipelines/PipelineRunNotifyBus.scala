package com.helio.api.routes.pipelines

import org.postgresql.{PGConnection, PGNotification}
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.ByteBuffer
import java.nio.charset.{CharacterCodingException, CodingErrorAction, StandardCharsets}
import java.sql.{Connection, DriverManager}
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._
import scala.util.control.NonFatal

object PipelineRunNotifyBus {
  // HEL-1168 design.md D4: exactly ONE fixed, server-controlled channel name, never derived
  // from request input -- no code path lets a client choose or influence a channel name.
  val Channel = "pipeline_run_events"

  // HEL-1168 design.md D9: Postgres's hard NOTIFY payload limit is 8000 bytes, enforced on the
  // UTF-8-encoded BYTE length (not String.length/UTF-16 code units). errorLog is the only
  // unbounded field in a RunStatusEvent, so it alone is truncated to this many UTF-8 bytes
  // before encoding -- leaving headroom for originInstanceId/pipelineId/status/JSON structural
  // overhead within the 8000-byte total. This truncation applies ONLY to the cross-instance
  // NOTIFY payload; the originating instance's own local subscribers already received the
  // untruncated errorLog directly (PipelineRunRegistry.broadcastLocal runs before notifyRemote).
  val ErrorLogByteBudget = 4000
  private val TruncationMarker = "...[truncated]"

  private val InitialBackoff = 1.second
  private val MaxBackoff     = 30.seconds

  /** Truncate `s` to at most `maxBytes` UTF-8-encoded bytes, appending `TruncationMarker` when
   *  truncation actually happens. Trims at a valid UTF-8 boundary -- never splits a multi-byte
   *  sequence -- by decode-and-back-off rather than a raw byte-array slice, so CJK/emoji content
   *  (up to 4 bytes/char) truncates to a clean prefix instead of a corrupt trailing fragment. */
  private[pipelines] def truncateUtf8(s: String, maxBytes: Int): String = {
    val bytes = s.getBytes(StandardCharsets.UTF_8)
    if (bytes.length <= maxBytes) {
      s
    } else {
      val budget = math.max(0, maxBytes - TruncationMarker.getBytes(StandardCharsets.UTF_8).length)
      var end = math.min(budget, bytes.length)
      var decoded: String = null
      while (decoded == null && end >= 0) {
        val decoder = StandardCharsets.UTF_8
          .newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
        try {
          decoded = decoder.decode(ByteBuffer.wrap(bytes, 0, end)).toString
        } catch {
          case _: CharacterCodingException => end -= 1
        }
      }
      (if (decoded == null) "" else decoded) + TruncationMarker
    }
  }
}

/**
 * Cross-instance fan-out for pipeline run-status events, backed by Postgres LISTEN/NOTIFY
 * (HEL-1168 design.md D1-D4, D6-D9). One instance of this class is constructed per backend
 * process (`Main.scala`) and passed as `PipelineRunRegistry`'s nullable `eventBus` collaborator
 * -- a fixture/test that constructs a bare `PipelineRunRegistry()` with no bus gets pure
 * local-only broadcast, unchanged from before this change.
 *
 * Holds TWO separate database handles, deliberately:
 *   - `db` (the ordinary app-pool `JdbcBackend.Database`, already HikariCP-pooled) is used only
 *     to SEND: `notifyRemote` issues a short-lived `pg_notify` call on it. No dedicated
 *     connection is needed to send (design.md D7).
 *   - `dbUrl`/`dbUser`/`dbPassword` (the same plain, non-privileged `helio.db.*` credentials
 *     `Database.initApp` uses -- never `helio_privileged`; LISTEN/NOTIFY needs no table access
 *     and no BYPASSRLS) back exactly ONE raw `DriverManager` connection, held OUTSIDE both
 *     HikariCP pools for the lifetime of this instance, dedicated to LISTEN. Blocking on
 *     `getNotifications` is incompatible with pool checkout semantics, so this connection can
 *     never be a pooled one (design.md D2/D3).
 *
 * The LISTEN connection is opened synchronously in the constructor -- if the database is
 * unreachable at boot, construction throws and `Main.scala` fails loud at startup exactly like
 * its other required-at-boot dependencies, rather than silently degrading to local-only
 * broadcast (a silent single-instance fallback would reintroduce this exact ticket's bug
 * invisibly). The receive loop itself runs on a dedicated daemon `Thread` -- deliberately never
 * a Pekko actor-system dispatcher, since actor threads must never block (CONTRIBUTING.md) and
 * `getNotifications` is a blocking poll.
 */
final class PipelineRunNotifyBus(
    db: JdbcBackend.Database,
    dbUrl: String,
    dbUser: String,
    dbPassword: String
)(implicit ec: ExecutionContext) {
  import PipelineRunNotifyBus._

  private val log = LoggerFactory.getLogger(getClass)

  /** Random per-instance id (design.md D7) tagged onto every NOTIFY payload this instance sends.
   *  Postgres delivers a NOTIFY to every session currently LISTENing on the channel, including
   *  the sending instance's OWN dedicated connection -- the receive loop drops any notification
   *  whose originInstanceId matches this value, since this instance's local subscribers were
   *  already served synchronously by PipelineRunRegistry's local broadcast before notifyRemote
   *  ever runs. */
  val instanceId: String = UUID.randomUUID().toString

  private val handler = new AtomicReference[Option[(String, RunStatusEvent) => Unit]](None)

  @volatile private var running = true
  @volatile private var connection: Connection = openConnection()

  private val listenerThread = new Thread(() => runListenLoop(), "pipeline-run-notify-listener")
  listenerThread.setDaemon(true)
  listenerThread.start()

  /** Register the callback invoked for every REMOTE (non-self-originated) notification this
   *  instance receives. `PipelineRunRegistry` registers itself here from its own constructor
   *  (design.md D6) -- this class stays ignorant of `PipelineRunRegistry`'s existence, knowing
   *  only how to send/receive raw (pipelineId, RunStatusEvent) pairs. Only the most recently
   *  registered callback is retained; production wiring registers exactly one. */
  def onReceive(f: (String, RunStatusEvent) => Unit): Unit = handler.set(Some(f))

  /** Send `event` for `pipelineId` to every OTHER instance currently LISTENing on the shared
   *  channel. Uses Slick's parameterized `sql"..."` interpolation throughout -- `errorLog` and
   *  `pipelineId` content is never string-concatenated into the SQL text. */
  def notifyRemote(pipelineId: String, event: RunStatusEvent): Unit = {
    val payload = encodePayload(pipelineId, event)
    db.run(sql"SELECT pg_notify($Channel, $payload)".as[String])
      .failed
      .foreach { e =>
        log.warn("PipelineRunNotifyBus: failed to send pg_notify for pipeline {}", pipelineId, e)
      }
  }

  /** Stop the listener thread and close the dedicated connection. Best-effort JVM hygiene, not a
   *  correctness requirement (design.md D8) -- events are ephemeral, so a thread that never gets
   *  to close its connection before the process dies (Cloud Run's SIGTERM-then-kill teardown)
   *  causes no data loss. */
  def shutdown(): Unit = {
    running = false
    listenerThread.interrupt()
    closeQuietly()
  }

  private[pipelines] def encodePayload(pipelineId: String, event: RunStatusEvent): String = {
    val fields = scala.collection.mutable.LinkedHashMap[String, JsValue](
      "originInstanceId" -> JsString(instanceId),
      "pipelineId"       -> JsString(pipelineId),
      "status"           -> JsString(event.status)
    )
    event.rowCount.foreach(n => fields("rowCount") = JsNumber(n))
    event.errorLog.foreach(s => fields("errorLog") = JsString(truncateUtf8(s, ErrorLogByteBudget)))
    event.nodeId.foreach(s => fields("nodeId") = JsString(s))
    event.nodeKind.foreach(s => fields("nodeKind") = JsString(s))
    JsObject(fields.toMap).compactPrint
  }

  private def decodePayload(json: String): Option[(String, String, RunStatusEvent)] =
    try {
      val fields           = json.parseJson.asJsObject.fields
      val originInstanceId = fields("originInstanceId").convertTo[String]
      val pipelineId       = fields("pipelineId").convertTo[String]
      val status           = fields("status").convertTo[String]
      val event = RunStatusEvent(
        status   = status,
        rowCount = fields.get("rowCount").map(_.convertTo[Int]),
        errorLog = fields.get("errorLog").map(_.convertTo[String]),
        nodeId   = fields.get("nodeId").map(_.convertTo[String]),
        nodeKind = fields.get("nodeKind").map(_.convertTo[String])
      )
      Some((originInstanceId, pipelineId, event))
    } catch {
      case NonFatal(e) =>
        log.warn("PipelineRunNotifyBus: failed to decode NOTIFY payload: {}", json, e)
        None
    }

  private def openConnection(): Connection = {
    val conn = DriverManager.getConnection(dbUrl, dbUser, dbPassword)
    val stmt = conn.createStatement()
    try stmt.execute(s"LISTEN $Channel")
    finally stmt.close()
    conn
  }

  private def closeQuietly(): Unit = {
    try {
      val conn = connection
      if (conn != null && !conn.isClosed) conn.close()
    } catch {
      case NonFatal(_) => ()
    } finally {
      connection = null
    }
  }

  private def handleNotification(n: PGNotification): Unit =
    decodePayload(n.getParameter).foreach { case (originInstanceId, pipelineId, event) =>
      if (originInstanceId != instanceId) {
        handler.get().foreach(_.apply(pipelineId, event))
      }
    }

  /** Poll-based receive loop: each iteration either polls the open connection for up to one
   *  second (resetting backoff on any successful poll, whether or not it carried a
   *  notification), or -- once a poll has thrown, meaning the connection was lost -- attempts to
   *  reopen it with capped exponential backoff. A WARN is logged once when a lost-connection
   *  window opens and an INFO once when it closes on successful reconnect (design.md D8); a
   *  notification missed during that window is accepted (the pipeline-run-sse spec's existing
   *  ephemeral-events contract already tolerates a gap -- a terminal run status is always still
   *  observable on next reconnect/poll, since only an intermediate progress tick can be lost). */
  private def runListenLoop(): Unit = {
    var backoff = InitialBackoff
    try {
      while (running) {
        val conn = connection
        if (conn != null) {
          try {
            val notifications = conn.asInstanceOf[PGConnection].getNotifications(1000)
            if (notifications != null) notifications.foreach(handleNotification)
            backoff = InitialBackoff
          } catch {
            case NonFatal(e) =>
              if (running) {
                log.warn("PipelineRunNotifyBus: LISTEN connection lost, opening lost-connection window (instanceId={})", instanceId, e)
                closeQuietly()
              }
          }
        } else if (running) {
          try {
            connection = openConnection()
            log.info("PipelineRunNotifyBus: reconnected, closing lost-connection window (instanceId={})", instanceId)
            backoff = InitialBackoff
          } catch {
            case NonFatal(e) =>
              log.warn("PipelineRunNotifyBus: reconnect attempt failed, retrying in {} (instanceId={})", backoff, instanceId, e)
              try Thread.sleep(backoff.toMillis)
              catch { case _: InterruptedException => Thread.currentThread().interrupt() }
              backoff = (backoff * 2).min(MaxBackoff)
          }
        }
      }
    } finally {
      closeQuietly()
    }
  }
}
