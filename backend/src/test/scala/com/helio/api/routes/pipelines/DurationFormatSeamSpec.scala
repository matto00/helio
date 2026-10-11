package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.services.pipelines.{OutputConfigValidation, OutputFormatVocabulary}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.OutputHistoryApiHarness
import com.helio.domain.model._
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}
import scala.concurrent.ExecutionContext

/** HEL-1308 seam test, backend half (D8). `shared-test-fixtures/duration-format-seam.json` binds the frontend
 *  readers, this vocabulary and helio-mcp to one set of lists and one sentence. Every comparison is EXACT
 *  equality (never a substring), so each can fail. The create + PATCH round trip is a labelled GUARD: it already
 *  passed before this change (the backend never validated `format` / `columnFormats` values); mutation: making
 *  `OutputConfigValidation.mergeConfig` drop `format` / `columnFormats` from a PATCH turns both PATCH assertions red
 *  (run once: red-guard-backend-roundtrip-mutation.log). */
class DurationFormatSeamSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _
  private def owner           = AuthenticatedUser(UserId(ownerId))
  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }
  private def routes(): Route = new OutputRoutes(outputService, owner, Some(historyService))(harnessEc).routes

  private def read(path: String): JsObject = JsonParser(Files.readString(Paths.get(path))).asJsObject
  private val fixture                       = read("../shared-test-fixtures/duration-format-seam.json")
  private def strings(v: JsValue): Vector[String] = v.asInstanceOf[JsArray].elements.map(_.convertTo[String])
  private val lists                         = fixture.fields("lists").asJsObject
  private val configs                       = fixture.fields("configs").asJsObject
  private def cfg(name: String): (String, JsObject) = {
    val c = configs.fields(name).asJsObject
    (c.fields("kind").convertTo[String], c.fields("config").asJsObject)
  }

  private val schemaFiles = Vector(
    "../schemas/outputs/create-output-request.schema.json",
    "../schemas/outputs/update-output-request.schema.json",
    "../schemas/pipelines/create-pipeline-transactional-output-request.schema.json"
  )

  "OutputFormatVocabulary" should {
    "list exactly the fixture's ordered vocabularies" in {
      OutputFormatVocabulary.MetricFormats shouldBe strings(lists.fields("metricFormats"))
      OutputFormatVocabulary.ColumnFormatTypes shouldBe strings(lists.fields("columnFormatTypes"))
      OutputFormatVocabulary.ColumnDurationUnits shouldBe strings(lists.fields("columnDurationUnits"))
    }

    "build a Doc equal to the fixture sentence, which KeysDoc ends with" in {
      val sentence = fixture.fields("vocabularyDoc").convertTo[String]
      OutputFormatVocabulary.Doc shouldBe sentence
      OutputConfigValidation.KeysDoc.endsWith(sentence) shouldBe true
    }
  }

  "the three Output request schemas" should {
    "describe `format` and `columnFormats` exactly as the fixture does" in {
      val expected = fixture.fields("schemaDescriptions").asJsObject
      schemaFiles.foreach { file =>
        val props = read(file).fields("properties").asJsObject.fields("config").asJsObject.fields("properties").asJsObject
        withClue(file + ": ") {
          props.fields("format").asJsObject.fields("description") shouldBe expected.fields("format")
          props.fields("columnFormats").asJsObject.fields("description") shouldBe expected.fields("columnFormats")
        }
      }
    }
  }

  "duration configs (GUARD: already accepted before HEL-1308)" should {
    "be stored unchanged on create and on PATCH, and read back identical" in {
      val (pid, oid) = seedMetricOutput(ownerId, None)
      Seq("metric", "collection", "tableColumn").foreach { name =>
        val (kind, config) = cfg(name)
        withClue(name + " create: ") {
          Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, kind, "dur-" + name, Some(config))) ~> routes() ~> check {
            status shouldBe StatusCodes.Created
            val created = responseAs[OutputResponse]
            config.fields.foreach { case (k, v) => created.config.asJsObject.fields(k) shouldBe v }
            Get(s"/outputs/${created.id}") ~> routes() ~> check {
              config.fields.foreach { case (k, v) => responseAs[OutputResponse].config.asJsObject.fields(k) shouldBe v }
            }
          }
        }
      }
      val (_, metricCfg) = cfg("metric")
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(metricCfg))) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputResponse].config.asJsObject.fields("format") shouldBe metricCfg.fields("format")
      }
    }

    "PATCH a table column duration spec and read it back unchanged" in {
      val (pid, _)   = seedMetricOutput(ownerId, None)
      val (_, table) = cfg("tableColumn")
      Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "t", Some(JsObject()))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val id = responseAs[OutputResponse].id
        Patch(s"/outputs/$id", UpdateOutputRequest(None, Some(table))) ~> routes() ~> check {
          status shouldBe StatusCodes.OK
          responseAs[OutputResponse].config.asJsObject.fields("columnFormats") shouldBe table.fields("columnFormats")
        }
      }
    }
  }
}
