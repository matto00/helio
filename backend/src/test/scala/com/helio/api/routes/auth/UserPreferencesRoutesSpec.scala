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

  "PATCH /api/users/me/preferences dashboardTabs (HEL-1575)" should {

    val tabs =
      """{"dashboardTabs":{"tabs":[{"id":"d1","lastViewedAt":"2026-10-15T10:00:00Z","ownWriteAt":"2026-10-15T10:01:00Z"},{"id":"d2","lastViewedAt":null}],"activeId":"d2"}}"""

    "accumulate with width and accent, and be delivered on /me" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":320}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, tabs) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields.keySet should contain("dashboardTabs")
      }
      val prefs = me(userA)
      prefs.fields("contextListWidth") shouldBe JsNumber(320)
      prefs.fields("accentColor") shouldBe JsString("#3b82f6")
      val saved = prefs.fields("dashboardTabs").asJsObject
      saved.fields("activeId") shouldBe JsString("d2")
      saved.fields("tabs").asInstanceOf[JsArray].elements.map(_.asJsObject.fields("id")) shouldBe
        Vector(JsString("d1"), JsString("d2"))
      saved.fields("tabs").asInstanceOf[JsArray].elements.head.asJsObject.fields("ownWriteAt") shouldBe
        JsString("2026-10-15T10:01:00Z")
    }

    "replace the whole tab set and keep an empty set empty" in {
      reset()
      patch(userA, tabs) ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"dashboardTabs":{"tabs":[],"activeId":null}}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      val saved = me(userA).fields("dashboardTabs").asJsObject
      saved.fields("tabs") shouldBe JsArray()
      saved.fields.get("activeId") shouldBe None
    }

    "reject every invalid tab set with 400 and change nothing" in {
      reset()
      patch(userA, tabs) ~> routes ~> check { status shouldBe StatusCodes.OK }
      val before = stored(userA)
      val twentyOne = (1 to 21).map(i => s"""{"id":"t$i"}""").mkString(",")
      val bad = Seq(
        s"""{"dashboardTabs":{"tabs":[$twentyOne],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a"},{"id":"a"}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a"}],"activeId":"zzz"}}""",
        """{"dashboardTabs":{"tabs":[{"id":""}],"activeId":null}}""",
        s"""{"dashboardTabs":{"tabs":[{"id":"${"x" * 65}"}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a","lastViewedAt":"yesterday"}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a","ownWriteAt":"not-a-time"}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a","ownWriteAt":5}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":[{"id":"a","extra":1}],"activeId":null}}""",
        """{"dashboardTabs":{"tabs":"a","activeId":null}}""",
        """{"dashboardTabs":{"tabs":[],"activeId":null,"extra":1}}""",
        """{"dashboardTabs":[]}"""
      )
      bad.foreach { b =>
        withClue(b) { patch(userA, b) ~> routes ~> check { status shouldBe StatusCodes.BadRequest } }
      }
      stored(userA) shouldBe before
    }

    "leave every stored appearance key byte-identical on a dashboardTabs write (HEL-1572 x HEL-1575)" in {
      reset()
      accent(userA, "#3b82f6") ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"contextListWidth":320,"typeStyle":"serif","density":"compact","motion":"off"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val appearanceKeys = Seq("accentColor", "contextListWidth", "typeStyle", "density", "motion")
      def kept(raw: Option[String]): Map[String, JsValue] =
        raw.get.parseJson.asJsObject.fields.view.filterKeys(appearanceKeys.contains).toMap
      val before = kept(stored(userA))
      before.keySet shouldBe appearanceKeys.toSet
      patch(userA, tabs) ~> routes ~> check { status shouldBe StatusCodes.OK }
      kept(stored(userA)) shouldBe before
      me(userA).fields.keySet should contain allOf ("dashboardTabs", "typeStyle", "density", "motion")
    }

    "leave the stored dashboardTabs unchanged on an appearance write, including a motion null clear" in {
      reset()
      patch(userA, tabs) ~> routes ~> check { status shouldBe StatusCodes.OK }
      patch(userA, """{"typeStyle":"mono","density":"compact","motion":"subtle"}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      def storedTabs: Option[JsValue] = stored(userA).get.parseJson.asJsObject.fields.get("dashboardTabs")
      val before = storedTabs
      before should not be empty
      patch(userA, """{"typeStyle":"serif"}""") ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedTabs shouldBe before
      patch(userA, """{"motion":null}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val fields = responseAs[String].parseJson.asJsObject.fields
        fields.get("motion") shouldBe None
        fields.get("dashboardTabs") shouldBe before
      }
      storedTabs shouldBe before
      stored(userA).get should not include "motion"
      me(userA).fields("typeStyle") shouldBe JsString("serif")
    }

    "apply both kinds of key in one body, and reject a body whose tabs are invalid without applying the appearance half" in {
      reset()
      patch(userA, """{"density":"compact","motion":"full","contextListWidth":280}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      patch(userA, tabs.stripSuffix("}") + ""","typeStyle":"serif","motion":null}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      val prefs = me(userA)
      prefs.fields("typeStyle") shouldBe JsString("serif")
      prefs.fields("density") shouldBe JsString("compact")
      prefs.fields.get("motion") shouldBe None
      prefs.fields("contextListWidth") shouldBe JsNumber(280)
      prefs.fields("dashboardTabs").asJsObject.fields("activeId") shouldBe JsString("d2")

      val before = stored(userA)
      patch(userA, """{"typeStyle":"mono","dashboardTabs":{"tabs":[{"id":"a"},{"id":"a"}],"activeId":null}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      stored(userA) shouldBe before
    }

    "accept exactly 20 tabs" in {
      reset()
      val twenty = (1 to 20).map(i => s"""{"id":"t$i"}""").mkString(",")
      patch(userA, s"""{"dashboardTabs":{"tabs":[$twenty],"activeId":"t20"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "leave another user's stored preferences byte-identical" in {
      reset()
      patch(userA, tabs) ~> routes ~> check { status shouldBe StatusCodes.OK }
      val before = stored(userA)
      patch(userB, """{"dashboardTabs":{"tabs":[{"id":"b1"}],"activeId":"b1"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      stored(userA) shouldBe before
      me(userB).fields("dashboardTabs").asJsObject.fields("activeId") shouldBe JsString("b1")
    }

    "read an invalid stored tab set as never set" in {
      reset()
      await(privilegedDb.run(sqlu"""UPDATE users SET preferences = '{"dashboardTabs":{"tabs":[{"id":"a"},{"id":"a"}],"activeId":"a"},"accentColor":"#111"}' WHERE id = $userC::uuid"""))
      val prefs = me(userC)
      prefs.fields.get("dashboardTabs") shouldBe None
      prefs.fields("accentColor") shouldBe JsString("#111")
    }
  }
}
