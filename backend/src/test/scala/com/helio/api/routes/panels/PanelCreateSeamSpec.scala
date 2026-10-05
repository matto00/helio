package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

import java.nio.file.{Files, Paths}

/** Server half of the client/server seam for panel create placement (HEL-1260, C2). The client half
 *  (`layoutCreateSeam.test.ts`) proves each fixture layout is valid, stable on reload and a no-op to
 *  re-send. Here the fixture's operations run through the real routes, the stored layout must equal the
 *  fixture, and every breakpoint is re-sent through the real layout PATCH (the HEL-1071 validator). sbt
 *  runs with cwd `backend/`. */
class PanelCreateSeamSpec extends ApplyProposalSpecBase {

  private val fixture: JsObject = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/layout-create-seam.json"))).asJsObject

  private def configFor(kind: String): String = kind match {
    case "output" => s""","config":{"outputId":"$pipelineOutputId"}"""
    case "form"   => s""","config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"number","step":1,"required":true}],"submit":{"writeMode":"append"}}"""
    case _        => ""
  }

  private def panelJson(kind: String): String = s""""title":"$kind","type":"$kind"${configFor(kind)}"""

  private def idOfCreated(): String = responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]

  private def remap(v: JsValue, ids: Map[String, String]): JsValue = v match {
    case JsObject(fs) => JsObject(fs.map {
      case ("panelId", JsString(p)) => "panelId" -> JsString(ids.getOrElse(p, p))
      case (k, x)                   => k -> remap(x, ids)
    })
    case JsArray(xs) => JsArray(xs.map(remap(_, ids)))
    case other       => other
  }

  private def newDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private def patchLayout(dashboardId: String, layout: JsValue): Unit =
    Patch(s"/api/dashboards/$dashboardId", json(s"""{"layout":${layout.compactPrint}}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.OK
    }

  /** Runs `operations` and returns (dashboardId, real ids in creation order). */
  private def run(name: String, operations: Vector[JsObject]): (String, Vector[String]) = {
    def isProposal = operations.exists(_.fields("op") == JsString("proposal"))
    if (isProposal) {
      val body =
        s"""{"dashboardName":"$name","panels":[
           |  {"title":"Authored","type":"output","outputId":"$pipelineOutputId","layout":{"x":0,"y":0,"w":4,"h":3}},
           |  {"title":"Unplaced","type":"text"}]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        (obj.fields("dashboard").asJsObject.fields("id").convertTo[String], obj.fields("panels").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String]))
      }
    } else {
      val dashboardId = newDashboard(name)
      var ids         = Vector.empty[String]
      operations.foreach { op =>
        op.fields("op").convertTo[String] match {
          case "create" =>
            Post("/api/panels", json(s"""{"dashboardId":"$dashboardId",${panelJson(op.fields("kind").convertTo[String])}}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
              status shouldBe StatusCodes.Created
              ids :+= idOfCreated()
            }
          case "batch" =>
            val panels = op.fields("kinds").convertTo[Vector[String]].map(k => s"{${panelJson(k)}}").mkString(",")
            Post("/api/panels/batch", json(s"""{"dashboardId":"$dashboardId","panels":[$panels]}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
              status shouldBe StatusCodes.Created
              ids ++= responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsObject]].map(_.fields("id").convertTo[String])
            }
          case "overwrite" =>
            overwriteStoredLayout(dashboardId, remap(op.fields("layout"), Map("p1" -> ids.head)).compactPrint)
          case "duplicate" =>
            Post(s"/api/panels/${ids.head}/duplicate").addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
              status shouldBe StatusCodes.Created
              ids :+= idOfCreated()
            }
        }
      }
      (dashboardId, ids)
    }
  }

  "the panel create seam fixture" should {
    fixture.fields("cases").convertTo[Vector[JsObject]].foreach { c =>
      val name = c.fields("name").convertTo[String]
      s"store exactly the fixture layout and pass the layout validator: $name" in {
        val (dashboardId, ids) = run("seam-" + name.hashCode, c.fields("operations").convertTo[Vector[JsObject]])
        val placeholders       = c.fields("panels").convertTo[Vector[String]]
        val mapping            = placeholders.zip(ids).toMap
        val expected           = remap(c.fields("layout"), mapping).asJsObject
        storedLayoutJson(dashboardId) shouldBe expected
        patchLayout(dashboardId, expected)
        storedLayoutJson(dashboardId) shouldBe expected
      }
    }

    "accept the client's patch for a create that landed under a pending local drag" in {
      val pending            = fixture.fields("pendingDrag").asJsObject
      val dashboardId        = newDashboard("seam-pending-drag")
      val ids = Vector("text", "text").map { kind =>
        Post("/api/panels", json(s"""{"dashboardId":"$dashboardId",${panelJson(kind)}}""")).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check { idOfCreated() }
      }
      val mapping = pending.fields("panels").convertTo[Vector[String]].zip(ids).toMap
      storedLayoutJson(dashboardId) shouldBe remap(pending.fields("stored"), mapping)
      patchLayout(dashboardId, remap(pending.fields("patch"), mapping))
    }
  }
}
