package com.helio.api.routes.panels

import com.helio.domain.connectors.RestApiConnectorDriver
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, Multipart}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1087 tasks.md 3.2 — route-level coverage for `POST /api/panels/:id/submit`. Seeds two
 *  users (owner + a cross-tenant grantee) directly against a single non-RLS pool, mirroring
 *  `DashboardPanelAclSpec`'s precedent for ACL/business-logic coverage that does not itself need
 *  to re-prove RLS (that is `project_rls_testing_parity_gap`'s own concern, covered elsewhere).
 *  Panels and data sources are seeded directly via SQL (never through the create-panel API) so
 *  the "undeclared field" scenarios (design.md D3(iii)) can be constructed directly, without
 *  needing to simulate schema drift after a config-time consistency check. */
class FormSubmitRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  protected var routes: Route                    = _

  private val ownerId   = UUID.randomUUID().toString
  private val granteeId = UUID.randomUUID().toString
  private val strangerId = UUID.randomUUID().toString
  private val owner    = AuthenticatedUser(UserId(ownerId))
  private val grantee  = AuthenticatedUser(UserId(granteeId))
  private val stranger = AuthenticatedUser(UserId(strangerId))

  private val ownerToken    = "token-owner"
  private val granteeToken  = "token-grantee"
  private val strangerToken = "token-stranger"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `ownerToken`    => Some(owner)
        case `granteeToken`  => Some(grantee)
        case `strangerToken` => Some(stranger)
        case _               => None
      })
  }

  // HEL-1086 tasks.md 3.1/3.2: records every `write` call so a test can assert "no file written"
  // (C3) by before/after count, without a real FileSystem backend.
  private val writtenPaths = scala.collection.mutable.ArrayBuffer.empty[String]

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = {
      writtenPaths.synchronized(writtenPaths += path)
      Future.successful(())
    }
    def read(path: String): Future[Array[Byte]]                                                 = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                       = Future.successful(())
    def exists(path: String): Future[Boolean]                                                    = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  // Declared schema shared by every seeded dataset source: `quantity` (integer, required),
  // `note` (string, declared OPTIONAL — the form's own field tightens it to required, D3(v)),
  // `status` (string, `select`-bound), `extra` (string, optional, with a declared default —
  // never configured by the form at all, D3 "unconfigured declared field takes its default").
  private val declaredSchemaJson =
    """[{"name":"quantity","type":"integer","required":true},
      | {"name":"note","type":"string","required":false},
      | {"name":"status","type":"string","required":false},
      | {"name":"extra","type":"string","required":false,"default":"def-value"}]"""
      .stripMargin.replaceAll("\n", "")

  private def seedDataset(ownerUuid: String, name: String, schemaJson: String = declaredSchemaJson): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($id::uuid, $name, 'dataset', '{}'::jsonb, ${ownerUuid}::uuid, now(), now(), $schemaJson::jsonb)"""
    ))
    id
  }

  private def seedDashboard(ownerUuid: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Test Dashboard', $ownerUuid, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}',
                     ${ownerUuid}::uuid)"""
    ))
    id
  }

  /** Seeds a `form`-kind panel directly, bypassing the create-panel API entirely — the only way
   *  to construct an "undeclared configured field" fixture (design.md D3(iii)) without a second
   *  schema-drift step, since `PanelService.rejectInconsistentForm` would reject that config at
   *  create time. */
  private def seedFormPanel(dashboardId: String, ownerUuid: String, formConfigJson: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id, form_config)
             VALUES ($id, $dashboardId, 'Test Form', $ownerUuid, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'form', ${ownerUuid}::uuid, $formConfigJson::jsonb)"""
    ))
    id
  }

  private def seedTextPanel(dashboardId: String, ownerUuid: String): String = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES ($id, $dashboardId, 'Text Panel', $ownerUuid, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'text', ${ownerUuid}::uuid)"""
    ))
    id
  }

  private def rowCount(dataSourceId: String): Int =
    await(ctx.withSystemContext(
      sql"""SELECT count(*) FROM dataset_rows WHERE data_source_id = $dataSourceId""".as[Int].head
    ))

  private def formConfig(fieldsJson: String): String =
    s"""{"dataSourceId":"__DS__","fields":$fieldsJson,"submit":{"writeMode":"append"}}"""

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(routeEc)

    val dashboardRepo    = new DashboardRepository(ctx)(routeEc)
    val panelRepo        = new PanelRepository(ctx)(routeEc)
    val dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    val userRepo         = new UserRepository(db)(routeEc)
    val userPrefRepo     = new UserPreferenceRepository(db)(routeEc)
    val permissionRepo   = new ResourcePermissionRepository(ctx)(routeEc)
    val pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo,
      stubFileSystem, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      userRepo, stubSessionRepo, userPrefRepo, pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      dbContext = ctx
    ).routes

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'owner@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, 'grantee@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($strangerId::uuid, 'stranger@helio.test', now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  private def sessionCookie(token: String) = Cookie(SessionCookies.Name -> token)
  private def csrfHeader = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  private def json(s: String) = HttpEntity(ContentTypes.`application/json`, s)

  private def submit(panelId: String, body: String, token: String = ownerToken) =
    Post(s"/api/panels/$panelId/submit", json(body)).addHeader(sessionCookie(token)).addHeader(csrfHeader)

  // HEL-1086 tasks.md 3.1/3.2: builds the multipart body `PanelRoutes.submitFormMultipartRoute`
  // expects — one `values` part (the same JSON shape the plain-JSON `submit` helper sends) plus
  // one file part per `(fieldName, filename, bytes)` triple, named by its `sourceField`.
  private def submitMultipart(
      panelId: String,
      valuesJson: String,
      files: Seq[(String, String, Array[Byte])],
      token: String = ownerToken
  ) = {
    val fileParts = files.map { case (fieldName, filename, bytes) =>
      Multipart.FormData.BodyPart.Strict(fieldName, HttpEntity(bytes), Map("filename" -> filename))
    }
    val formData = Multipart.FormData(
      Multipart.FormData.BodyPart.Strict("values", HttpEntity(ContentTypes.`text/plain(UTF-8)`, valuesJson)) +: fileParts: _*
    )
    Post(s"/api/panels/$panelId/submit", formData).addHeader(sessionCookie(token)).addHeader(csrfHeader)
  }

  private val validFieldsJson =
    """[{"sourceField":"quantity","control":"number","required":true},
      | {"sourceField":"note","control":"text","required":true},
      | {"sourceField":"status","control":"select","options":["a","b"]}]""".stripMargin

  "POST /api/panels/:id/submit — success paths" should {
    "append exactly one row to the bound source and leave a second source unchanged" in {
      val srcA = seedDataset(ownerId, "src-a")
      val srcB = seedDataset(ownerId, "src-b")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", srcA))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      rowCount(srcA) shouldBe 1
      rowCount(srcB) shouldBe 0
    }

    "apply the declared default for a field the form never configures" in {
      val src = seedDataset(ownerId, "src-default")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      val row = await(ctx.withSystemContext(
        sql"""SELECT data FROM dataset_rows WHERE data_source_id = $src""".as[String].head
      )).parseJson.convertTo[Vector[JsValue]]
      row(3) shouldBe JsString("def-value")
    }

    "ignore an unsupplied optional field the dataset no longer declares" in {
      val src = seedDataset(ownerId, "src-orphan")
      val dashboardId = seedDashboard(ownerId)
      val fieldsWithOrphan =
        """[{"sourceField":"quantity","control":"number","required":true},
          | {"sourceField":"note","control":"text","required":true},
          | {"sourceField":"status","control":"select","options":["a","b"]},
          | {"sourceField":"ghost","control":"text"}]""".stripMargin
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fieldsWithOrphan).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      rowCount(src) shouldBe 1
    }

    "apply an empty `values`, taking required-or-default outcomes" in {
      // Every field is optional (none declared/form-required) — an empty submit takes every
      // declared default/null.
      val src = seedDataset(ownerId, "src-empty", schemaJson =
        """[{"name":"note","type":"string","required":false}]""")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId,
        formConfig("""[{"sourceField":"note","control":"text"}]""").replace("__DS__", src))

      submit(panelId, """{"values":{}}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      rowCount(src) shouldBe 1
    }
  }

  "POST /api/panels/:id/submit — client-bypass rejections (D3/C8)" should {
    "reject an omitted form-tightened-required field with fieldErrors and no write" in {
      val src = seedDataset(ownerId, "src-req-omit")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val body = responseAs[String].parseJson.asJsObject
        val fieldErrors = body.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("note") && e.fields("reason") == JsString("required")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    "reject a whitespace-only form-tightened-required field with fieldErrors and no write" in {
      val src = seedDataset(ownerId, "src-req-blank")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"   ","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("note") && e.fields("reason") == JsString("required")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    // evaluation-1.md CR2 — the case that distinguishes `FormSubmission.buildRow`'s own per-field
    // `required` check (layer 1) from `DatasetRowValidator`'s required check on the effective
    // declaration (layer 2): a field the DATASET declares `required: true` WITH a declared
    // default, left unsupplied. Layer 2 alone would fill the default and return `201` (the field
    // is not form-required, so it never enters `effectiveDeclaration`'s required-copy); only
    // layer 1's own check — evaluated before any row is built — rejects it.
    "reject a declared-required field with a declared default, left unsupplied — layer 1's own check" in {
      val src = seedDataset(
        ownerId,
        "src-declared-required-default",
        schemaJson = """[{"name":"quantity","type":"integer","required":true},
          | {"name":"note","type":"string","required":false},
          | {"name":"status","type":"string","required":true,"default":"open"}]""".stripMargin.replaceAll("\n", "")
      )
      val dashboardId = seedDashboard(ownerId)
      // `status` IS configured by the form (control "text", no form-level `required` override —
      // the dataset's own `required: true` already applies via `declared.required`) — CR2's
      // point is that layer 1 catches this for a CONFIGURED field even though it never enters
      // `formRequiredNames` (only a FORM-tightened field does).
      val fields = """[{"sourceField":"quantity","control":"number","required":true},
        | {"sourceField":"note","control":"text"},
        | {"sourceField":"status","control":"text"}]""".stripMargin.replaceAll("\n", "")
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fields).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("status") && e.fields("reason") == JsString("required")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    "reject a select value outside its configured options" in {
      val src = seedDataset(ownerId, "src-select")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"c"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(_.fields("field") == JsString("status")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    "reject a string sent for an integer-typed field" in {
      val src = seedDataset(ownerId, "src-type")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":"5","note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("quantity") && e.fields("reason").convertTo[String].startsWith("expected integer")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    "reject an unknown key not part of the form" in {
      val src = seedDataset(ownerId, "src-unknown")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a","bogus":1}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("bogus") && e.fields("reason") == JsString("not part of this form")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }

    "reject a body carrying dataSourceId as a top-level key" in {
      val src = seedDataset(ownerId, "src-redirect")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, s"""{"values":{"quantity":3,"note":"hello","status":"a"},"dataSourceId":"$src"}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      rowCount(src) shouldBe 0
    }

    "report an undeclared configured required field as undeclared, not required" in {
      val src = seedDataset(ownerId, "src-undeclared-required")
      val dashboardId = seedDashboard(ownerId)
      val fieldsWithUndeclaredRequired =
        """[{"sourceField":"quantity","control":"number","required":true},
          | {"sourceField":"note","control":"text"},
          | {"sourceField":"status","control":"select","options":["a","b"]},
          | {"sourceField":"ghost","control":"text","required":true}]""".stripMargin
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fieldsWithUndeclaredRequired).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("ghost") && e.fields("reason") == JsString("not declared by the bound dataset")) shouldBe true
      }
      rowCount(src) shouldBe 0
    }
  }

  "POST /api/panels/:id/submit — visibility and ownership (D4)" should {
    "reject a grantee (non-owner) with 403, source unchanged" in {
      val src = seedDataset(ownerId, "src-grantee")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashboardId, ${granteeId}::uuid, 'editor', now())"""
      ))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""", granteeToken) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      rowCount(src) shouldBe 0
    }

    "reject an owner whose bound source has since been deleted with 404, nothing written" in {
      val src = seedDataset(ownerId, "src-deleted")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))
      await(ctx.withSystemContext(sqlu"""DELETE FROM data_sources WHERE id = $src"""))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "reject a stranger's request against another user's panel with 404" in {
      val src = seedDataset(ownerId, "src-stranger")
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(validFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello","status":"a"}}""", strangerToken) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
      rowCount(src) shouldBe 0
    }

    "reject a non-form panel with 400" in {
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedTextPanel(dashboardId, ownerId)

      submit(panelId, """{"values":{}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  // HEL-1086 tasks.md 3.1/3.2: file-field coverage — a declared `photo` (`binary-ref`) field
  // alongside the shared `quantity`/`note`/`status` schema above.
  private val fileSchemaJson =
    """[{"name":"quantity","type":"integer","required":true},
      | {"name":"note","type":"string","required":false},
      | {"name":"photo","type":"binary-ref","required":false}]"""
      .stripMargin.replaceAll("\n", "")

  private val fileFieldsJson =
    """[{"sourceField":"quantity","control":"number","required":true},
      | {"sourceField":"note","control":"text"},
      | {"sourceField":"photo","control":"file"}]""".stripMargin

  private val requiredFileFieldsJson =
    """[{"sourceField":"quantity","control":"number","required":true},
      | {"sourceField":"note","control":"text"},
      | {"sourceField":"photo","control":"file","required":true}]""".stripMargin

  "POST /api/panels/:id/submit — file fields (HEL-1086)" should {
    "store an attached file on local backend and write a resolvable binary-ref cell" in {
      val before = writtenPaths.size
      val src = seedDataset(ownerId, "src-file-ok", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fileFieldsJson).replace("__DS__", src))

      submitMultipart(
        panelId,
        """{"quantity":3,"note":"hello"}""",
        Seq(("photo", "report.pdf", "file bytes".getBytes("UTF-8")))
      ) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      rowCount(src) shouldBe 1
      writtenPaths.size shouldBe (before + 1)
      writtenPaths.last should startWith("form-uploads/")
      writtenPaths.last should endWith(".pdf")

      val row = await(ctx.withSystemContext(
        sql"""SELECT data FROM dataset_rows WHERE data_source_id = $src""".as[String].head
      )).parseJson.convertTo[Vector[JsValue]]
      val photoCell = row(2).asJsObject
      photoCell.fields("storageKey") shouldBe JsString(writtenPaths.last)
      photoCell.fields("filename") shouldBe JsString("report.pdf")
    }

    "never let the submitted filename become the storage key (path-traversal safe)" in {
      val src = seedDataset(ownerId, "src-file-traversal", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fileFieldsJson).replace("__DS__", src))

      submitMultipart(
        panelId,
        """{"quantity":3,"note":"hello"}""",
        Seq(("photo", "../../etc/passwd.txt", "x".getBytes("UTF-8")))
      ) ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      val row = await(ctx.withSystemContext(
        sql"""SELECT data FROM dataset_rows WHERE data_source_id = $src""".as[String].head
      )).parseJson.convertTo[Vector[JsValue]]
      val storageKey = row(2).asJsObject.fields("storageKey").convertTo[String]
      storageKey should startWith("form-uploads/")
      storageKey should not include ".."
      storageKey should not include "/etc/"
    }

    "reject a required file field with no attached file, writing nothing" in {
      val before = writtenPaths.size
      val src = seedDataset(ownerId, "src-file-required", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(requiredFileFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("photo") && e.fields("reason") == JsString("required")) shouldBe true
      }
      rowCount(src) shouldBe 0
      writtenPaths.size shouldBe before
    }

    "reject a disallowed file extension, writing nothing" in {
      val before = writtenPaths.size
      val src = seedDataset(ownerId, "src-file-badext", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fileFieldsJson).replace("__DS__", src))

      submitMultipart(
        panelId,
        """{"quantity":3,"note":"hello"}""",
        Seq(("photo", "payload.exe", "x".getBytes("UTF-8")))
      ) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("photo") && e.fields("reason") == JsString("invalid")) shouldBe true
      }
      rowCount(src) shouldBe 0
      writtenPaths.size shouldBe before
    }

    "reject an oversized file, writing nothing" in {
      val before = writtenPaths.size
      val src = seedDataset(ownerId, "src-file-toobig", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fileFieldsJson).replace("__DS__", src))
      val oversized = new Array[Byte](10485760 + 1)

      submitMultipart(
        panelId,
        """{"quantity":3,"note":"hello"}""",
        Seq(("photo", "report.pdf", oversized))
      ) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("photo") && e.fields("reason") == JsString("invalid")) shouldBe true
      }
      rowCount(src) shouldBe 0
      writtenPaths.size shouldBe before
    }

    // C3/design.md "A rejected submit stores no file": the file itself is valid, but a SIBLING
    // field (the form-tightened-required `note`, missing here) fails — no file write must happen.
    "never write a valid attached file when a sibling field fails (C3)" in {
      val before = writtenPaths.size
      val src = seedDataset(ownerId, "src-file-sibling-fails", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val requiredNoteFields =
        """[{"sourceField":"quantity","control":"number","required":true},
          | {"sourceField":"note","control":"text","required":true},
          | {"sourceField":"photo","control":"file"}]""".stripMargin
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(requiredNoteFields).replace("__DS__", src))

      submitMultipart(
        panelId,
        """{"quantity":3}""",
        Seq(("photo", "report.pdf", "file bytes".getBytes("UTF-8")))
      ) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        val fieldErrors = responseAs[String].parseJson.asJsObject.fields("fieldErrors").convertTo[Vector[JsValue]].map(_.asJsObject)
        fieldErrors.exists(e => e.fields("field") == JsString("note") && e.fields("reason") == JsString("required")) shouldBe true
      }
      rowCount(src) shouldBe 0
      writtenPaths.size shouldBe before
    }

    "leave an optional file field unsupplied without error" in {
      val src = seedDataset(ownerId, "src-file-optional-empty", schemaJson = fileSchemaJson)
      val dashboardId = seedDashboard(ownerId)
      val panelId = seedFormPanel(dashboardId, ownerId, formConfig(fileFieldsJson).replace("__DS__", src))

      submit(panelId, """{"values":{"quantity":3,"note":"hello"}}""") ~> routes ~> check {
        status shouldBe StatusCodes.Created
      }
      rowCount(src) shouldBe 1
    }
  }
}
