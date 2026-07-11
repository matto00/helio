package com.helio.services

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.{ClientTransport, Http}
import org.apache.pekko.http.scaladsl.model.HttpRequest
import org.apache.pekko.http.scaladsl.settings.{ClientConnectionSettings, ConnectionPoolSettings}
import org.apache.pekko.stream.Materializer
import com.helio.domain.{DataField, DataFieldType}

import java.net.{Inet6Address, InetAddress, InetSocketAddress, URI}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Reusable seam for content connectors (HEL-215 text/Markdown, first
 *  consumer; HEL-214 PDF and HEL-216 image extend the same helpers rather
 *  than reimplementing metadata-field construction or URL fetch-and-store
 *  plumbing). Deliberately content-agnostic — callers supply their own
 *  content `DataFieldType` (`StringBodyType` for text, `BinaryRefType` for
 *  PDF/image); the per-connector extraction/storage logic (e.g. PDF text
 *  extraction, image binary storage) stays in each connector's own service. */
object ContentSourceSupport {

  /** Build the `{content, filename, sizeBytes}` `DataField` triple every
   *  content connector's `DataType` registers. This is the single place that
   *  fixes the metadata field names/types across connector kinds, so every
   *  content connector's DataType shape is consistent.
   *
   *  `filename`/`sizeBytes` are accepted for call-site symmetry with the
   *  ingestion path — the returned *schema* (names + types) is fixed
   *  regardless of their values; only the content field's `DataFieldType`
   *  varies per connector. */
  def metadataFields(
      contentFieldType: DataFieldType,
      @annotation.unused filename: String,
      @annotation.unused sizeBytes: Long
  ): Vector[DataField] =
    Vector(
      DataField("content", "Content", DataFieldType.asString(contentFieldType), nullable = false),
      DataField("filename", "Filename", DataFieldType.asString(DataFieldType.StringType), nullable = false),
      DataField("sizeBytes", "Size (bytes)", DataFieldType.asString(DataFieldType.IntegerType), nullable = false)
    )

  /** Hard ceiling on fetched response size, independent of any individual
   *  connector's business-rule max (e.g. text's `TEXT_MAX_FILE_SIZE_BYTES`).
   *
   *  Root cause (probe-confirmed): `HttpEntity.toStrict(timeout)` — with no
   *  explicit byte limit — defaults to the actor system's
   *  `pekko.http.parsing.max-to-strict-bytes` setting (8 MiB), a *different*
   *  config key from `max-content-length` (which defaults to `infinite` on
   *  the client side and does not gate `toStrict` at all). Overriding
   *  `ClientConnectionSettings`/`ParserSettings.max-content-length` per
   *  request therefore has no effect on this cap — passing an explicit
   *  `maxBytes` to the `toStrict(timeout, maxBytes)` overload is the actual
   *  fix, bypassing the config-driven default entirely. This cap is
   *  deliberately generous — the per-connector service-layer check (not this
   *  cap) is what enforces the user-facing limit. */
  private val fetchSizeLimitBytes: Long = 104857600L // 100 MiB

  /** Default (production) host resolver — real DNS/hosts-file resolution via
   *  the JVM. `fetchUrl`'s (and `DataSourceService`'s) `resolveHost` parameter
   *  exists so tests can inject a fake resolver and exercise the SSRF guard's
   *  *validation* branch against a local-loopback test server without
   *  weakening the guard actually used in production (no production call
   *  site overrides this default — `ApiRoutes`/`DataSourceService` both fall
   *  back to this). Public so callers can build a resolver that special-cases
   *  a known test hostname and delegates everything else here. */
  def defaultResolveHost(host: String): Try[Array[InetAddress]] =
    Try(InetAddress.getAllByName(host))

  /** `true` for any address a caller-supplied URL must never be allowed to
   *  reach: loopback, link-local (including the `169.254.0.0/16` cloud
   *  metadata range), RFC1918 private (IPv4) / deprecated site-local (IPv6),
   *  unique-local IPv6 (`fc00::/7` — not covered by `isSiteLocalAddress`),
   *  any-local (`0.0.0.0`/`::`), and multicast. */
  def isBlockedAddress(addr: InetAddress): Boolean =
    addr.isLoopbackAddress ||
      addr.isLinkLocalAddress ||
      addr.isSiteLocalAddress ||
      addr.isAnyLocalAddress ||
      addr.isMulticastAddress ||
      isUniqueLocalIPv6(addr)

  /** `fc00::/7` (RFC 4193 unique local addresses) — `InetAddress.isSiteLocalAddress`
   *  only recognizes the deprecated IPv6 site-local prefix (`fec0::/10`), not
   *  this range, so it needs an explicit check of the address's top 7 bits. */
  private def isUniqueLocalIPv6(addr: InetAddress): Boolean = addr match {
    case a: Inet6Address =>
      val firstByte = a.getAddress()(0) & 0xff
      (firstByte & 0xfe) == 0xfc
    case _ => false
  }

  /** SSRF guard: validates a caller-supplied URL *before* any request is
   *  issued. Rejects non-`http`/`https` schemes, URLs with no host, hosts
   *  that fail to resolve, and hosts that resolve to any [[isBlockedAddress]]
   *  address. `resolveHost` defaults to real DNS ([[defaultResolveHost]]);
   *  tests may inject a fake resolver to validate against a local test
   *  server's hostname without going through real DNS. `isBlocked` defaults
   *  to [[isBlockedAddress]] (host-agnostic, real production denylist);
   *  tests may override it, keyed on the *original* hostname string, to
   *  admit a single known-safe local test-server hostname (e.g. `"localhost"`)
   *  without weakening the check for any other host — see [[fetchUrl]]'s doc
   *  comment for why this is keyed on the hostname rather than the address. */
  def validateUrl(
      url: String,
      resolveHost: String => Try[Array[InetAddress]] = defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => isBlockedAddress(addr)
  ): Either[String, Unit] =
    resolveValidated(url, resolveHost, isBlocked).map(_ => ())

  /** Shared validation core for [[validateUrl]] and [[fetchUrl]]. Resolves
   *  the host *once* and returns the validated [[InetAddress]] alongside the
   *  `Either` result, so `fetchUrl` can pin the actual TCP connection to
   *  exactly the address that was checked against the denylist — see
   *  `fetchUrl`'s doc comment for why returning `Unit` (as the pre-cycle-3
   *  `validateUrl` did, forcing callers to re-resolve for the connection) was
   *  the root cause of the DNS-rebinding TOCTOU gap. */
  private def resolveValidated(
      url: String,
      resolveHost: String => Try[Array[InetAddress]],
      isBlocked: (String, InetAddress) => Boolean
  ): Either[String, InetAddress] =
    Try(new URI(url)).toOption match {
      case None => Left(s"Invalid URL: $url")
      case Some(uri) =>
        Option(uri.getScheme).map(_.toLowerCase) match {
          case Some("http") | Some("https") =>
            Option(uri.getHost) match {
              case None => Left(s"URL is missing a host: $url")
              case Some(host) =>
                resolveHost(host) match {
                  case Failure(e) => Left(s"Could not resolve host '$host': ${e.getMessage}")
                  case Success(addresses) if addresses.isEmpty =>
                    Left(s"Could not resolve host '$host': no addresses returned")
                  case Success(addresses) if addresses.exists(a => isBlocked(host, a)) =>
                    Left(s"URL host '$host' resolves to a disallowed address")
                  case Success(addresses) => Right(addresses.head)
                }
            }
          case other =>
            Left(s"Unsupported URL scheme: ${other.getOrElse("(none)")}. Only http/https are allowed.")
        }
    }

  /** Builds a [[ClientTransport]] that ignores the host/port Pekko HTTP's
   *  connection pool would normally use for its *own* DNS resolution, and
   *  always connects to `pinnedAddress` instead.
   *
   *  Root cause (probe-confirmed, HEL-215 cycle-3 fix — closes the
   *  DNS-rebinding TOCTOU the cycle-2 guard left open): [[ClientTransport.TCP]]
   *  (the default transport) builds an *unresolved* `InetSocketAddress` from
   *  the request's hostname (`InetSocketAddress.createUnresolved`) — Pekko's
   *  own source comment on that default explains this is deliberate, "so
   *  that DNS resolution is performed for every new connection." That is
   *  exactly the second, independent resolution that let a rebinding-DNS
   *  attacker defeat [[resolveValidated]]'s address-range check: the address
   *  it validated was discarded, and the *real* TCP connection re-resolved
   *  the same hostname a second time, free to land anywhere. Passing an
   *  *already-resolved* `InetSocketAddress` (built from the validated
   *  [[InetAddress]], not a hostname string) here means no further DNS
   *  lookup happens for the connection at all — the socket connects to
   *  literally the same address [[resolveValidated]] already checked.
   *  `ClientTransport.withCustomResolver`'s `lookup` still receives the
   *  original `(host, port)` Pekko computed from the request's URI — this
   *  only overrides *where the TCP connection is made*; the `Host` header
   *  (and, for `https`, the TLS SNI/hostname-verification target) are set
   *  independently from the request's `Uri`/`ConnectionContext` and are
   *  untouched by this transport, so they still carry the original
   *  hostname. */
  private def pinnedTransport(pinnedAddress: InetAddress): ClientTransport =
    ClientTransport.withCustomResolver { (_, port) =>
      Future.successful(new InetSocketAddress(pinnedAddress, port))
    }

  /** Raw-bytes HTTP GET for URL-based content ingestion. Mirrors
   *  `RestApiConnector.doFetch`'s pooled-connection settings pattern, but
   *  returns the response body as bytes (not parsed JSON) and has no auth
   *  support — out of scope for this ticket. HEL-214/HEL-216 reuse this
   *  instead of writing their own HTTP client code for URL ingestion.
   *
   *  SSRF guard (HEL-215 cycle-2 fix, DNS-rebinding TOCTOU closed in cycle 3):
   *  [[resolveValidated]] runs before any request is issued, rejecting
   *  disallowed schemes/hosts/addresses (see `design.md`'s "Reusable seam #2"
   *  for the full rationale) — and its resolved [[InetAddress]] is threaded
   *  into [[pinnedTransport]] so the *actual* TCP connection is forced to
   *  that exact address rather than letting Pekko HTTP re-resolve the
   *  hostname independently when it opens the connection (the DNS-rebinding
   *  bypass a cold-skeptic final-gate review found in cycle 2 — see
   *  `pinnedTransport`'s doc comment for the full mechanism). Redirects are
   *  never auto-followed — Pekko HTTP's low-level `Http().singleRequest`
   *  does not follow 3xx responses itself, so a redirect to an internal
   *  address is simply returned as a non-success status (handled below,
   *  generic message, no body echoed) rather than silently chased. */
  def fetchUrl(
      url: String,
      resolveHost: String => Try[Array[InetAddress]] = defaultResolveHost,
      isBlocked: (String, InetAddress) => Boolean = (_, addr) => isBlockedAddress(addr)
  )(implicit system: ActorSystem[_]): Future[Either[String, Array[Byte]]] = {
    implicit val ec: ExecutionContext = system.executionContext
    implicit val mat: Materializer    = Materializer(system)

    resolveValidated(url, resolveHost, isBlocked) match {
      case Left(err) => Future.successful(Left(err))
      case Right(pinnedAddress) =>
        val poolSettings: ConnectionPoolSettings =
          ConnectionPoolSettings(system.classicSystem)
            .withConnectionSettings(
              ClientConnectionSettings(system.classicSystem)
                .withConnectingTimeout(10.seconds)
                .withIdleTimeout(30.seconds)
            )
            .withTransport(pinnedTransport(pinnedAddress))

        Http(system.classicSystem)
          .singleRequest(HttpRequest(uri = url), settings = poolSettings)
          .flatMap { response =>
            response.entity.toStrict(30.seconds, fetchSizeLimitBytes).map { entity =>
              // Root cause (probe-confirmed): Pekko HTTP's `StatusCode.isSuccess`
              // is `true` for *any* non-4xx/5xx status — `Redirection` (3xx)
              // extends the same `HttpSuccess` marker trait as `Success` (2xx),
              // distinguished only by `isRedirection`. Using `isSuccess` alone
              // here would treat a 3xx response's body (e.g. a redirect stub
              // page) as successfully-fetched content instead of rejecting it —
              // this is exactly the redirect-to-internal case the SSRF guard
              // must close, since Pekko's low-level client never auto-follows
              // the redirect itself. Checking the 2xx range explicitly is what
              // actually fixes this (not a cosmetic rename of `isSuccess`).
              val code = response.status.intValue()
              if (code >= 200 && code < 300) Right(entity.data.toArray)
              else Left(s"Upstream returned HTTP $code")
            }
          }
          .recover { case e => Left(s"Request failed: ${e.getMessage}") }
    }
  }

  /** Extensions accepted by the text/Markdown connector (HEL-215). */
  val TextExtensions: Set[String] = Set("txt", "md")

  /** Extensions accepted by the PDF connector (HEL-214). */
  val PdfExtensions: Set[String] = Set("pdf")

  /** Extensions accepted by the image connector (HEL-216). */
  val ImageExtensions: Set[String] = Set("png", "jpg", "jpeg", "gif", "webp", "bmp")

  /** Validate a filename's extension against `allowed` (lower-cased, no
   *  leading dot). Returns the lower-cased extension on success. Shared by
   *  both the upload path (filename from the multipart part) and the URL
   *  path (filename derived from the URL's last path segment). */
  def validateExtension(filename: String, allowed: Set[String]): Either[String, String] = {
    val ext = filename.lastIndexOf('.') match {
      case -1 => ""
      case i  => filename.substring(i + 1).toLowerCase
    }
    if (allowed.contains(ext)) Right(ext)
    else
      Left(
        s"Unsupported file extension: '.$ext'. Supported extensions: " +
          allowed.toSeq.sorted.map("." + _).mkString(", ")
      )
  }

  /** Best-effort filename extraction from a URL's last non-empty path
   *  segment (ignoring query string / fragment). Falls back to `"downloaded"`
   *  (no extension) when the URL has no path segments — the subsequent
   *  `validateExtension` call then rejects it as an unsupported/missing
   *  extension, same as any other unrecognized filename. */
  def filenameFromUrl(url: String): String = {
    val path = Try(new URI(url).getPath).toOption.flatMap(Option(_)).getOrElse("")
    path.split("/").filter(_.nonEmpty).lastOption.getOrElse("downloaded")
  }
}
