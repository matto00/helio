package com.helio.domain.connectors

import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.sources.ContentSourceSupport
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.pattern.{after => delayed}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.net.InetAddress
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.{Success, Try}

/** HEL-1013: the REAL driver paging against a local stub server that logs every request it serves. The connector is a
 *  value (no database); the egress guard is the production one with `resolveHost`/`isBlocked` injected. */
class RestApiConnectorDriverPaginationSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val log                         = new ConcurrentLinkedQueue[String]()
  private var binding: Http.ServerBinding = _
  private var port: Int                   = _

  private val Stub2xxLimit = 8388609

  private def requests: Vector[String] = log.asScala.toVector
  private def cleanLog(): Unit         = log.clear()

  private def ids(from: Int, n: Int): String = (from until from + n).map(i => s"""{"id":$i}""").mkString("[", ",", "]")
  private def linkTo(path: String, host: String = "localhost"): HttpHeader =
    RawHeader("Link", s"""<http://$host:$port$path>; rel="next"""")
  private def ok(body: String, headers: List[HttpHeader] = Nil): Future[HttpResponse] =
    Future.successful(HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, body), headers = headers))
  private def status(code: Int, body: String): Future[HttpResponse] =
    Future.successful(HttpResponse(StatusCodes.custom(code, "x"), entity = HttpEntity(ContentTypes.`text/plain(UTF-8)`, body)))
  private def q(req: HttpRequest, name: String): Option[String] = req.uri.query().get(name)
  private def pageNo(req: HttpRequest): Int                     = q(req, "p").fold(1)(_.toInt)

  private def handle(req: HttpRequest): Future[HttpResponse] = {
    log.add(req.uri.toRelative.toString)
    val n = pageNo(req)
    req.uri.path.toString match {
      case "/link"       => ok(ids((n - 1) * 2 + 1, 2), if (n < 3) List(linkTo(s"/link?p=${n + 1}")) else Nil)
      case "/linkmany"  => ok(ids((n - 1) * 2 + 1, 2), if (n < 10) List(linkTo(s"/linkmany?p=${n + 1}")) else Nil)
      case "/linkendless" => ok(ids(n, 1), List(linkTo(s"/linkendless?p=${n + 1}")))
      case "/nexturl" =>
        val next = if (n < 3) s""""http://localhost:$port/nexturl?p=${n + 1}"""" else "null"
        ok(s"""{"items":${ids((n - 1) * 2 + 1, 2)},"next":$next}""")
      case "/cursor" =>
        val cur  = q(req, "after").fold(1)(_.drop(1).toInt)
        val next = if (cur < 3) s""""c${cur + 1}"""" else "null"
        ok(s"""{"items":${ids((cur - 1) * 2 + 1, 2)},"meta":{"next":$next}}""")
      case "/cursorloop" => ok(s"""{"items":${ids(n, 1)},"meta":{"next":"same"}}""")
      case "/page" =>
        val p = q(req, "page").fold(0)(_.toInt)
        ok(if (p >= 1 && p <= 2) ids((p - 1) * 3 + 1, 3) else "[]")
      case "/offset" =>
        val o = q(req, "offset").fold(-1)(_.toInt)
        ok(if (o >= 0 && o < 6) ids(o + 1, 3) else "[]")
      case "/fail500" => if (n == 2) status(500, "boom") else ok(ids(n, 1), List(linkTo(s"/fail500?p=${n + 1}")))
      case "/fail429" => if (n == 3) status(429, "slow down") else ok(ids(n, 1), List(linkTo(s"/fail429?p=${n + 1}")))
      case "/blocked" => ok(ids(1, 1), List(linkTo("/blocked?p=2", "blocked.test")))
      case "/other"   => ok(ids(1, 1), List(linkTo("/other?p=2", "other.test")))
      case "/noconfig" =>
        ok(s"""{"items":${ids(1, 2)},"next":"http://localhost:$port/noconfig?p=2"}""", List(linkTo("/noconfig?p=2")))
      case "/slow2" =>
        if (n == 2) delayed(1500.millis)(ok(ids(3, 2), List(linkTo("/slow2?p=3"))))(typedSystem.classicSystem)
        else ok(ids(1, 2), List(linkTo("/slow2?p=2")))
      case "/slowlast" =>
        if (n == 2) delayed(1500.millis)(ok(ids(3, 2)))(typedSystem.classicSystem)
        else ok(ids(1, 2), List(linkTo("/slowlast?p=2")))
      case "/oversize" =>
        if (n == 2) Future.successful(HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, Array.fill[Byte](Stub2xxLimit)('x'.toByte))))
        else ok(ids(1, 1), List(linkTo("/oversize?p=2")))
      case _ => status(404, "no such stub")
    }
  }

  private val resolveHost: String => Try[Array[InetAddress]] = {
    case "blocked.test" | "other.test" => Success(Array(InetAddress.getByName("127.0.0.1")))
    case other                         => ContentSourceSupport.defaultResolveHost(other)
  }
  private val isBlocked: (String, InetAddress) => Boolean = (host, addr) =>
    host match {
      case "localhost" | "other.test" => false
      case "blocked.test"             => true
      case _                          => ContentSourceSupport.isBlockedAddress(addr)
    }

  private def connector: Connector = Connector(
    ConnectorId("c1"), UserId("u1"), "stub", DataSourceKind.RestApi, s"http://localhost:$port", "{}",
    Some(ConnectorCredentialId("cred")), Instant.EPOCH, Instant.EPOCH
  )
  private lazy val repo: ConnectorRepository = new ConnectorRepository(null, null) {
    override def findByIdInternal(id: ConnectorId): Future[Option[Connector]] = Future.successful(Some(connector))
  }
  private lazy val driver = new RestApiConnectorDriver(connectorRepoOpt = Some(repo), resolveHost = resolveHost, isBlocked = isBlocked)
  private def driverWithBudget(budget: FiniteDuration) =
    new RestApiConnectorDriver(connectorRepoOpt = Some(repo), resolveHost = resolveHost, isBlocked = isBlocked, pagingTotalTimeout = budget)

  private def config(endpoint: String, pagination: Option[RestPagination], query: Vector[(String, String)] = Vector.empty, root: Option[String] = None) =
    RestApiConfig(connectorId = "c1", endpoint = endpoint, queryParams = QueryParams(query), rootSelector = root, pagination = pagination)

  private def run(c: RestApiConfig, cap: Int = 1000, d: RestApiConnectorDriver = driver): Either[String, FetchOutcome] =
    Await.result(d.fetch(c, cap, ConnectorResolveContext.Internal), 30.seconds)

  private def idsOf(o: FetchOutcome): Vector[Int] = o.rows.map(_.asJsObject.fields("id").convertTo[Int])

  override def beforeAll(): Unit = {
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(handle _), 10.seconds)
    port = binding.localAddress.getPort
  }
  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    super.afterAll()
  }

  private val AllSix = Vector(1, 2, 3, 4, 5, 6)

  "A paged REST fetch" should {
    "follow Link rel=next across three pages" in {
      cleanLog()
      val out = run(config("/link", Some(RestPagination.Link()), Vector("p" -> "1"))).toOption.get
      idsOf(out) shouldBe AllSix
      out.truncated shouldBe false
      requests shouldBe Vector("/link?p=1", "/link?p=2", "/link?p=3")
    }
    "follow a next_url read from the body across three pages" in {
      cleanLog()
      val out = run(config("/nexturl", Some(RestPagination.NextUrl("next")), Vector("p" -> "1"), Some("items"))).toOption.get
      idsOf(out) shouldBe AllSix
      requests should have size 3
      requests(1) shouldBe "/nexturl?p=2"
    }
    "send a body cursor back in cursorParam across three pages" in {
      cleanLog()
      val out = run(config("/cursor", Some(RestPagination.Cursor("meta.next", "after")), root = Some("items"))).toOption.get
      idsOf(out) shouldBe AllSix
      requests shouldBe Vector("/cursor", "/cursor?after=c2", "/cursor?after=c3")
    }
    "page by page number, starting at startPage with the page size sent on request one" in {
      cleanLog()
      val p   = RestPagination.Page(pageSizeParam = Some("per"), pageSize = Some(3))
      val out = run(config("/page", Some(p))).toOption.get
      idsOf(out) shouldBe AllSix
      requests shouldBe Vector("/page?page=1&per=3", "/page?page=2&per=3", "/page?page=3&per=3")
    }
    "page by offset, starting at 0 and advancing by the limit" in {
      cleanLog()
      val out = run(config("/offset", Some(RestPagination.Offset(limit = 3)))).toOption.get
      idsOf(out) shouldBe AllSix
      requests shouldBe Vector("/offset?offset=0&limit=3", "/offset?offset=3&limit=3", "/offset?offset=6&limit=3")
    }

    "stop at the cap, report paged truncation and request nothing after the cap is exceeded" in {
      cleanLog()
      val out = run(config("/linkmany", Some(RestPagination.Link()), Vector("p" -> "1")), cap = 5).toOption.get
      out.truncated shouldBe true
      out.rows should have size 5
      out.pagesFetched shouldBe Some(3)
      out.availableRowCount shouldBe None
      requests should have size 3
    }
    "not report exactly cap rows as truncated" in {
      cleanLog()
      val out = run(config("/link", Some(RestPagination.Link()), Vector("p" -> "1")), cap = 6).toOption.get
      out.truncated shouldBe false
      out.pagesFetched shouldBe None
      out.rows should have size 6
    }

    "fail loudly, naming the bound and returning no rows, when maxRequests is reached with more pages promised" in {
      cleanLog()
      val result = run(config("/linkendless", Some(RestPagination.Link(maxRequests = Some(3))), Vector("p" -> "1")))
      result.isLeft shouldBe true
      result.left.toOption.get should include("maxRequests (3 requests)")
      requests should have size 3
    }

    "refuse a followed URL on a blocked host with the guard's own refusal, sending no request to it" in {
      cleanLog()
      val result = run(config("/blocked", Some(RestPagination.Link())))
      result shouldBe Left("Page 2: URL host 'blocked.test' resolves to a disallowed address")
      requests shouldBe Vector("/blocked")
    }
    "refuse a followed URL on another allowed origin without sending a request" in {
      cleanLog()
      val result = run(config("/other", Some(RestPagination.Link())))
      result.isLeft shouldBe true
      result.left.toOption.get should startWith("Page 2:")
      result.left.toOption.get.toLowerCase should include("origin")
      requests shouldBe Vector("/other")
    }

    "fail the whole fetch naming page 2 on a 500, returning no rows" in {
      cleanLog()
      val result = run(config("/fail500", Some(RestPagination.Link()), Vector("p" -> "1")))
      result shouldBe Left("Page 2: HTTP 500: boom")
    }
    "fail the whole fetch naming page 3 on a 429 and never retry" in {
      cleanLog()
      val result = run(config("/fail429", Some(RestPagination.Link()), Vector("p" -> "1")))
      result shouldBe Left("Page 3: HTTP 429: slow down")
      requests should have size 3
    }
    "fail naming page 2 when its body exceeds the per-response limit" in {
      cleanLog()
      val result = run(config("/oversize", Some(RestPagination.Link()), Vector("p" -> "1")))
      result shouldBe Left("Page 2: Request failed")
    }
    "refuse a repeated cursor instead of spending the request budget" in {
      cleanLog()
      val result = run(config("/cursorloop", Some(RestPagination.Cursor("meta.next", "after")), root = Some("items")))
      result.isLeft shouldBe true
      result.left.toOption.get should include("repeats")
      requests should have size 2
    }

    "fail with the time budget error, no rows and no page 3 request, when a page outlasts the deadline" in {
      cleanLog()
      val result = run(config("/slow2", Some(RestPagination.Link()), Vector("p" -> "1")), d = driverWithBudget(500.millis))
      result.isLeft shouldBe true
      result.left.toOption.get should include("time budget")
      Thread.sleep(2000)
      requests should not contain "/slow2?p=3"
    }
    "fail with the time budget error, not success, when the last page completes after the deadline" in {
      cleanLog()
      val result = run(config("/slowlast", Some(RestPagination.Link()), Vector("p" -> "1")), d = driverWithBudget(500.millis))
      result.isLeft shouldBe true
      result.left.toOption.get should include("time budget")
    }
  }

  "Schema inference, preview and test over a paged source" should {
    "read exactly one page and withhold observedRowCount for a configured source" in {
      cleanLog()
      val schema = Await.result(driver.inferSchema(config("/link", Some(RestPagination.Link()), Vector("p" -> "1")), ConnectorResolveContext.Internal), 15.seconds).toOption.get
      requests shouldBe Vector("/link?p=1")
      schema.observedRowCount shouldBe None
      schema.looksPaged shouldBe false
    }
    "flag an unconfigured response that carries a Link next header, after one request" in {
      cleanLog()
      val schema = Await.result(driver.inferSchema(config("/link", None, Vector("p" -> "1")), ConnectorResolveContext.Internal), 15.seconds).toOption.get
      requests should have size 1
      schema.observedRowCount shouldBe Some(2L)
      schema.looksPaged shouldBe true
    }
    "flag a bare-url response that carries a Link next header" in {
      cleanLog()
      val schema = Await.result(driver.inferSchemaEphemeral(EphemeralRestConfig(url = s"http://localhost:$port/link?p=1", method = "GET")), 15.seconds).toOption.get
      requests should have size 1
      schema.looksPaged shouldBe true
    }
    "return the raw first page only from fetch(config, ctx)" in {
      cleanLog()
      val json = Await.result(driver.fetch(config("/link", Some(RestPagination.Link()), Vector("p" -> "1")), ConnectorResolveContext.Internal), 15.seconds).toOption.get
      json shouldBe ids(1, 2).parseJson
      requests should have size 1
    }
  }

  // GUARD (failable by a mutation that follows Link without config): an unconfigured source is exactly today's fetch.
  "A REST fetch with no pagination config (GUARD)" should {
    "issue exactly one request and return page one with the unchanged truncation fields" in {
      cleanLog()
      val out = run(config("/noconfig", None, root = Some("items"))).toOption.get
      requests shouldBe Vector("/noconfig")
      out shouldBe FetchOutcome(out.rows, truncated = false, availableRowCount = Some(2L))
      idsOf(out) shouldBe Vector(1, 2)
    }
  }
}
