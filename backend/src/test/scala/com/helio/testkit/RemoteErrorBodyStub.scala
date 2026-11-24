package com.helio.testkit

import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route

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

  val route: Route =
    concat(
      path("big")       { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, BigBody)) },
      path("surrogate") { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, SurrogateBody)) },
      path("short")     { complete(StatusCodes.InternalServerError, HttpEntity(ContentTypes.`text/plain(UTF-8)`, ShortBody)) }
    )
}
