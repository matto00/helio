package com.helio.api.routes.dashboards

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import com.helio.services.panels.{LayoutBreakpointScaling, LayoutValidator}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.nio.file.{Files, Paths}

/** Server half of the client/server seam for the owner's stored-layout repair (HEL-1233). The client
 *  half (`repairPatch.seam.test.ts`) proves `buildRepairPatch` produces each case's `expectedRepair`
 *  from its stored layout; this spec seeds that same stored layout (raw SQL, never a validating
 *  path), POSTs the SAME `expectedRepair` to the endpoint and proves the server accepts it, stores
 *  it, and that it passes the HEL-1071 validator. sbt runs with cwd `backend/`. */
class DashboardLayoutRepairSeamSpec extends ApplyProposalSpecBase {

  private val fixture: JsObject =
    JsonParser(Files.readString(Paths.get("../shared-test-fixtures/layout-repair-seam.json"))).asJsObject

  private def createDivider(dashboardId: String, title: String): String =
    Post("/api/panels", json(s"""{"dashboardId":"$dashboardId","title":"$title","type":"divider"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  /** Rewrites fixture placeholder panel ids to the created panels' real ids; unmapped ids (a deleted panel's) stay. */
  private def remap(v: JsValue, ids: Map[String, String]): JsValue = v match {
    case JsObject(fs) => JsObject(fs.map {
      case ("panelId", JsString(p)) => "panelId" -> JsString(ids.getOrElse(p, p))
      case (k, x)                   => k -> remap(x, ids)
    })
    case JsArray(xs) => JsArray(xs.map(remap(_, ids)))
    case other       => other
  }

  private def toRect(o: JsObject): LayoutValidator.Rect =
    LayoutValidator.Rect(o.fields("panelId").convertTo[String], o.fields("x").convertTo[Int], o.fields("y").convertTo[Int], o.fields("w").convertTo[Int], o.fields("h").convertTo[Int])

  "the stored-layout repair seam fixture" should {
    fixture.fields("cases").convertTo[Vector[JsObject]].foreach { c =>
      val name = c.fields("name").convertTo[String]
      s"be accepted and stored by the server: $name" in {
        val dashboardId = seedDashboardWithLayout("seam-" + name.hashCode, userId, """{"lg":[],"md":[],"sm":[],"xs":[]}""")
        val ids = c.fields("panels").convertTo[Vector[String]].map(p => p -> createDivider(dashboardId, p)).toMap
        val stored   = remap(c.fields("layout"), ids).asJsObject
        val expected = remap(c.fields("expectedRepair"), ids).asJsObject
        overwriteStoredLayout(dashboardId, stored.compactPrint)

        Post(s"/api/dashboards/$dashboardId/layout/repair", json(expected.compactPrint))
          .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { status shouldBe StatusCodes.OK }

        val after = storedLayoutJson(dashboardId)
        expected.fields.foreach { case (bp, items) =>
          after.fields(bp) shouldBe items
          val rects = items.convertTo[Vector[JsObject]].map(toRect)
          LayoutValidator.isValid(rects, LayoutBreakpointScaling.breakpointCols(bp)) shouldBe true
          val storedRects = stored.fields(bp).convertTo[Vector[JsObject]]
          val storedBad = !LayoutValidator.isValid(storedRects.map(toRect), LayoutBreakpointScaling.breakpointCols(bp))
          // An incomplete-but-valid breakpoint is repaired append-only: every stored item survives unchanged.
          if (!storedBad) storedRects.filter(o => ids.values.toSet.contains(o.fields("panelId").convertTo[String])).foreach(o => items.convertTo[Vector[JsValue]] should contain(o))
        }
        stored.fields.keySet.diff(expected.fields.keySet).foreach(bp => after.fields(bp) shouldBe stored.fields(bp))
      }
    }
  }

}
