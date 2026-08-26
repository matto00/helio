# IP-based rate-limit keying — handoff to HEL-837

HEL-495 shipped with authenticated keying only (session user id, PAT token id). IP-based
keying for unauthenticated/invalid-credential requests was deferred to HEL-837 after four
delivery cycles and three final-gate REFUTEs found six distinct, real defects — all of them
in the IP path, none in the authenticated-keying path, which survived every round unchanged.

This document preserves the working implementation reached by the end of cycle 4 (commit
`dc3ab524`, before it was stripped out of the shipped diff), its full test coverage, and the
six findings that produced it, so HEL-837 does not have to re-derive any of this from
scratch — only decide whether to keep hand-rolling it or take a different approach (see
"Recommendation for HEL-837" at the end).

## Why this was deferred, not just fixed a fourth time

Trusted client-IP extraction behind a reverse proxy is a well-known hard problem (this is
exactly why libraries like `X-Forwarded-For` parsing exist as a distinct, often
security-audited concern rather than something every service reimplements). The rate of new
findings across four rounds did not decrease — round 3 found a defect (multi-instance header
truncation) in code that round 2 had already fixed for a different defect (port-in-key) in
code that round 1 had already fixed for a third defect (header-vs-attribute trust order).
Each fix was correct and each defect was real, but the pattern — new subtlety surfacing on
every adversarial pass — is itself the signal that this surface deserves a dedicated design
pass (including the question below) rather than a fourth patch under the same ticket's
batch-delivery pressure.

## The six findings, in order

1. **(Round 1)** Bare Pekko `extractClientIP` reads `X-Forwarded-For` (first element), then
   `X-Real-Ip`, then `Remote-Address` — all three caller-settable headers — before ever
   falling back to the trusted connection-level attribute. Any client could spoof a fresh
   bucket per request. Fix: introduced `RateLimitConfig.trustedProxyHops` as an explicit
   trust decision (0 = trust only the connection attribute; N = trust the Nth-from-end
   `X-Forwarded-For` entry).
2. **(Round 2, CR1)** The connection-attribute `RemoteAddress.value` renders `"host:port"`,
   so keying on it (even correctly, at `trustedProxyHops=0`) keyed per TCP *connection*, not
   per IP — a fresh socket per request (free for an attacker) defeated the limiter. Fix:
   `keyForAddress` switched to `addr.toOption.map(_.getHostAddress)` (host only).
3. **(Round 2, CR2 — evidence defect)** The first `trustedProxyHops >= 1` regression test
   varied only the caller-controlled leading `X-Forwarded-For` entry, so it passed unchanged
   against the pre-fix bug. Not a code defect, but the evaluator's PASS on this specific
   claim was mistaken and was recorded as a correction (see `evaluation-2.md`'s appended
   `### CORRECTION` section).
4. **(Round 3, CR1 — serious)** `optionalHeaderValueByType` resolves via Pekko's
   `headers.collectFirst`, reading only the *first* `X-Forwarded-For` header instance.
   HTTP allows a field to repeat as separate header lines (RFC 7230 §3.2.2), and Pekko does
   not merge them. If a trusted proxy contributes its own value as a separate header line
   (rather than appending to the caller's), the caller's own line is read instead —
   reinstating full spoofability inside the exact `trustedProxyHops=1` config that had just
   been wired into `infra/deploy-backend.sh` for production. Fix: collect *all*
   `X-Forwarded-For` header instances and flatten their addresses before indexing from the
   end.
5. **(Round 3, CR2 — doc defect)** `application.conf`'s comment claimed the connection
   attribute was consulted as a fallback under `trustedProxyHops > 0`; it never is (that path
   always falls back to the literal `"ip:unknown"`). Corrected.
6. **(Round 3, CR3 — evidence defect, same class as #3)** Two `"ip:unknown"` fallback tests
   issued the identical request/header twice, so they passed regardless of whether the
   fallback was implemented correctly. Fixed by varying the untrusted value across the two
   requests while still asserting the second is throttled.

Findings #3 and #6 are their own pattern worth carrying forward independent of the IP-keying
question: **a test that would pass against the very bug it claims to guard against is not
coverage.** Watch for this shape specifically in any new implementation.

## The working implementation at the end of cycle 4 (commit `dc3ab524`)

This is the last-known-good state before the IP path was stripped from HEL-495's shipped
diff. All findings above are fixed in this version; it passed the final-gate skeptic's
verification of findings #1, #2, and #4-6 directly (round 3's REFUTE was itself only about
finding #4-6, found *in* this version — so this snapshot is what round 4 was built from, not
what round 4 shipped; there was no round-4 final-gate run before the split decision, so treat
this as "believed correct, three-times-adversarially-reviewed" rather than "final-gate
CONFIRMed").

### `RateLimitDirective.scala` (IP-keying portion only — session/PAT keying is unchanged and
shipped in HEL-495; only the code below was removed)

```scala
package com.helio.api.http

import com.helio.api.ErrorResponse
import org.apache.pekko.http.scaladsl.model.{AttributeKeys, RemoteAddress, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken, `Retry-After`, `X-Forwarded-For`}
import org.apache.pekko.http.scaladsl.server.{Directive0, Directive1}
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.api.protocols.ResourceProtocol
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, UserSessionRepository}
import com.helio.services.auth.ApiTokenService
import com.helio.services.ratelimit.{RateLimitResult, RateLimiter}

import scala.concurrent.ExecutionContext
import scala.util.Success

/** Reusable per-principal request rate-limiting directive (HEL-495 design.md D3/D3a/D3b/D4).
 *  Follows the `AuthDirectives`/`AclDirective` style: resolves its own bucket key by inspecting
 *  the request directly, independent of `AuthDirectives`'s identity directives, so it can compose
 *  ahead of/around `optionalAuthenticate` and `authenticate` alike rather than only after one of
 *  them has already run.
 *
 *  Key priority (design.md D3), matching `AuthDirectives.resolveIdentity`'s own
 *  session-over-header precedence exactly:
 *   1. `helio_session` cookie present -> resolve via [[UserSessionRepository.findValidSession]].
 *      Resolves -> `"user:<userId>"`. Does not resolve -> **do not fall through to the header**
 *      (mirrors `resolveIdentity`'s own short-circuit) -> fall to the IP key.
 *   2. No cookie, `Authorization: Bearer helio_pat_...` present -> resolve via
 *      [[ApiTokenRepository.findPrincipalByTokenHash]]. Resolves -> `"pat:<tokenId>"` (regardless
 *      of whether the token is scoped -- scoping is orthogonal to rate-limit keying). Does not
 *      resolve -> fall to the IP key.
 *   3. Neither credential present, or either resolved to invalid per above -> IP key
 *      (design.md D3a: a present-but-invalid credential must not collapse into one shared literal
 *      key -- it still identifies a distinct requester by IP, exactly the flood this directive
 *      exists to stop).
 *
 *  IP extraction (design.md D3b, revised after the final-gate skeptic's round-1 REFUTE) does
 *  **not** use Pekko's bare `extractClientIP`: that directive reads `X-Forwarded-For` (first
 *  element), then `X-Real-Ip`, then `Remote-Address` -- all three are caller-settable HTTP headers
 *  with no trust gating -- before ever falling back to the trusted connection-level attribute. A
 *  client can put an arbitrary value in any of them and get a fresh, never-throttled bucket on
 *  every request. Instead, [[trustedProxyHops]] makes the trust decision explicit:
 *   - `trustedProxyHops <= 0` (default): ignore all three headers entirely and key on
 *     `AttributeKeys.remoteAddress` -- the actual TCP peer address Pekko's server backend attaches
 *     to the request, which the caller cannot forge. Requires
 *     `pekko.http.server.remote-address-attribute = on` in `application.conf`; if the attribute is
 *     still absent/unknown (e.g. a test harness that never attached one), the request is keyed as
 *     the fixed string `"ip:unknown"` rather than rejected.
 *   - `trustedProxyHops >= 1` (e.g. `1` behind a single trusted reverse proxy such as Cloud Run's
 *     GFE, which appends to rather than replaces `X-Forwarded-For`): take the entry that many
 *     positions from the **end** of every `X-Forwarded-For` address, collected across **all**
 *     `X-Forwarded-For` header INSTANCES on the request (not just the first -- HTTP allows a field
 *     to repeat as separate header lines, and Pekko does not merge them into one object; see
 *     [[trustedProxyKey]]'s scaladoc for why reading only the first instance reopens the
 *     caller-chosen-key vulnerability) -- the entry the trusted proxy itself appended -- and ignore
 *     every earlier, caller-supplied entry, and ignore `X-Real-Ip`/`Remote-Address` entirely (only
 *     `X-Forwarded-For` participates in the trusted-hop calculation). If the combined address list
 *     is absent or shorter than `trustedProxyHops`, falls back to `"ip:unknown"` rather than
 *     trusting a caller-controlled value -- note this fallback is `"ip:unknown"`, never the
 *     connection-attribute address: the connection attribute is consulted ONLY on the
 *     `trustedProxyHops <= 0` path above, never here.
 *
 *  [[keyForAddress]] keys on the HOST portion of a `RemoteAddress` only, never its port (design.md
 *  D3b, revised again after the final-gate skeptic's round-2 REFUTE): Pekko's own connection-level
 *  attribute always carries `Some(port)` (`RemoteAddress(InetSocketAddress)` renders as
 *  `"host:port"` via `.value`), so keying on `.value` keyed per TCP *connection*, not per IP --
 *  a caller opening a fresh socket per request (free for the caller) got a fresh, never-throttled
 *  bucket every time despite `trustedProxyHops = 0` already ignoring every spoofable header. */
class RateLimitDirective(
    limiter: RateLimiter,
    userSessionRepo: UserSessionRepository,
    apiTokenRepo: Option[ApiTokenRepository],
    defaultLimit: Int,
    windowSeconds: Int,
    trustedProxyHops: Int = 0
)(implicit ec: ExecutionContext)
    extends ResourceProtocol {

  // HEL-495 final-gate skeptic round-2 REFUTE (Change Request 1): `RemoteAddress.value` renders
  // "host:port" whenever a port is present -- and the connection-attribute RemoteAddress Pekko's
  // server attaches ALWAYS carries one (`RemoteAddress(InetSocketAddress)` = `IP(address,
  // Some(port))`). Keying on `.value` therefore keyed per TCP CONNECTION, not per IP: a caller
  // opening a fresh socket per request (costing the caller nothing) got a fresh bucket every time.
  // `toOption` yields only the `InetAddress` (host, never port), so `getHostAddress` is the correct
  // host-only key component -- the same real IP across different ephemeral source ports collapses
  // to one bucket, as the limiter requires.
  private def keyForAddress(addr: RemoteAddress): String =
    addr.toOption.map(_.getHostAddress) match {
      case Some(host) => s"ip:$host"
      case None        => "ip:unknown"
    }

  /** `trustedProxyHops <= 0`: the untamperable connection-level peer address. Never derived from a
   *  caller-settable header. */
  private val directConnectionKey: Directive1[String] =
    extractRequest.map { request =>
      request.attribute(AttributeKeys.remoteAddress) match {
        case Some(addr) => keyForAddress(addr)
        case None       => "ip:unknown"
      }
    }

  /** `trustedProxyHops >= 1`: the `X-Forwarded-For` entry appended by the trusted proxy itself
   *  (counted from the end of the list), never the caller-supplied leading entries.
   *
   *  Collects EVERY `X-Forwarded-For` header instance on the request and flattens their
   *  `addresses` together, in header order, before indexing from the end (design.md D3b, revised
   *  again after the final-gate skeptic's round-3 REFUTE). `optionalHeaderValueByType` resolves via
   *  Pekko's `headers.collectFirst`, which returns only the FIRST matching header instance --
   *  Pekko does not merge repeated header lines into one object (`HttpRequest.headers` is a `Seq`,
   *  per RFC 7230 S3.2.2). A caller sending its own `X-Forwarded-For` alongside a trusted proxy that
   *  contributes its value as a SEPARATE header line (rather than appending to the caller's) would
   *  have its line read exclusively by `collectFirst`, silently discarding the proxy's -- reopening
   *  the caller-chosen-key vulnerability inside `trustedProxyHops >= 1` itself. */
  private def trustedProxyKey(hops: Int): Directive1[String] =
    extractRequest.map { request =>
      val addresses = request.headers.collect { case xff: `X-Forwarded-For` => xff.addresses }.flatten
      val indexFromEnd = addresses.size - hops
      if (indexFromEnd >= 0 && indexFromEnd < addresses.size) keyForAddress(addresses(indexFromEnd))
      else "ip:unknown"
    }

  private val ipKey: Directive1[String] =
    if (trustedProxyHops > 0) trustedProxyKey(trustedProxyHops) else directConnectionKey

  private val resolveKey: Directive1[String] =
    optionalCookie(SessionCookies.Name).flatMap {
      case Some(cookie) =>
        onComplete(userSessionRepo.findValidSession(cookie.value)).flatMap {
          case Success(Some(user)) => provide(s"user:${user.id.value}")
          case _                   => ipKey
        }
      case None =>
        optionalHeaderValueByType(Authorization).flatMap {
          case Some(Authorization(OAuth2BearerToken(token)))
              if apiTokenRepo.isDefined && token.startsWith(ApiTokenService.TokenPrefix) =>
            val hash = ApiTokenService.sha256Hex(token)
            onComplete(apiTokenRepo.get.findPrincipalByTokenHash(hash)).flatMap {
              case Success(Some((_, tokenId, _))) => provide(s"pat:${tokenId.value}")
              case _                              => ipKey
            }
          case _ => ipKey
        }
    }

  /** Enforces `limit` requests per `windowSeconds` (defaulting to the configured global limit) for
   *  the resolved bucket key. On exceed, completes 429 with a `Retry-After` header and a JSON
   *  `ErrorResponse` body (design.md D5); the inner route is never invoked for a rejected
   *  request. */
  def rateLimit(limit: Int = defaultLimit): Directive0 =
    resolveKey.flatMap { key =>
      limiter.tryAcquire(key, limit, windowSeconds) match {
        case RateLimitResult.Allowed => pass
        case RateLimitResult.Exceeded(retryAfterSeconds) =>
          respondWithHeader(`Retry-After`(retryAfterSeconds)) &
            complete(StatusCodes.TooManyRequests, ErrorResponse("Rate limit exceeded"))
      }
    }
}

```

### Tests (from `RateLimitDirectiveSpec.scala`)

```scala
  private def withForwardedFor(request: HttpRequest, ips: String*) =
    request.withHeaders(`X-Forwarded-For`(ips.map(ipAddr).toVector))

  // HEL-495 final-gate skeptic round-3 REFUTE (Change Request 1): builds a request with MULTIPLE
  // SEPARATE `X-Forwarded-For` header instances (one per group), not one header with a
  // comma-separated address list -- this is what `optionalHeaderValueByType` silently truncates to
  // just the first instance (Pekko does not merge repeated header lines into one object).
  private def withForwardedForHeaders(request: HttpRequest, groups: Seq[String]*) =
    request.withHeaders(groups.map(ips => `X-Forwarded-For`(ips.map(ipAddr).toVector)).toVector)

  "RateLimitDirective.rateLimit" should {

    "pass an under-limit request through" in {
      val route = routeFor(newDirective(limit = 2))
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "reject an over-limit request with 429, a Retry-After header, and a JSON ErrorResponse body" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
        header("Retry-After") should not be empty
        responseAs[ErrorResponse].message should not be empty
      }
    }

    "keep two different users' budgets independent" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      // Exhaust user A's budget.
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
      // User B is unaffected.
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenB)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "throttle the SAME key across repeated requests" in {
      val directive = newDirective(limit = 2)
      val route = routeFor(directive)
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.OK }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    "keep two PATs belonging to the SAME user independently budgeted" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      // Exhaust PAT 1's budget.
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA1))) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA1))) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
      // PAT 2, also belonging to user A, is unaffected.
      Get("/").withHeaders(Authorization(OAuth2BearerToken(patTokenA2))) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "fall back to and limit by client IP for unauthenticated requests" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      val req = withIp(Get("/"), "203.0.113.10")
      req ~> route ~> check { status shouldBe StatusCodes.OK }
      req ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
      // A different IP is unaffected.
      withIp(Get("/"), "203.0.113.11") ~> route ~> check { status shouldBe StatusCodes.OK }
    }

    "key a present-but-invalid session cookie by IP, isolated from other IPs (D3a)" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      val invalidCookie = Cookie(SessionCookies.Name -> "not-a-real-session")
      val reqIp1 = withIp(Get("/").withHeaders(invalidCookie), "198.51.100.1")
      reqIp1 ~> route ~> check { status shouldBe StatusCodes.OK }
      reqIp1 ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
      // A different client IP presenting an equally invalid cookie is not throttled by the first.
      withIp(Get("/").withHeaders(invalidCookie), "198.51.100.2") ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "key a present-but-invalid PAT bearer token by IP, isolated from other IPs (D3a)" in {
      val directive = newDirective(limit = 1)
      val route = routeFor(directive)
      val invalidBearer = Authorization(OAuth2BearerToken("helio_pat_" + "0" * 64))
      val reqIp1 = withIp(Get("/").withHeaders(invalidBearer), "198.51.100.20")
      reqIp1 ~> route ~> check { status shouldBe StatusCodes.OK }
      reqIp1 ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
      // A different client IP presenting an equally invalid bearer token is not throttled.
      withIp(Get("/").withHeaders(invalidBearer), "198.51.100.21") ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "allow a route-specific tighter limit to override the global default" in {
      val directive = newDirective(limit = 100) // generous global default
      val route = routeFor(directive, limit = Some(1)) // tighter per-route limit
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      Get("/").withHeaders(Cookie(SessionCookies.Name -> sessionTokenA)) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
    }

    // HEL-495 final-gate skeptic round-1 REFUTE (Change Request 1): bare `extractClientIP` reads
    // caller-settable X-Forwarded-For/X-Real-Ip/Remote-Address BEFORE the trusted connection
    // attribute, so a client could spoof a fresh bucket per request. These tests are the
    // skeptic's required regression coverage -- they fail against the pre-fix bare
    // `extractClientIP` implementation and pass against the trusted-source-only fix (D3b revised).

    "ignore a caller-supplied X-Forwarded-For and key on the trusted connection address alone (trustedProxyHops = 0, the default)" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 0)
      val route = routeFor(directive)
      val sameConnection = withIp(Get("/"), "203.0.113.50")
      // First request spoofs one X-Forwarded-For value; the caller-settable header must be ignored.
      withForwardedFor(sameConnection, "1.2.3.4") ~> route ~> check { status shouldBe StatusCodes.OK }
      // Second request from the SAME connection spoofs a DIFFERENT X-Forwarded-For value -- if the
      // header were honored (the pre-fix bug) this would look like a brand-new caller and pass;
      // keyed correctly on the untamperable connection address, it must be throttled instead.
      withForwardedFor(sameConnection, "9.9.9.9") ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    // HEL-495 final-gate skeptic round-2 REFUTE (Change Request 1): `keyForAddress` previously
    // included `RemoteAddress.value`'s rendered port (e.g. "203.0.113.50:53422"), so the SAME IP on
    // a fresh TCP connection (a new ephemeral source port) got a brand-new bucket -- the
    // trustedProxyHops = 0 path was still trivially evadable by connection churn. This test is the
    // required regression coverage: verified RED against the pre-fix `s"ip:${addr.value}"`
    // implementation (both ports vary, so both requests keyed differently and BOTH returned 200,
    // not 200-then-429), and GREEN against the host-only `keyForAddress` fix below.
    "key on the IP host only, ignoring the ephemeral source port, so the SAME IP on a DIFFERENT port is still throttled (trustedProxyHops = 0)" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 0)
      val route = routeFor(directive)
      withIp(Get("/"), "203.0.113.77", port = 51000) ~> route ~> check { status shouldBe StatusCodes.OK }
      // Same host, different ephemeral port -- a fresh TCP connection from the same attacker.
      withIp(Get("/"), "203.0.113.77", port = 52000) ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    // HEL-495 final-gate skeptic round-2 REFUTE (Change Request 2): the previous version of this
    // test varied only the caller-supplied LEADING X-Forwarded-For entry between the two requests,
    // which also produces two distinct keys under the pre-fix bare `extractClientIP` (which reads
    // the first/leading element) -- so it passed unchanged against the bug and proved nothing about
    // the trusted-hop resolution. Corrected per the skeptic's required shape: the TRAILING
    // (trusted-proxy-appended) entry is held CONSTANT across both requests while only the
    // caller-controlled leading entry varies. Verified RED against the pre-fix bare
    // `extractClientIP` implementation (which would key on the varying leading entry and return
    // 200/200) and GREEN against `trustedProxyKey` (which keys on the constant trailing entry and
    // returns 200/429).
    "key on the trusted-proxy-appended (trailing) X-Forwarded-For hop when trustedProxyHops >= 1, ignoring the caller-controlled leading entry" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 1)
      val route = routeFor(directive)
      val viaProxy = withIp(Get("/"), "198.51.100.99") // the trusted proxy's own connection address
      // Leading (caller-supplied) entry differs; trailing (trusted-proxy-appended) entry is the SAME.
      withForwardedFor(viaProxy, "1.1.1.1", "203.0.113.60") ~> route ~> check { status shouldBe StatusCodes.OK }
      withForwardedFor(viaProxy, "2.2.2.2", "203.0.113.60") ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    "key on the trusted-proxy-appended hop independently for two DIFFERENT real clients behind the same proxy (trustedProxyHops >= 1)" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 1)
      val route = routeFor(directive)
      val viaProxy = withIp(Get("/"), "198.51.100.99")
      // Different trailing (trusted) entries -- genuinely different real clients -- must be independent.
      withForwardedFor(viaProxy, "1.1.1.1", "203.0.113.60") ~> route ~> check { status shouldBe StatusCodes.OK }
      withForwardedFor(viaProxy, "2.2.2.2", "203.0.113.61") ~> route ~> check { status shouldBe StatusCodes.OK }
    }

    // HEL-495 final-gate skeptic round-3 REFUTE (Change Request 3): the previous versions of these
    // two tests issued the SAME request/header twice, which any deterministic keying satisfies --
    // including a wrongly-implemented fallback that trusts the connection attribute or the single
    // caller-supplied entry, the exact thing each test claims must never happen. Corrected to VARY
    // the value that must not be trusted across the two requests while still asserting the second
    // is throttled -- this actually discriminates a correct "ip:unknown" fallback from a buggy one
    // that trusts something caller/connection-supplied.

    "fall back to ip:unknown (never the connection address) when trustedProxyHops = 1 but no X-Forwarded-For header is present at all" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 1)
      val route = routeFor(directive)
      // No X-Forwarded-For header at all: falls back to the fixed "ip:unknown" key. Varying the
      // CONNECTION address between the two requests still must throttle the second -- if the code
      // wrongly fell back to trusting the connection attribute (a distinct implementation bug this
      // test must catch), two different connection addresses would land in two different buckets
      // and the second request would wrongly succeed instead of being throttled.
      withIp(Get("/"), "198.51.100.100") ~> route ~> check { status shouldBe StatusCodes.OK }
      withIp(Get("/"), "198.51.100.101") ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    "fall back to ip:unknown (never the single caller-supplied entry) when trustedProxyHops = 2 but X-Forwarded-For has only one entry" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 2)
      val route = routeFor(directive)
      // Header shorter than the configured hop count: never trust the single caller-supplied entry.
      // Varying that entry between the two requests still must throttle the second -- if the code
      // wrongly trusted the too-short header's single entry (the exact bug this test guards
      // against), two different entries would land in two different buckets and the second request
      // would wrongly succeed instead of being throttled.
      withForwardedFor(Get("/"), "203.0.113.60") ~> route ~> check { status shouldBe StatusCodes.OK }
      withForwardedFor(Get("/"), "203.0.113.61") ~> route ~> check { status shouldBe StatusCodes.TooManyRequests }
    }

    // HEL-495 final-gate skeptic round-3 REFUTE (Change Request 1): `optionalHeaderValueByType`
    // resolves via Pekko's `headers.collectFirst`, which returns only the FIRST matching header
    // INSTANCE and silently discards any later ones -- Pekko does not merge repeated header lines
    // into one object (`HttpRequest.headers` is a `Seq`, per RFC 7230 S3.2.2). If a caller sends its
    // own `X-Forwarded-For` and a trusted proxy contributes its value as a SEPARATE header line
    // (rather than appending to the caller's existing one), the pre-fix implementation reads only
    // the caller's line and never sees the proxy's -- reinstating full spoofability at
    // trustedProxyHops = 1, the exact config now shipped to prod. This test uses TWO SEPARATE
    // X-Forwarded-For header instances (not one header with a comma-separated list) -- verified RED
    // against the pre-fix `optionalHeaderValueByType`-based implementation (both requests key on the
    // caller-chosen FIRST header's sole entry -- 1.1.1.1 then 2.2.2.2 -- and both return 200) before
    // the fix collecting all header instances was applied.
    "key on the trusted-proxy-appended entry even when it arrives as a SEPARATE X-Forwarded-For header instance, not merged into the caller's" in {
      val directive = newDirective(limit = 1, trustedProxyHops = 1)
      val route = routeFor(directive)
      val viaProxy = withIp(Get("/"), "198.51.100.199")
      // Two separate header instances: the caller's own (leading, spoofed, varies) and the trusted
      // proxy's (trailing, held constant) -- exactly what a proxy that appends a NEW header line
      // (rather than rewriting the caller's) would produce on the wire.
      withForwardedForHeaders(viaProxy, Seq("1.1.1.1"), Seq("203.0.113.60")) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      withForwardedForHeaders(viaProxy, Seq("2.2.2.2"), Seq("203.0.113.60")) ~> route ~> check {
        status shouldBe StatusCodes.TooManyRequests
      }
    }
  }
}

```

### Config

- `RateLimitConfig.trustedProxyHops: Int` (default `0`), env `RATE_LIMIT_TRUSTED_PROXY_HOPS`.
- `application.conf`: `pekko.http.server.remote-address-attribute = on` (required for the
  `trustedProxyHops <= 0` path to resolve a real connection-level address at all).
- `infra/deploy-backend.sh`: `RATE_LIMIT_TRUSTED_PROXY_HOPS=1`, reasoned from this being a
  fully-managed Cloud Run service (`gcloud run deploy`, no external Load
  Balancer/CDN/Cloud Armor found anywhere in `infra/` or `docs/deployment.md`) reached
  directly via its `*.run.app` URL — exactly one trusted GFE hop, which Google documents as
  appending the real client IP as the last `X-Forwarded-For` entry. **This reasoning was
  never independently re-verified against Google's actual documented GFE behavior** (see
  Recommendation below) — it was inferred from the absence of contradicting infrastructure
  in this repo, not confirmed against an authoritative external source.

## Recommendation for HEL-837

Per the product owner's framing of HEL-837: **first decide whether to hand-roll this at
all** before resuming from where this leaves off. Options, in the order I'd suggest
evaluating them:

1. **A vetted library/middleware for trusted-proxy IP resolution**, if one exists in the
   Scala/Pekko ecosystem or can be fronted by infrastructure (e.g. Cloud Run + a component
   that normalizes/validates the client IP before it reaches the container) — this class of
   bug (repeated headers, first-vs-last-hop confusion, port-inclusion) is exactly what a
   maintained library is more likely to have already hardened against than a first-pass
   hand-roll under ticket-delivery pressure.
2. **Hand-roll with a written threat model**, if no suitable library exists — explicitly
   enumerate the header-spoofing/multi-instance/port-inclusion classes above as required
   threat-model entries, not discovered incrementally via adversarial review. The
   implementation above is a reasonable starting point for this option, but its
   `infra/deploy-backend.sh` hop-count reasoning should be independently verified against
   Google's actual, current GFE documentation (not re-derived from absence-of-evidence in
   this repo) before being trusted in production.
3. **No IP-based limiting at all**, if the actual risk from unauthenticated traffic is judged
   low enough (or better mitigated by Cloud Armor / a WAF layer in front of Cloud Run) that
   the complexity isn't worth it — HEL-495 already ships this as the default state, so this
   option is "make the current gap permanent" rather than "add a new deferred item."

Whichever option HEL-837 chooses, the unauthenticated-request behavior currently shipped by
HEL-495 (not rate-limited at all by this directive) is documented in `CLAUDE.md`'s
`RATE_LIMIT_REQUESTS_PER_WINDOW` row and should be updated there once HEL-837 lands.
