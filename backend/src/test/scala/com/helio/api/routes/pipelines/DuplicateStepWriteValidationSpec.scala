package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import com.helio.api.JsonProtocols
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineService
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import com.helio.testsupport.DatasetRowsTestSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1476: `POST /pipeline-steps/:id/duplicate` runs the same strict write-path config check
 *  (`PipelineStep.rawConfigProblem`) as create/update on the config it would write. A STORED row that
 *  check rejects (a legacy cast target, ...) yields the same 422 and no clone; a create-accepted
 *  incomplete draft stays duplicable. Stored rows are seeded by SQL because every write surface rejects them. */
class DuplicateStepWriteValidationSpec
    extends AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var pipelineService: PipelineService   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineService = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx)(routeEc), dataSourceRepo,
      outputRepo = new OutputRepository(ctx)(routeEc), pipelineRootRepo = new PipelineRootRepository(ctx)(routeEc)
    )(routeEc)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def newUser(): AuthenticatedUser = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def newSource(owner: AuthenticatedUser): String = {
    import PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"doc","type":"string"}],"rows":[["a"],["b"]]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, ${s"ds-$dsId"}, 'dataset', '{}', ${owner.id.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  private def routesFor(owner: AuthenticatedUser): Route =
    concat(new PipelineRoutes(pipelineService, owner).routes, new PipelineStepRoutes(pipelineService, owner).routes)

  private def emptyPipeline(owner: AuthenticatedUser): PipelineId = {
    var pid = PipelineId("")
    val body = JsObject("name" -> JsString(s"p-${UUID.randomUUID()}"),
      "roots" -> JsArray(JsObject("sourceId" -> JsString(newSource(owner)))), "steps" -> JsArray.empty)
    Post("/pipelines", body) ~> routesFor(owner) ~> check {
      status shouldBe StatusCodes.Created
      pid = PipelineId(responseAs[JsObject].fields("id").convertTo[String])
    }
    pid
  }

  /** A stored row inserted by SQL (every write surface rejects these), on the pipeline's first root. */
  private def seedStored(pid: PipelineId, kind: String, config: String): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($id, ${pid.value}, 0, $kind, $config::jsonb, true, now(), now(), NULL,
                     (SELECT id FROM pipeline_roots WHERE pipeline_id = ${pid.value} ORDER BY position LIMIT 1))"""
    ))
    id
  }

  private def stepCount(owner: AuthenticatedUser, pid: PipelineId): Int = {
    var n = -1
    Get(s"/pipelines/${pid.value}/steps") ~> routesFor(owner) ~> check { n = responseAs[JsArray].elements.size }
    n
  }

  private def storedConfig(id: String): JsObject = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT config::text FROM pipeline_steps WHERE id = $id".as[String].head)).parseJson.asJsObject
  }

  /** (kind, stored config a write surface rejects, substring the 422 message must carry). */
  private val storedInvalid: Seq[(String, String, String)] = Seq(
    ("cast", """{"casts":{"doc":"binary-ref"}}""", "binary-ref"),
    ("compute", """{"column":"c","expression":"((","type":"number"}""", "invalid expression"),
    ("aggregate", """{"groupBy":[],"aggregations":[{"alias":"a","fn":"bogus","field":"doc"}]}""", "bogus"),
    ("pivot", """{"index":[],"column":"doc","values":"doc","agg":"bogus"}""", "bogus"),
    ("fillnull", """{"columns":[],"strategy":"bogus","value":null}""", "bogus"),
    ("window", """{"partitionBy":[],"orderBy":[],"function":"bogus","outputColumn":"o"}""", "bogus"),
    ("upsertsource", """{"mode":"upsert","target":{"kind":"existingSource","dataSourceId":"x"}}""", "upsert"),
    ("generatetext", """{"inputField":"","instruction":"","outputField":""}""", "generatetext"),
    ("analyzewithai", """{"inputField":"","instruction":"","outputSchema":[]}""", "analyzewithai")
  )

  "POST /pipeline-steps/:id/duplicate on a STORED config the write path rejects" should {
    storedInvalid.foreach { case (kind, raw, needle) =>
      s"RED: 422 naming the problem and no clone for a stored $kind config" in {
        val owner = newUser(); val pid = emptyPipeline(owner)
        val id = seedStored(pid, kind, raw)
        Post(s"/pipeline-steps/$id/duplicate") ~> routesFor(owner) ~> check {
          withClue(s"$kind: ${responseAs[String]}: ") {
            status shouldBe StatusCodes.UnprocessableEntity
            responseAs[String] should include(needle)
          }
        }
        stepCount(owner, pid) shouldBe 1
      }
    }
  }

  "POST /pipeline-steps/:id/duplicate on a create-accepted incomplete draft" should {
    val drafts: Seq[(String, JsObject)] = Seq(
      "cast"          -> JsObject("casts" -> JsObject()),
      "convertformat" -> JsObject("field" -> JsString("")),
      "pivot"         -> JsObject("index" -> JsArray(), "column" -> JsString(""), "values" -> JsString(""), "agg" -> JsString("")),
      "fillnull"      -> JsObject("columns" -> JsArray(), "strategy" -> JsString(""), "value" -> JsNull),
      "window"        -> JsObject("partitionBy" -> JsArray(), "orderBy" -> JsArray(), "function" -> JsString(""), "outputColumn" -> JsString(""))
    )
    drafts.foreach { case (kind, config) =>
      s"stay duplicable (201): $kind" in {
        val owner = newUser(); val pid = emptyPipeline(owner)
        var id = ""
        Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString(kind), "config" -> config)) ~> routesFor(owner) ~> check {
          withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
          id = responseAs[JsObject].fields("id").convertTo[String]
        }
        Post(s"/pipeline-steps/$id/duplicate") ~> routesFor(owner) ~> check {
          withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
        }
        stepCount(owner, pid) shouldBe 2
      }
    }

    "GUARD: the duplicated convertformat draft stores no empty from/to (writer omits them)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      var id = ""
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("convertformat"), "config" -> JsObject("field" -> JsString("")))) ~>
        routesFor(owner) ~> check { id = responseAs[JsObject].fields("id").convertTo[String] }
      var cloneId = ""
      Post(s"/pipeline-steps/$id/duplicate") ~> routesFor(owner) ~> check {
        status shouldBe StatusCodes.Created
        cloneId = responseAs[JsObject].fields("id").convertTo[String]
      }
      storedConfig(cloneId).fields.keySet should not contain "from"
      storedConfig(cloneId).fields.keySet should not contain "to"
    }
  }

  "POST /pipeline-steps/:id/duplicate on a stored config the round trip normalises or the write path accepts" should {
    "stay 201 for a stored rename with an empty map (nothing rejectable)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val id = seedStored(pid, "rename", """{"renames":{}}""")
      Post(s"/pipeline-steps/$id/duplicate") ~> routesFor(owner) ~> check { status shouldBe StatusCodes.Created }
    }
  }
}
