package com.helio.api

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{HttpCookie, SameSite, `Set-Cookie`}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Unit coverage for [[CookieConfig]] / [[SessionCookies]] (HEL-287 design.md
 *  D1): `SameSite` must be derived from `secure`, never set independently,
 *  and the rendered `Set-Cookie` header must carry the exact attribute set
 *  for both the dev (`secure=false`) and prod (`secure=true`) shapes. The
 *  dev shape is additionally exercised end-to-end via `ApiRoutesSpec`
 *  (default test fixtures use `CookieConfig(secure = false)`); this spec is
 *  the only place the prod (`secure = true`, `SameSite=None`) shape is
 *  exercised, since flipping the fixture default would require rebuilding
 *  every route spec's `ApiRoutes` wiring. Renders the cookie through a real
 *  route (rather than probing pekko-http's internal rendering API) so the
 *  assertion matches exactly what a browser receives on the wire. */
class CookieConfigSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  "CookieConfig" should {

    "derive SameSite=Lax when not secure (dev, same-origin via Vite proxy)" in {
      CookieConfig(secure = false).sameSite shouldBe SameSite.Lax
    }

    "derive SameSite=None when secure (prod, cross-site frontend/backend split)" in {
      CookieConfig(secure = true).sameSite shouldBe SameSite.None
    }
  }

  private def routeSetting(cookieHeader: HttpCookie) =
    setCookie(cookieHeader) { complete(StatusCodes.OK) }

  "SessionCookies.issue" should {

    "render HttpOnly, Path=/, Max-Age=2592000, SameSite=Lax, no Secure for the dev config" in {
      Get("/") ~> routeSetting(SessionCookies.issue("tok-123", CookieConfig(secure = false))) ~> check {
        val value = header[`Set-Cookie`].map(_.value).getOrElse(fail("no Set-Cookie header"))
        value shouldBe "helio_session=tok-123; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax"
      }
    }

    "render Secure and SameSite=None for the prod config" in {
      Get("/") ~> routeSetting(SessionCookies.issue("tok-123", CookieConfig(secure = true))) ~> check {
        val value = header[`Set-Cookie`].map(_.value).getOrElse(fail("no Set-Cookie header"))
        value shouldBe "helio_session=tok-123; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None"
      }
    }
  }

  "SessionCookies.expire" should {

    "render Max-Age=0 with an empty value, matching the issuing attributes" in {
      Get("/") ~> routeSetting(SessionCookies.expire(CookieConfig(secure = false))) ~> check {
        val value = header[`Set-Cookie`].map(_.value).getOrElse(fail("no Set-Cookie header"))
        value shouldBe "helio_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
      }
    }
  }
}
