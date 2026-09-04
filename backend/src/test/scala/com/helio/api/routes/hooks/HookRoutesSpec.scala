package com.helio.api.routes.hooks

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, Cookie, OAuth2BearerToken, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.api.{ApiRoutes, JsonProtocols, PipelineRunRecord}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRunId, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.auth.{ApiTokenRepository, ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, Future}
import scala.concurrent.duration.DurationInt

/** End-to-end coverage for `POST /api/hooks/run` (HEL-369): the external
 *  trigger endpoint. Wires the full [[ApiRoutes]] (not just the run-route
 *  classes `PipelineRunRoutesSpec` composes directly) so PAT resolution and
 *  `AuthDirectives.confineScopedToken`'s pipeline-allow-list enforcement are
 *  exercised end to end, mirroring `ApiTokenAuthSpec`'s fixture shape but
 *  with `pipelineRunRepo` also wired so the hook route mounts. Uses a single
 *  (superuser) db for both pools -- like `PipelineRunRoutesSpec` -- since
 *  this spec is not pinning down RLS behavior (that's `ApiTokenAuthSpec`'s
 *  job); it exercises the hook's own business logic (scope check, duplicate
 *  collapse, pipeline ACL, audit fields). */
class HookRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var ctx: DbContext                         = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var routes: Route                          = _

  private val userIdA  = "00000000-0000-0000-0000-0000000010aa"
  private val userIdB  = "00000000-0000-0000-0000-0000000010bb"
  private val sessionA = "hook-session-a"
  private val sessionB = "hook-session-b"

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case `sessionA` => Some(AuthenticatedUser(UserId(userIdA)))
        case `sessionB` => Some(AuthenticatedUser(UserId(userIdB)))
        case _          => None
      })
  }

  private val stubFileSystem: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit]                                       = Future.successful(())
    def read(path: String): Future[Array[Byte]]                                                      = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                                                           = Future.successful(())
    def exists(path: String): Future[Boolean]                                                        = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(typedSystem.executionContext)

    val routeEc             = typedSystem.executionContext
    val dashboardRepo       = new DashboardRepository(ctx)(routeEc)
    val panelRepo           = new PanelRepository(ctx)(routeEc)
    val dataSourceRepo      = new DataSourceRepository(ctx)(routeEc)
    val userRepo            = new UserRepository(db)(routeEc)
    val userPreferenceRepo  = new UserPreferenceRepository(db)(routeEc)
    val permissionRepo      = new ResourcePermissionRepository(ctx)(routeEc)
    val pipelineRepo        = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val pipelineStepRepo    = new PipelineStepRepository(ctx)(routeEc)
    pipelineRunRepo         = new PipelineRunRepository(ctx)(routeEc)
    val apiTokenRepo        = new ApiTokenRepository(ctx)(routeEc)

    routes = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo,
      stubFileSystem,
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP in tests")))),
      userRepo, stubSessionRepo, userPreferenceRepo,
      pipelineRepo, pipelineStepRepo,
      new PipelineRunCache(),
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(typedSystem.executionContext),
      pipelineRunRepo = pipelineRunRepo,
      apiTokenRepo = apiTokenRepo
    ).routes

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userIdA::uuid, 'hooka@helio.test', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userIdB::uuid, 'hookb@helio.test', now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(
      sqlu"TRUNCATE TABLE api_tokens, pipeline_runs, pipelines, data_sources CASCADE"
    ))

  private def bearer(token: String)        = Authorization(OAuth2BearerToken(token))
  private def sessionCookie(token: String) = Cookie(SessionCookies.Name -> token)
  private def csrfHeader                   = RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue)
  private def jsonEntity(body: String)     = HttpEntity(ContentTypes.`application/json`, body)

  /** Create a PAT through the real route (session-cookie authenticated) and
   *  return (id, rawToken) -- mirrors `ApiTokenAuthSpec.createPat`. */
  private def createPat(session: String, name: String, body: Option[String] = None): (String, String) = {
    val payload = body.getOrElse(s"""{"name":"$name"}""")
    Post("/api/tokens", jsonEntity(payload)).addHeader(sessionCookie(session)).addHeader(csrfHeader) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      val fields = responseAs[String].parseJson.asJsObject.fields
      (fields("id").convertTo[String], fields("token").convertTo[String])
    }
  }

  /** Seed a pipeline (+ its required data_source/data_type FK rows) owned by
   *  `ownerUserId`. Mirrors `PipelineRunRoutesSpec.seedPipelineWithDtId`. */
  private def seedPipelineOwnedBy(ownerUserId: String): String = {
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerUserId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerUserId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    pid
  }

  /** Seed a pipeline (as above) with a two-row static source and one `assert`
   *  step whose `rowCountMax` rule (`count: 1`, severity `error`) fails
   *  deterministically (2 rows > 1) -- HEL-570's fail-policy fixture. Written
   *  directly to `pipeline_steps` (config text mirrors what
   *  `AssertStep.companion.encodeConfig` would produce) since this route spec
   *  has no `PipelineStepRepository` handle wired up for a user-context insert. */
  private def seedPipelineWithBlockingAssert(ownerUserId: String): String = {
    val dsId     = UUID.randomUUID().toString
    val dtId     = UUID.randomUUID().toString
    val pid      = UUID.randomUUID().toString
    val stepId   = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"}],"rows":[["a"],["b"]]}"""
    val stepConfig = """{"rules":[{"kind":"rowCountMax","severity":"error","params":{"count":1}}]}"""
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'static', $dsConfig, $ownerUserId::uuid, now(), now())""",
      
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', $ownerUserId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
             VALUES ($stepId, $pid, 0, 'assert', $stepConfig, now(), now(), $pid)"""
    )))
    pid
  }

  "POST /api/hooks/run" should {

    "trigger a pipeline with an unscoped PAT, return a runId, and record it as external in run-history (8.3/8.4)" in {
      cleanDb()
      val pid       = seedPipelineOwnedBy(userIdA)
      val (_, raw)  = createPat(sessionA, "unscoped-hook")

      val runId = Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val fields = responseAs[String].parseJson.asJsObject.fields
        fields("pipelineId").convertTo[String] shouldBe pid
        fields("status").convertTo[String] shouldBe "succeeded"
        fields("runId").convertTo[String]
      }

      Get(s"/api/pipelines/$pid/run-history").addHeader(sessionCookie(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records should have size 1
        records.head.id shouldBe runId
        records.head.triggerSource shouldBe "external"
        // Note (design.md Decision 2/4): `confineScopedToken` only extracts a
        // `TokenScope` for a *scoped* token -- an unscoped PAT's identity is
        // resolved later by the ordinary `authenticate` directive, which
        // never surfaces *which* token it was. `triggeredByTokenId` is
        // therefore only ever populated when a *scoped* token authenticated
        // the trigger (see the scoped-PAT test below) -- an accepted,
        // literal consequence of design.md Decision 5's
        // `tokenScope.map(_.tokenId.value)`, not a bug.
        records.head.triggeredByTokenId shouldBe None
      }
    }

    "trigger an in-scope pipeline successfully with a scoped PAT, recording the triggering token's id in run-history" in {
      cleanDb()
      val pid            = seedPipelineOwnedBy(userIdA)
      val (tokenId, raw) = createPat(sessionA, "scoped-hook", Some(s"""{"name":"scoped-hook","scopedPipelineIds":["$pid"]}"""))

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/api/pipelines/$pid/run-history").addHeader(sessionCookie(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records should have size 1
        records.head.triggerSource shouldBe "external"
        records.head.triggeredByTokenId shouldBe Some(tokenId)
      }
    }

    "reject a scoped PAT triggering a pipeline outside its allow-list with 403" in {
      cleanDb()
      val pid      = seedPipelineOwnedBy(userIdA)
      val otherPid = seedPipelineOwnedBy(userIdA)
      val (_, raw) = createPat(sessionA, "scoped-hook", Some(s"""{"name":"scoped-hook","scopedPipelineIds":["$otherPid"]}"""))

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "return 401 for a missing, invalid, or revoked token" in {
      cleanDb()
      val pid = seedPipelineOwnedBy(userIdA)

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer("helio_pat_" + "0" * 64)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }

      val (tokenId, raw) = createPat(sessionA, "to-revoke")
      Delete(s"/api/tokens/$tokenId").addHeader(sessionCookie(sessionA)).addHeader(csrfHeader) ~> routes ~> check {
        status shouldBe StatusCodes.NoContent
      }
      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.Unauthorized
      }
    }

    "return 404 for a pipeline the authenticated user cannot access" in {
      cleanDb()
      val pidOwnedByB = seedPipelineOwnedBy(userIdB)
      val (_, raw)    = createPat(sessionA, "unrelated")

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pidOwnedByB"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "collapse a duplicate trigger into the already in-flight run instead of starting a second one" in {
      cleanDb()
      val pid      = seedPipelineOwnedBy(userIdA)
      val (_, raw) = createPat(sessionA, "dup-hook")

      val inFlightRunId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRunInternal(inFlightRunId, PipelineId(pid), Instant.now(), triggerSource = "external"))

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val fields = responseAs[String].parseJson.asJsObject.fields
        fields("runId").convertTo[String] shouldBe inFlightRunId.value
      }

      val runCount = await(ctx.withSystemContext(
        sql"SELECT COUNT(*) FROM pipeline_runs WHERE pipeline_id = $pid".as[Int].head
      ))
      runCount shouldBe 1
    }

    "report status failed (not succeeded) for a run blocked by an error-severity assertion (HEL-570)" in {
      cleanDb()
      val pid      = seedPipelineWithBlockingAssert(userIdA)
      val (_, raw) = createPat(sessionA, "assert-hook")

      Post("/api/hooks/run", jsonEntity(s"""{"pipelineId":"$pid"}""")).addHeader(bearer(raw)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val fields = responseAs[String].parseJson.asJsObject.fields
        fields("pipelineId").convertTo[String] shouldBe pid
        fields("status").convertTo[String] shouldBe "failed"
      }

      Get(s"/api/pipelines/$pid/run-history").addHeader(sessionCookie(sessionA)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records should have size 1
        records.head.status shouldBe "failed"
        records.head.errorLog shouldBe defined
        records.head.errorLog.get should include("rowCountMax")
        records.head.errorLog.get should not include "Pipeline execution failed"
      }

      val lastRunStatus = await(ctx.withSystemContext(
        sql"SELECT last_run_status FROM pipelines WHERE id = $pid".as[Option[String]].head
      ))
      lastRunStatus shouldBe Some("failed")
    }
  }
}
