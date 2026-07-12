package com.helio.api

import org.apache.pekko.http.scaladsl.model.headers.{HttpCookie, SameSite}
import com.helio.services.AuthService

/** Session-cookie attribute configuration (HEL-287 CodeQL #8 httpOnly-cookie
 *  migration — see design.md D1). `secure` drives both the `Secure`
 *  attribute and `SameSite`: `SameSite=None` requires `Secure` per the
 *  cookie spec, and this app's cross-site prod deployment (frontend on
 *  Firebase Hosting, backend on Cloud Run, no reverse proxy — every API call
 *  is genuinely cross-site) needs `SameSite=None` for the cookie to ever
 *  attach to a `fetch`/XHR call. Dev is same-origin via the Vite proxy, so
 *  `SameSite=Lax` / `Secure=false` is correct there. Read once at startup
 *  from `COOKIE_SECURE` (default `false`) — never hardcoded. */
final case class CookieConfig(secure: Boolean) {
  def sameSite: SameSite = if (secure) SameSite.None else SameSite.Lax
}

object CookieConfig {
  def fromEnv(): CookieConfig =
    CookieConfig(secure = sys.env.get("COOKIE_SECURE").exists(_.equalsIgnoreCase("true")))
}

/** Builds the `Set-Cookie` header value for the session cookie — shared by
 *  `AuthRoutes` (register/login) and `OAuthRoutes` (Google callback) so the
 *  attribute set is defined in exactly one place, and by `AuthDirectives`
 *  (which only needs [[Name]] to read it back). */
object SessionCookies {

  /** Cookie name (design.md "self-approved" decision). */
  val Name: String = "helio_session"

  /** Issues the cookie on successful login/register/OAuth-callback.
   *  `Max-Age` matches [[AuthService.SessionTtlSeconds]] (30 days). */
  def issue(token: String, config: CookieConfig): HttpCookie =
    HttpCookie(Name, token)
      .withPath("/")
      .withMaxAge(AuthService.SessionTtlSeconds)
      .withHttpOnly(true)
      .withSecure(config.secure)
      .withSameSite(config.sameSite)

  /** Clears the cookie on logout (`Max-Age=0`). Attributes otherwise mirror
   *  [[issue]] so the browser matches the cookie to delete. */
  def expire(config: CookieConfig): HttpCookie =
    HttpCookie(Name, "")
      .withPath("/")
      .withMaxAge(0)
      .withHttpOnly(true)
      .withSecure(config.secure)
      .withSameSite(config.sameSite)
}
