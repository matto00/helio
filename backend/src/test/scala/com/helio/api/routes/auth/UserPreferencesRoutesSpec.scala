package com.helio.api.routes.auth

import com.helio.testsupport.TwoUserRlsApiFixture
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpRequest, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

/** HEL-1574: `PATCH /api/users/me/preferences` and the shell keys' interplay with the accent write. */
class UserPreferencesRoutesSpec extends TwoUserRlsApiFixture {

  private def patch(user: String, body: String) = req(HttpMethods.PATCH, "/api/users/me/preferences", user, Some(body))

  private def accent(user: String, color: String) =
    req(HttpMethods.PATCH, "/api/users/me/update", user, Some(s"""{"fields":["accentColor"],"user":{"accentColor":"$color"}}"""))

  private def stored(user: String): Option[String] =
    await(privilegedDb.run(sql"SELECT preferences FROM users WHERE id = $user::uuid".as[Option[String]].head))

  private def me(user: String): JsObject =
    req(HttpMethods.GET, "/api/auth/me", user) ~> routes ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("preferences").asJsObject
    }

  private def reset(): Unit = await(privilegedDb.run(sqlu"UPDATE users SET preferences = NULL"))

  "PATCH /api/users/me/preferences" should {

    "accumulate partial updates and keep the accent colour" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":320}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("contextListWidth") shouldBe JsNumber(320)
      }
      patch(userA, """{"contextListCollapsed":true}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val prefs = me(userA)
      prefs.fields("contextListWidth") shouldBe JsNumber(320)
      prefs.fields("contextListCollapsed") shouldBe JsBoolean(true)
      prefs.fields("accentColor") shouldBe JsString("#3b82f6")
    }

    "keep the shell keys when the accent changes afterwards (and vice versa)" in {
      reset()
      patch(userA, """{"contextListWidth":320,"contextListCollapsed":true}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      accent(userA, "#f97316") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val prefs = me(userA)
      prefs.fields("contextListWidth") shouldBe JsNumber(320)
      prefs.fields("contextListCollapsed") shouldBe JsBoolean(true)
      prefs.fields("accentColor") shouldBe JsString("#f97316")
    }

    "reject bad bodies with 400 and change nothing" in {
      reset()
      patch(userA, """{"contextListWidth":320}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val before = stored(userA)
      val bad = Seq(
        """{"contextListWidth":1000}""", """{"contextListWidth":199}""", """{"contextListWidth":"300"}""",
        """{"contextListWidth":300.5}""", """{"contextListCollapsed":"yes"}""", """{}""",
        """{"contextListWidth":300,"somethingElse":1}""", """{"accentColor":"#fff"}""", """[1]"""
      )
      bad.foreach { b =>
        withClue(b) { patch(userA, b) ~> routes ~> check { status shouldBe StatusCodes.BadRequest } }
      }
      stored(userA) shouldBe before
    }

    "accept the clamp boundaries 200 and 400" in {
      reset()
      patch(userA, """{"contextListWidth":200}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":400}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      me(userA).fields("contextListWidth") shouldBe JsNumber(400)
    }

    "accumulate appearance fields beside the shell fields and the accent" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":320}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"typeStyle":"serif"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("typeStyle") shouldBe JsString("serif")
      }
      patch(userA, """{"density":"compact","motion":"off"}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val prefs = me(userA)
      prefs.fields("typeStyle") shouldBe JsString("serif")
      prefs.fields("density") shouldBe JsString("compact")
      prefs.fields("motion") shouldBe JsString("off")
      prefs.fields("contextListWidth") shouldBe JsNumber(320)
      prefs.fields("accentColor") shouldBe JsString("#3b82f6")
    }

    "reject unknown appearance values with 400 and change nothing" in {
      reset()
      patch(userA, """{"typeStyle":"mono","density":"compact","motion":"full"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val before = stored(userA)
      Seq(
        """{"typeStyle":"comic"}""", """{"typeStyle":1}""", """{"typeStyle":null}""", """{"density":3}""",
        """{"density":"roomy"}""", """{"density":null}""", """{"motion":"slow"}""", """{"motion":false}""",
        """{"typeStyle":"serif","motion":"slow"}"""
      ).foreach { b =>
        withClue(b) { patch(userA, b) ~> routes ~> check { status shouldBe StatusCodes.BadRequest } }
      }
      stored(userA) shouldBe before
    }

    "clear the saved motion choice with null and leave every other field" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"motion":"full","typeStyle":"mono","contextListWidth":300}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      patch(userA, """{"motion":null}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields.get("motion") shouldBe None
      }
      patch(userA, """{"motion":null}""") ~> routes ~> check { status shouldBe StatusCodes.OK } // idempotent
      val prefs = me(userA)
      prefs.fields.get("motion") shouldBe None
      prefs.fields("typeStyle") shouldBe JsString("mono")
      prefs.fields("contextListWidth") shouldBe JsNumber(300)
      prefs.fields("accentColor") shouldBe JsString("#3b82f6")
      stored(userA).get should not include "motion"
    }

    "drop an invalid stored appearance value on /me" in {
      reset()
      await(privilegedDb.run(
        sqlu"""UPDATE users SET preferences = '{"typeStyle":"comic","density":"compact","motion":7}' WHERE id = $userA::uuid"""
      ))
      val prefs = me(userA)
      prefs.fields.get("typeStyle") shouldBe None
      prefs.fields.get("motion") shouldBe None
      prefs.fields("density") shouldBe JsString("compact")
    }

    "keep another user's appearance byte-identical through the app role" in {
      reset()
      patch(userA, """{"typeStyle":"serif"}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val before = stored(userA)
      patch(userB, """{"typeStyle":"mono","density":"compact","motion":"off"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      patch(userB, """{"motion":null}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      stored(userA) shouldBe before
      me(userB).fields("typeStyle") shouldBe JsString("mono")
      me(userA).fields("typeStyle") shouldBe JsString("serif")
    }

    "return 401 with no session" in {
      HttpRequest(HttpMethods.PATCH, "/api/users/me/preferences")
        .withEntity(jsonEntity("""{"contextListWidth":300}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "leave another user's stored preferences byte-identical" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":320}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val before = stored(userA)
      before should not be empty
      patch(userB, """{"contextListWidth":400,"contextListCollapsed":true}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      accent(userB, "#000000") ~> routes ~> check { status shouldBe StatusCodes.OK }
      stored(userA) shouldBe before
      me(userB).fields("contextListWidth") shouldBe JsNumber(400)
    }

    "treat invalid stored values as never set on /me" in {
      reset()
      await(privilegedDb.run(sqlu"""UPDATE users SET preferences = '{"contextListWidth":9999,"contextListCollapsed":"x","accentColor":"#111"}' WHERE id = $userC::uuid"""))
      val prefs = me(userC)
      prefs.fields.get("contextListWidth") shouldBe None
      prefs.fields.get("contextListCollapsed") shouldBe None
      prefs.fields("accentColor") shouldBe JsString("#111")
    }
  }
}
