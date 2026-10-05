package com.helio.api.routes.pipelines

import java.time.Instant
import scala.util.Try

/** HEL-1273 -- `limit`/`since` parsing shared by the authenticated and public history routes, so
 *  neither can drift. `limit` is an integer in 1..100 (default 30), never clamped; `since` is an
 *  ISO-8601 instant. */
object OutputHistoryQueryParsing {

  val DefaultLimit: Int = 30
  val MaxLimit: Int     = 100

  final case class Query(limit: Int, since: Option[Instant])

  def parse(limitRaw: Option[String], sinceRaw: Option[String]): Either[String, Query] =
    for {
      limit <- limitRaw match {
        case None => Right(DefaultLimit)
        case Some(s) =>
          Try(s.toInt).toOption.filter(n => n >= 1 && n <= MaxLimit).toRight(s"limit must be an integer between 1 and $MaxLimit")
      }
      since <- sinceRaw match {
        case None    => Right(None)
        case Some(s) => Try(Instant.parse(s)).toOption.map(Some(_)).toRight("since must be an ISO-8601 instant")
      }
    } yield Query(limit, since)
}
