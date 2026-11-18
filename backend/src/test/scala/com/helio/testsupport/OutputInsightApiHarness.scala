package com.helio.testsupport

import com.helio.api.ApiRoutes
import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.insights._
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.auth.{UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.pipelines.OutputInsightRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.http.scaladsl.model.HttpRequest
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.Future

/** HEL-1742: the insight read specs build their routes through `ApiRoutes` itself (given only a
 *  `dbContext`, as production wiring derives the rest), never a hand-built `OutputRoutes` /
 *  `PublicDashboardRoutes`: both take the read service as an `Option` that defaults to `None`, so a
 *  missed `ApiRoutes` wiring would otherwise make every route reject silently. Session tokens map to
 *  seeded users; `authed(user)` signs a request in as that user. */
trait OutputInsightApiHarness extends OutputHistoryApiHarness {

  protected def apiSystem: ActorSystem[Nothing]

  protected var insightRepo: OutputInsightRepository = _
  protected var api: Route                           = _
  protected var tokens: Map[String, String]          = Map.empty

  private val stubFs: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                     = Future.successful(())
    def exists(path: String): Future[Boolean]                  = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  /** Starts the DB harness and builds `api`; call from `beforeAll` after `super.beforeAll()`. */
  protected def startInsightApi(): Unit = {
    startHarness()
    implicit val system: ActorSystem[Nothing] = apiSystem
    insightRepo = new OutputInsightRepository(ctx)(harnessEc)
    val sessions = new UserSessionRepository {
      override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
        Future.successful(tokens.get(t).map(uid => AuthenticatedUser(UserId(uid))))
    }
    api = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, stubFs, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(harnessEc), sessions, new UserPreferenceRepository(db)(harnessEc), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(harnessEc),
      dbContext = ctx
    ).routes
  }

  protected def signIn(userId: String): String = {
    val t = s"insight-token-$userId"
    tokens = tokens + (t -> userId)
    t
  }

  protected def authed(req: HttpRequest, userId: String): HttpRequest =
    req.addHeader(Cookie(SessionCookies.Name -> signIn(userId))).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))

  /** Inserts one render attempt through the repository's own `insertAction`; every optional column is
   *  populated by default so a leak of any of them is visible. */
  protected def addInsight(
      outputId: String,
      pipelineId: String,
      at: Instant,
      status: InsightStatus = InsightStatus.Ok,
      markdown: Option[String] = Some("Revenue is up [c1]."),
      citations: Vector[StoredInsightCitation] = Vector.empty,
      runId: Option[String] = Some("run-secret-1"),
      model: Option[String] = Some("model-secret-x"),
      trigger: InsightTrigger = InsightTrigger.OnRun
  ): Unit =
    awaitDb(db.run(insightRepo.insertAction(OutputInsightInsert(
      outputId = outputId, pipelineId = pipelineId, runId = runId, trigger = trigger, status = status,
      markdown = if (status == InsightStatus.Ok) markdown else None, citations = citations,
      inputDigest = Some("digest-secret-9"), model = model, inputTokens = Some(918273), outputTokens = Some(645372),
      cacheCreationTokens = Some(736251), cacheReadTokens = Some(827364), costMicros = Some(424242L), createdAt = at
    ))))

  protected def insightCount(outputId: String): Int =
    awaitDb(db.run(sql"SELECT count(*) FROM output_insights WHERE output_id = $outputId".as[Int].head))

  protected def seedInsightOutput(ownerId: String, kind: String = "insight"): (String, String) = seedPipelineWithOutput(ownerId, kind)

  protected def newId(): String = UUID.randomUUID().toString
}
