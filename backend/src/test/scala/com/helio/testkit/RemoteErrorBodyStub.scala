package com.helio.testkit

import com.helio.domain.connectors.RemoteErrorText
import org.apache.pekko.NotUsed
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString

import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import scala.concurrent.duration.DurationInt

/** HEL-1841: a local HTTP stub answering every request with `500` and a body chosen by path, plus the exact capped
 *  text a driver must surface for it. The expected strings are spelled out literally (500, the marker) rather than
 *  derived from the production helper, so a change to the cap is caught here. */
object RemoteErrorBodyStub {

  private val Marker = " … [truncated]"
  private val Astral = new String(Character.toChars(0x1f600)) // two UTF-16 units

  /** `/big`: 100,000 ASCII characters. `/surrogate`: the astral character occupies UTF-16 units 499-500 of the whole
   *  `HTTP 500: ` + body string (10-unit prefix, so body units 489-490). `/short`: well under the cap. */
  val BigBody: String       = "x" * 100000
  val SurrogateBody: String = ("a" * 489) + Astral + ("b" * 1000)
  val ShortBody: String     = "upstream exploded"

  val ExpectedBig: String       = "HTTP 500: " + ("x" * 490) + Marker
  val ExpectedSurrogate: String = "HTTP 500: " + ("a" * 489) + Astral + Marker
  val ExpectedShort: String     = "HTTP 500: " + ShortBody

  /** HEL-1877: 2000 three-byte characters (6000 bytes), so a cut at 4096 bytes falls inside a character. The expected
   *  text for these two is computed from the full body (the literal `/big` and `/surrogate` cases still pin `cap`
   *  itself, so this does not make the expectation circular). */
  val MultibyteBody: String = "\u20ac" * 2000
  val MalformedBytes: Array[Byte] = {
    val b = Array.fill[Byte](6000)('a'.toByte)
    Seq(100 -> 0xff, 700 -> 0xc3, 701 -> 0x28, 1500 -> 0xe2, 1501 -> 0x82, 1900 -> 0xf0).foreach { case (i, v) => b(i) = v.toByte }
    b
  }
  val ExpectedMultibyte: String = RemoteErrorText.cap("HTTP 500: " + MultibyteBody)
  val ExpectedMalformed: String = RemoteErrorText.cap("HTTP 500: " + new String(MalformedBytes, UTF_8))

  /** The 2xx ceiling, spelled as a literal (never the production accessor). */
  val Limit: Int = 8388608

  val ChunkBytes: Int = 256

  private val emitted = new ConcurrentHashMap[String, AtomicLong]()

  /** Bytes the server has released for the request that carried `?id=<id>`; keyed per request so a still-running stream
   *  from an earlier case cannot pollute another case's count. */
  def emittedBytes(id: String): Long = Option(emitted.get(id)).map(_.get).getOrElse(0L)

  private def counted(id: String)(chunk: ByteString): ByteString = {
    emitted.computeIfAbsent(id, _ => new AtomicLong()).addAndGet(chunk.length.toLong)
    chunk
  }

  /** JSON array `[1]` followed by spaces, exactly `total` bytes, as fixed chunks of at most 64 KiB (a single larger chunk
   *  would fail at the client parser's `max-chunk-size`, making the success-path guards pass for the wrong reason). */
  private def jsonChunks(total: Int): Source[ByteString, NotUsed] =
    Source.unfold(0) { sent =>
      if (sent >= total) None
      else {
        val n     = math.min(65536, total - sent)
        val bytes = if (sent == 0) ByteString("[1]") ++ ByteString(Array.fill[Byte](n - 3)(' '.toByte)) else ByteString(Array.fill[Byte](n)(' '.toByte))
        Some((sent + n, bytes))
      }
    }

  private def okChunked(total: Int) =
    complete(HttpEntity.Chunked.fromData(ContentTypes.`application/json`, jsonChunks(total)))
  private def okLength(total: Int) =
    complete(HttpEntity.Default(ContentTypes.`application/json`, total.toLong, jsonChunks(total)))

  val route: Route =
    concat(
      // Never completes: 256 ASCII bytes every 50 ms, counted as the server releases them.
      path("endless") {
        parameter("id") { id =>
          val body = Source.repeat(ByteString("x" * ChunkBytes)).throttle(1, 50.millis).map(counted(id))
          complete(StatusCodes.InternalServerError, HttpEntity.Chunked.fromData(ContentTypes.`text/plain(UTF-8)`, body))
        }
      },
      // 64 MiB of ASCII in fixed 64 KiB chunks, fast.
      path("huge") {
        parameter("id") { id =>
          val body = Source.repeat(ByteString("x" * 65536)).take(1024).map(counted(id))
          complete(StatusCodes.InternalServerError, HttpEntity.Chunked.fromData(ContentTypes.`text/plain(UTF-8)`, body))
        }
      },
      path("multibyte") { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, MultibyteBody)) },
      path("malformed") { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, ByteString(MalformedBytes))) },
      path("exact-chunked") { okChunked(Limit) },
      path("exact-length")  { okLength(Limit) },
      path("over-chunked")  { okChunked(Limit + 1) },
      path("over-length")   { okLength(Limit + 1) },
      path("big")       { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, BigBody)) },
      path("surrogate") { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, SurrogateBody)) },
      path("short")     { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, ShortBody)) }
    )
}
