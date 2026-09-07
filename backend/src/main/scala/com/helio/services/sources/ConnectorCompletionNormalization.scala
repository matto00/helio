package com.helio.services.sources

import org.apache.pekko.http.scaladsl.model.Uri

/** HEL-955 design.md D9: pure normalization for the re-mint match key ("owner + kind +
 *  normalized base URL + intended auth shape"). Deliberately narrow -- lowercase scheme/host,
 *  drop a default port for the scheme, strip exactly one trailing slash, compare path/query
 *  case-sensitively, no DNS resolution and no other canonicalization -- exactly as design.md
 *  states, so a re-initiation with a materially different host is never silently matched. */
object ConnectorCompletionNormalization {

  private val defaultPorts: Map[String, Int] = Map("http" -> 80, "https" -> 443)

  def normalizeBaseUrl(rawUrl: String): String = {
    val uri    = Uri(rawUrl)
    val scheme = uri.scheme.toLowerCase
    val host   = uri.authority.host.address().toLowerCase
    val port   = uri.effectivePort
    val portSegment =
      if (defaultPorts.get(scheme).contains(port)) "" else s":$port"
    val path = uri.path.toString
    // A bare root path ("/") and an entirely absent path ("") are the SAME URL
    // (`https://host` vs `https://host/`) -- both normalize to "" so the two spellings match.
    // Any deeper path drops exactly one trailing slash, per design.md D9.
    val strippedPath =
      if (path == "/") ""
      else if (path.endsWith("/") && path.length > 1) path.dropRight(1)
      else path
    val query = uri.rawQueryString.map(q => s"?$q").getOrElse("")
    s"$scheme://$host$portSegment$strippedPath$query"
  }
}
