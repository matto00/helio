package com.helio.api.routes.panels

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, Multipart}
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.collection.mutable.ArrayBuffer
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** The embedded-Postgres `ApiRoutes` harness the form-panel route specs share: an owner, an editor, a viewer and a
 *  stranger, each with a session token, on one non-RLS pool (RLS itself is proven by `FormSubmitEditorRlsSpec`).
 *  Datasets, dashboards, panels and grants are seeded by SQL so a spec can build shapes the create API refuses. */
trait FormPanelRouteFixture extends BeforeAndAfterAll { self: AnyWordSpec with Matchers with HelioRouteTest with JsonProtocols =>

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  protected var ctx: DbContext                   = _
  protected var routes: Route                    = _

  protected val ownerId    = UUID.randomUUID().toString
  protected val editorId   = UUID.randomUUID().toString
  protected val viewerId   = UUID.randomUUID().toString
  protected val strangerId = UUID.randomUUID().toString

  protected val ownerToken    = "token-owner"
  protected val editorToken   = "token-editor"
  protected val viewerToken   = "token-viewer"
  protected val strangerToken = "token-stranger"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `ownerToken`    => Some(AuthenticatedUser(UserId(ownerId)))
        case `editorToken`   => Some(AuthenticatedUser(UserId(editorId)))
        case `viewerToken`   => Some(AuthenticatedUser(UserId(viewerId)))
        case `strangerToken` => Some(AuthenticatedUser(UserId(strangerId)))
        case _               => None
      })
  }

  protected val writtenPaths = ArrayBuffer.empty[String]

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = { writtenPaths.synchronized(writtenPaths += path); Future.successful(()) }
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                      = Future.successful(())
    def exists(path: String): Future[Boolean]                   = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  /** `quantity` (integer, required), `note` (string), `status` (string), `extra` (string, never configured by the forms). */
  protected val declaredSchemaJson: String =
    """[{"name":"quantity","type":"integer","required":true},
      | {"name":"note","type":"string","required":false},
      | {"name":"status","type":"string","required":false},
      | {"name":"extra","type":"string","required":false,"default":"def-value"}]""".stripMargin.replaceAll("\n", "")

  protected val counterSchemaJson: String =
    """[{"name":"delta","type":"integer","required":true},
      | {"name":"occurred_at","type":"timestamp","required":true},
      | {"name":"value","type":"integer","required":false}]""".stripMargin.replaceAll("\n", "")

  protected val validFieldsJson: String =
    """[{"sourceField":"quantity","control":"number","required":true},
      | {"sourceField":"note","control":"text","required":true}]""".stripMargin

  protected val validValuesJson: String = """{"values":{"quantity":3,"note":"hello"}}"""

  protected def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(routeEc)

    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    routes = new ApiRoutes(
      new DashboardRepository(ctx)(routeEc), new PanelRepository(ctx)(routeEc), dataSourceRepo, new ResourcePermissionRepository(ctx)(routeEc),
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(routeEc), stubSessionRepo, new UserPreferenceRepository(db)(routeEc),
      new PipelineRepository(ctx, dataSourceRepo)(routeEc), new PipelineStepRepository(ctx)(routeEc),
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, new PipelineRepository(ctx, dataSourceRepo)(routeEc))(routeEc),
      auditEventRepo = new AuditEventRepository(ctx)(routeEc),
      dbContext = ctx
    ).routes

    await(ctx.withSystemContext(DBIO.seq(
      Seq(ownerId -> "owner", editorId -> "editor", viewerId -> "viewer", strangerId -> "stranger").map { case (id, name) =>
        sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$name@helio.test"}, now())"""
      }: _*
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  protected def seedDataset(ownerUuid: String, name: String, schemaJson: String = declaredSchemaJson): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($id::uuid, $name, 'dataset', '{}'::jsonb, ${ownerUuid}::uuid, now(), now(), $schemaJson::jsonb)"""
    ))
    id
  }

  protected def seedDashboard(ownerUuid: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Test Dashboard', $ownerUuid, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerUuid}::uuid)"""
    ))
    id
  }

  protected def grant(dashboardId: String, granteeUuid: String, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, ${granteeUuid}::uuid, $role, now())"""
    )).discard

  protected def changeRole(dashboardId: String, granteeUuid: String, role: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""UPDATE resource_permissions SET role = $role WHERE resource_id = $dashboardId AND grantee_id = ${granteeUuid}::uuid"""
    )).discard

  /** A viewer grant with no grantee, which is how a dashboard is made public. */
  protected def makePublic(dashboardId: String): Unit =
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
             VALUES ('dashboard', $dashboardId, NULL, 'viewer', now())"""
    )).discard

  protected def formConfig(dataSourceId: String, fieldsJson: String): String =
    s"""{"dataSourceId":"$dataSourceId","fields":$fieldsJson,"submit":{"writeMode":"append"}}"""

  /** Seeds a `form` panel owned by `ownerUuid`, which need not own the dashboard (an editor-created form). */
  protected def seedFormPanel(dashboardId: String, ownerUuid: String, formConfigJson: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
             VALUES ($id, $dashboardId, 'Test Form', $ownerUuid, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'form', ${ownerUuid}::uuid, $formConfigJson::jsonb)"""
    ))
    id
  }

  protected def seedTextPanel(dashboardId: String, ownerUuid: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES ($id, $dashboardId, 'Text Panel', $ownerUuid, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'text', ${ownerUuid}::uuid)"""
    ))
    id
  }

  protected def rowCount(dataSourceId: String): Int =
    await(ctx.withSystemContext(sql"""SELECT count(*) FROM dataset_rows WHERE data_source_id = $dataSourceId""".as[Int].head))

  protected def replaceSchema(dataSourceId: String, schemaJson: String): Unit =
    await(ctx.withSystemContext(sqlu"""UPDATE data_sources SET dataset_schema = $schemaJson::jsonb WHERE id = $dataSourceId""")).discard

  private def sessionCookie(token: String) = Cookie(SessionCookies.Name -> token)
  private def csrfHeader                    = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)

  protected def submit(panelId: String, body: String, token: String = ownerToken) =
    Post(s"/api/panels/$panelId/submit", HttpEntity(ContentTypes.`application/json`, body)).addHeader(sessionCookie(token)).addHeader(csrfHeader)

  protected def submitMultipart(panelId: String, valuesJson: String, files: Seq[(String, String, Array[Byte])], token: String = ownerToken) = {
    val fileParts = files.map { case (fieldName, filename, bytes) =>
      Multipart.FormData.BodyPart.Strict(fieldName, HttpEntity(bytes), Map("filename" -> filename))
    }
    val formData = Multipart.FormData(
      Multipart.FormData.BodyPart.Strict("values", HttpEntity(ContentTypes.`text/plain(UTF-8)`, valuesJson)) +: fileParts: _*
    )
    Post(s"/api/panels/$panelId/submit", formData).addHeader(sessionCookie(token)).addHeader(csrfHeader)
  }

  protected def getFormSchema(panelId: String, token: String) =
    Get(s"/api/panels/$panelId/form-schema").addHeader(sessionCookie(token))

  private implicit class Discard[T](private val value: T) { def discard: Unit = () }
}
