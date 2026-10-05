package com.helio.api.routes.panels

import com.helio.api.routes.proposals.ApplyProposalSpecBase
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** Route-level round-trip coverage for the `form` panel kind (HEL-1083),
 *  spec `form-panel-type`. Shares the real-RLS fixture with the other
 *  panel/proposal route specs via `ApplyProposalSpecBase`. */
class FormPanelRoundTripSpec extends ApplyProposalSpecBase {

  private def createDashboard(name: String): String =
    Post("/api/dashboards", json(s"""{"name":"$name"}"""))
      .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
    }

  private val formFieldsJson =
    """[
      |  {"sourceField":"quantity","control":"number","step":1,"required":true},
      |  {"sourceField":"note","control":"text","label":"Note","placeholder":"optional"}
      |]""".stripMargin

  private def createFormPanelBody(dashboardId: String, dataSourceId: String): String =
    s"""{"dashboardId":"$dashboardId","title":"Order Form","type":"form",
       |"config":{"dataSourceId":"$dataSourceId","fields":$formFieldsJson,"submit":{"writeMode":"append"}}}""".stripMargin

  "POST /api/panels — form kind" should {

    // 4.3a — asserts the ENCODE path only; PanelRepository.insert returns
    // the in-memory panel and PanelRoutes exposes no authenticated GET, so
    // this test never reaches rowToDomain and cannot detect a missing
    // mapper arm (C7) — that is 4.3b's job.
    "round-trip dataSourceId, every field attribute, and field order on create" in {
      val dashboardId = createDashboard("Form Create Target")
      Post("/api/panels", json(createFormPanelBody(dashboardId, datasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val body = responseAs[String].parseJson.asJsObject
        body.fields("type") shouldBe JsString("form")
        val config = body.fields("config").asJsObject
        config.fields("dataSourceId") shouldBe JsString(datasetSourceId)
        val fields = config.fields("fields").convertTo[Vector[JsValue]].map(_.asJsObject)
        fields.map(_.fields("sourceField").convertTo[String]) shouldBe Vector("quantity", "note")
        fields.head.fields("step") shouldBe JsNumber(1)
        fields.head.fields("required") shouldBe JsBoolean(true)
        fields(1).fields("label") shouldBe JsString("Note")
        config.fields("submit").asJsObject.fields("writeMode") shouldBe JsString("append")
      }
    }

    "require no Output binding — a form panel is still placed, at the content default size (HEL-1260)" in {
      val dashboardId = createDashboard("Form No Output Binding")
      Post("/api/panels", json(createFormPanelBody(dashboardId, datasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        // Placement no longer depends on the kind (HEL-1260); only the size does: the Output
        // decision-15 table is for output panels, the client's 4x5 render default for the rest.
        val body = responseAs[String].parseJson.asJsObject
        body.fields("layout") shouldBe JsObject("x" -> JsNumber(0), "y" -> JsNumber(0), "w" -> JsNumber(4), "h" -> JsNumber(5))
        body.fields("layouts").asJsObject.fields.keySet shouldBe Set("lg", "md", "sm", "xs")
      }
    }

    // 4.3b — re-reads through PATCH, which traverses PanelRowMapper.rowToDomain
    // (PanelRepository.replace's `.andThen(...).result.headOption).map(_.map(rowToDomain))`).
    // Proves the row survives a REAL decode, not just the in-memory create echo.
    "decode as a FormPanel (never OutputPanel) on a re-read that traverses rowToDomain" in {
      val dashboardId = createDashboard("Form Re-Read Target")
      val panelId = Post("/api/panels", json(createFormPanelBody(dashboardId, datasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
      }

      // A title-only PATCH still round-trips through `replace()`'s DB
      // re-read → `rowToDomain`, so the response config below is NOT the
      // in-memory create echo — it is what the row actually decoded to.
      Patch(s"/api/panels/$panelId", json("""{"title":"Order Form (renamed)"}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String].parseJson.asJsObject
        body.fields("type") shouldBe JsString("form")
        val config = body.fields("config").asJsObject
        config.fields("dataSourceId") shouldBe JsString(datasetSourceId)
        config.fields("fields").convertTo[Vector[JsValue]].map(_.asJsObject.fields("sourceField").convertTo[String]) shouldBe
          Vector("quantity", "note")
      }
    }

    // Task 1.8 / C4 — a PATCH to `config` must actually persist the new
    // `form_config` value, not silently keep the old one while echoing the
    // new one in the response body (the HEL-296/HEL-909 `output_id` failure
    // mode this fold-in exists to close). Task 4.8's mutation removes
    // `form_config` from `configColumnsOf` and records THIS test going red.
    "persist a config PATCH's new fields — not just echo them in the response" in {
      val dashboardId = createDashboard("Form Patch Target")
      val panelId = Post("/api/panels", json(createFormPanelBody(dashboardId, datasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
      }

      val patchedFields =
        """[{"sourceField":"total","control":"number","step":5}]"""
      Patch(
        s"/api/panels/$panelId",
        json(s"""{"config":{"dataSourceId":"$datasetSourceId","fields":$patchedFields,"submit":{"writeMode":"append"}}}""")
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      // Re-read via a SECOND PATCH (no-op title touch) — re-traverses
      // rowToDomain from the actually-stored row, not an in-memory echo.
      Patch(s"/api/panels/$panelId", json("""{"title":"Order Form (patched)"}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val fields = responseAs[String].parseJson.asJsObject.fields("config").asJsObject
          .fields("fields").convertTo[Vector[JsValue]].map(_.asJsObject)
        fields.map(_.fields("sourceField").convertTo[String]) shouldBe Vector("total")
        fields.head.fields("step") shouldBe JsNumber(5)
      }
    }

    "reject a cross-owner dataSourceId with 404, never 403 or 500" in {
      val dashboardId = createDashboard("Form Cross-Owner Target")
      Post("/api/panels", json(createFormPanelBody(dashboardId, otherDatasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // evaluation-1.md CR3: an unrecognized TOP-LEVEL config key (e.g. a
    // "submitt" typo) must 400, not silently discard the caller's intended
    // "submit" value.
    "reject an unrecognized top-level config attribute with 400, never silently dropping it" in {
      val dashboardId = createDashboard("Form Unknown Top-Level Key")
      Post(
        "/api/panels",
        json(
          s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
             |"config":{"dataSourceId":"$datasetSourceId","fields":[],
             |"submitt":{"writeMode":"append"},"bogusTopLevel":123}}""".stripMargin
        )
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val msg = responseAs[String]
        msg should include("bogusTopLevel")
        msg should include("submitt")
      }
    }

    "reject an empty dataSourceId with 400 naming dataSourceId" in {
      val dashboardId = createDashboard("Form Missing DataSource")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form","config":{}}""")
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("dataSourceId")
      }
    }

    // HEL-1084 task 4.2 — the schema-consistency checks (design.md D1).
    "reject a form bound to a csv-kind source, naming csv" in {
      val dashboardId = createDashboard("Form Csv Bound")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$csvSourceId","fields":[],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("csv")
      }
    }

    "reject an undeclared sourceField, naming it" in {
      val dashboardId = createDashboard("Form Undeclared Field")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"legacy","control":"text"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("legacy")
      }
    }

    "reject checkbox on a declared string field, naming the fitting controls" in {
      val dashboardId = createDashboard("Form Unfit Control")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"note","control":"checkbox"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("note")
      }
    }

    "accept text on a declared integer field" in {
      val dashboardId = createDashboard("Form Fitting Control")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Ok Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"text"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    "reject wrongly typed options, naming the offending value" in {
      val dashboardId = createDashboard("Form Bad Options")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"select","options":[1,"two"]}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("two")
      }
    }

    "reject empty-array options" in {
      val dashboardId = createDashboard("Form Empty Options")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"select","options":[]}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject non-array options" in {
      val dashboardId = createDashboard("Form NonArray Options")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"select","options":"nope"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject a wrongly typed initialValue on a timestamp field" in {
      val dashboardId = createDashboard("Form Bad InitialValue")
      Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Bad Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"when","control":"text","initialValue":"soon"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject a PATCH that re-binds dataSourceId only to a dataset lacking an existing field — panel unchanged" in {
      val dashboardId = createDashboard("Form Rebind Target")
      val panelId = Post(
        "/api/panels",
        json(s"""{"dashboardId":"$dashboardId","title":"Rebind Form","type":"form",
                |"config":{"dataSourceId":"$datasetSourceId","fields":[{"sourceField":"quantity","control":"number"}],"submit":{"writeMode":"append"}}}""".stripMargin)
      ).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        responseAs[String].parseJson.asJsObject.fields("id").convertTo[String]
      }

      Patch(s"/api/panels/$panelId", json(s"""{"config":{"dataSourceId":"$datasetSourceIdWithoutQuantity"}}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("quantity")
      }

      // C7 — re-read via a no-op title touch: the panel is unchanged, still
      // bound to the original dataset.
      Patch(s"/api/panels/$panelId", json("""{"title":"Rebind Form (unchanged)"}"""))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("config").asJsObject
          .fields("dataSourceId") shouldBe JsString(datasetSourceId)
      }
    }

    "accept a config whose every field is declared, fits, and carries valid typed options/initialValue" in {
      val dashboardId = createDashboard("Form Consistent Config")
      val body =
        s"""{"dashboardId":"$dashboardId","title":"Consistent Form","type":"form",
           |"config":{"dataSourceId":"$datasetSourceId","fields":[
           |  {"sourceField":"quantity","control":"select","options":[1,2,3],"initialValue":2},
           |  {"sourceField":"flag","control":"checkbox"}
           |],"submit":{"writeMode":"append"}}}""".stripMargin
      Post("/api/panels", json(body)).addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val config = responseAs[String].parseJson.asJsObject.fields("config").asJsObject
        config.fields("fields").convertTo[Vector[JsValue]].map(_.asJsObject.fields("sourceField").convertTo[String]) shouldBe
          Vector("quantity", "flag")
      }
    }
  }

  "Dashboard export/import — form kind" should {
    // 4.4
    "preserve dataSourceId, ordered fields, and submit through export then import" in {
      val dashboardId = createDashboard("Form Export Target")
      Post("/api/panels", json(createFormPanelBody(dashboardId, datasetSourceId)))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }

      val snapshot = Get(s"/api/dashboards/$dashboardId/export").addHeader(sessionCookie) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String]
      }

      Post("/api/dashboards/import", json(snapshot))
        .addHeader(sessionCookie).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val panels = responseAs[String].parseJson.asJsObject.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val formPanel = panels.find(_.fields("title").convertTo[String] == "Order Form").get
        formPanel.fields("type") shouldBe JsString("form")
        val config = formPanel.fields("config").asJsObject
        config.fields("dataSourceId") shouldBe JsString(datasetSourceId)
        config.fields("fields").convertTo[Vector[JsValue]].map(_.asJsObject.fields("sourceField").convertTo[String]) shouldBe
          Vector("quantity", "note")
        config.fields("submit").asJsObject.fields("writeMode") shouldBe JsString("append")
      }
    }
  }

  "POST /api/dashboards/apply-proposal — form kind (design.md D7/C6)" should {
    // 4.6 — the no-config shape fails loudly.
    "reject an agent-proposed form panel with no config — 400 naming dataSourceId, nothing created" in {
      val before = dashboardCount()
      val body =
        """{"dashboardName":"Agent Form (unbound)","panels":[{"title":"Log Entry","type":"form"}]}"""
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("dataSourceId")
      }
      dashboardCount() shouldBe before
    }

    // 4.6b (HEL-1148: deliberately updated, NOT weakened) — the binding is now the first-class flat
    // `dataSourceId`; the generic `config` passthrough alone is no longer a binding (it was an
    // undocumented path no schema/tool told an agent about) and is rejected, naming the flat field.
    "create an agent-proposed form panel whose flat dataSourceId is owned by the caller" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Agent Form (bound)","panels":[
           |  {"title":"Log Entry","type":"form","dataSourceId":"$datasetSourceId","config":{"fields":$formFieldsJson,"submit":{"writeMode":"append"}}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)
        val formPanel = panels.find(_.fields("title").convertTo[String] == "Log Entry").get
        formPanel.fields("config").asJsObject.fields("dataSourceId") shouldBe JsString(datasetSourceId)
      }
      dashboardCount() shouldBe (before + 1)
    }

    "reject an agent-proposed form panel bound only through config.dataSourceId — 400 naming the flat dataSourceId" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Agent Form (config-only)","panels":[
           |  {"title":"Log Entry","type":"form","config":{"dataSourceId":"$datasetSourceId","fields":$formFieldsJson,"submit":{"writeMode":"append"}}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("a form panel requires a dataSourceId")
      }
      dashboardCount() shouldBe before
    }

    // 4.6b — the security-relevant assertion, retained: a cross-owner dataSourceId is still rejected
    // and nothing is created. HEL-1148: now a 400 (the proposal path reports every binding failure
    // as a 400, like an Output binding), with the same message a nonexistent id gets (no oracle).
    "reject an agent-proposed form panel whose flat dataSourceId is owned by another user — nothing created" in {
      val before = dashboardCount()
      val body =
        s"""{"dashboardName":"Agent Form (cross-owner)","panels":[
           |  {"title":"Log Entry","type":"form","dataSourceId":"$otherDatasetSourceId","config":{"fields":$formFieldsJson,"submit":{"writeMode":"append"}}}
           |]}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("Data source not found")
      }
      dashboardCount() shouldBe before
    }
  }
}
