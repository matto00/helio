package com.helio.testsupport

import com.helio.domain.ai.{AiStepClient, AiStepFailure, AiStepRequest}
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.http.scaladsl.model.{HttpMethods, HttpRequest, StatusCode}
import slick.dbio.DBIO
import spray.json._

import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1630: the full route tree over a non-BYPASSRLS pool (see [[TwoUserRlsApiFixture]]) plus what every draft-preview spec
 *  needs: counters on the two things the endpoint must never touch (a data-source read, an AI call) that live OUTSIDE the code
 *  under test, a request helper, and an NDJSON reader that checks every line against the committed schema as it parses it. */
abstract class DraftPreviewApiFixture extends DraftSaveApiFixture {

  /** Every database action the data-source repository issues: any read of any source, primary or secondary. */
  protected val sourceAccess = new AtomicInteger(0)

  /** Every AI model call the engine's client receives. */
  protected val aiCalls = new AtomicInteger(0)

  private val lineSchema = JsonSchemaValidation.compile("pipelines/draft-preview-line.schema.json")
  private val requestSchema = JsonSchemaValidation.compile("pipelines/draft-preview-request.schema.json")

  override protected def dataSourceRepoFor(ctx: DbContext)(implicit ec: ExecutionContext): DataSourceRepository =
    new DataSourceRepository(new DbContext(null, null) {
      override def withUserContext[R](userId: String)(action: DBIO[R]): Future[R] = { sourceAccess.incrementAndGet(); ctx.withUserContext(userId)(action) }
      override def withSystemContext[R](action: DBIO[R]): Future[R]               = { sourceAccess.incrementAndGet(); ctx.withSystemContext(action) }
    })

  private val countingAi: AiStepClient = (_: AiStepRequest) => {
    aiCalls.incrementAndGet()
    Future.successful(Left(AiStepFailure.Unavailable("counting stub")))
  }

  /** A fresh engine over the counting AI client; a spec that wraps the engine overrides [[draftPreviewEngine]] itself. */
  protected def countingEngine(implicit ec: ExecutionContext): InProcessPipelineEngine =
    new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")), aiStepClient = countingAi)

  override protected def draftPreviewEngine(implicit ec: ExecutionContext): Option[InProcessPipelineEngine] = Some(countingEngine)

  /** A response: status, content type and the whole body (the testkit collects the stream to its end). */
  protected final case class Preview(status: StatusCode, contentType: String, body: String) {
    def parsed: Vector[JsObject] = body.linesIterator.filter(_.nonEmpty).map(_.parseJson.asJsObject).toVector
    def lines: Vector[JsObject] = {
      val all = parsed
      all.foreach(l => withClue(l.compactPrint)(JsonSchemaValidation.validationErrors(lineSchema, l.compactPrint) shouldBe empty))
      all
    }
    def types: Vector[String] = lines.map(_.fields("type").convertTo[String])
    def ofType(t: String): Vector[JsObject] = lines.filter(_.fields("type") == JsString(t))
    def rowsLine: JsObject = lines.last
  }

  protected def previewRequest(seed: DraftSaveSeed, user: String, body: String): HttpRequest =
    req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/draft-preview", user, Some(body))

  /** Posts `body` as `user` and reads the whole response. */
  protected def preview(seed: DraftSaveSeed, user: String, body: JsObject): Preview = previewRaw(seed, user, body.compactPrint)

  protected def previewRaw(seed: DraftSaveSeed, user: String, body: String): Preview =
    previewRequest(seed, user, body) ~> routes ~> check { Preview(status, contentType.toString, responseAs[String]) }

  /** A request body that satisfies the committed request schema; a spec that builds one by hand calls this to prove it. */
  protected def assertValidRequest(body: JsObject): Unit =
    JsonSchemaValidation.validationErrors(requestSchema, body.compactPrint) shouldBe empty

  // ── body builders ─────────────────────────────────────────────────────────────────────────────────────────────────
  protected def jstr(s: String): JsValue = JsString(s)
  protected def jobj(fields: (String, JsValue)*): JsObject = JsObject(fields.toMap)
  protected def jrows(rows: JsObject*): JsArray = JsArray(rows.toVector)
  protected def rootOf(id: String, rows: JsObject*): JsObject = jobj("id" -> jstr(id), "rows" -> jrows(rows: _*))

  protected def stepJson(id: String, kind: String, config: JsObject, parent: Option[String] = None, root: String = "r", enabled: Boolean = true, position: Int = 0): JsObject =
    JsObject(
      Map("id" -> jstr(id), "kind" -> jstr(kind), "enabled" -> JsBoolean(enabled), "position" -> JsNumber(position), "config" -> config) ++
        parent.map(p => "parentStepId" -> jstr(p)).orElse(Some("rootId" -> jstr(root)))
    )

  protected def limitStep(id: String, count: Int, parent: Option[String] = None, root: String = "r", position: Int = 0, enabled: Boolean = true): JsObject =
    stepJson(id, "limit", jobj("count" -> JsNumber(count)), parent, root, enabled, position)

  protected def draftBody(roots: Vector[JsObject], steps: Vector[JsObject], extra: (String, JsValue)*): JsObject =
    JsObject(Map("roots" -> JsArray(roots), "steps" -> JsArray(steps)) ++ extra)

  protected def intCell(n: Int): JsValue = jobj("$int" -> JsNumber(n))
}
