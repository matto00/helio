package com.helio.services.sources

import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.EphemeralRestConfig
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.net.InetAddress
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}
import scala.util.{Success, Try}

/** HEL-1254: the pinned path must reuse a pool (and its TCP connections) across requests to the
 *  same validated address, without ever letting one address's pool serve a request validated to
 *  another. */
class PinnedPoolReuseSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private val rebindHost = "rebind-test.invalid"
  private val admitAll: (String, InetAddress) => Boolean = (_, _) => false

  private var servers: List[ConnectionCountingServer] = Nil

  private def startServer(host: String, port: Int, identity: String): ConnectionCountingServer = {
    val s = new ConnectionCountingServer(host, port, identity)
    servers ::= s
    s
  }

  override def afterAll(): Unit = {
    servers.foreach(_.stop())
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def idOf(body: String): String = body.parseJson.asJsObject.fields("id").convertTo[String]

  private def resolverTo(addrs: => InetAddress): String => Try[Array[InetAddress]] = host =>
    if (host == rebindHost) Success(Array(addrs)) else ContentSourceSupport.defaultResolveHost(host)

  private def restDriver(resolve: String => Try[Array[InetAddress]]) =
    new RestApiConnectorDriver(None, None, None, resolve, admitAll)(typedSystem)

  private def restId(driver: RestApiConnectorDriver, url: String): String =
    await(driver.fetchEphemeral(EphemeralRestConfig(url = url, method = "GET", headers = Map.empty))) match {
      case Right(json) => json.asJsObject.fields("id").convertTo[String]
      case Left(err)   => fail(s"fetchEphemeral failed: $err")
    }

  private def fetchId(url: String, resolve: String => Try[Array[InetAddress]]): String =
    await(ContentSourceSupport.fetchUrl(url, resolve, admitAll)) match {
      case Right(bytes) => idOf(new String(bytes, "UTF-8"))
      case Left(err)    => fail(s"fetchUrl failed: $err")
    }

  /** Two loopback servers on the same port. Binds A on an ephemeral port, then B on that port;
   *  falls back from 127.0.0.2 to ::1, and cancels (never silently passes) if neither binds.
   *  Returns the servers and a resolver-answer function: even calls answer A's address, odd B's. */
  private def pinningFixture(): (ConnectionCountingServer, ConnectionCountingServer, Int => InetAddress) = {
    val a = startServer("127.0.0.1", 0, "A")
    val second = List("127.0.0.2", "::1").view.flatMap { h =>
      Try(startServer(h, a.boundPort, "B")).toOption.map(s => (s, InetAddress.getByName(h)))
    }.headOption
    second match {
      case Some((b, addrB)) =>
        val addrA = InetAddress.getByName("127.0.0.1")
        (a, b, i => if (i % 2 == 0) addrA else addrB)
      case None => cancel("cannot bind a second loopback address (127.0.0.2 / ::1) on the same port")
    }
  }

  "fetchUrl" should {
    "reuse connections across 10 sequential requests to one address" in {
      val server = startServer("127.0.0.1", 0, "A")
      val url    = s"http://localhost:${server.boundPort}/x"
      (1 to 10).foreach(_ => fetchId(url, ContentSourceSupport.defaultResolveHost) shouldBe "A")
      server.connectionCount should be < 10
    }

    "complete 40 parallel requests to one host through the shared pool" in {
      val server  = startServer("127.0.0.1", 0, "A")
      val url     = s"http://localhost:${server.boundPort}/x"
      val results = await(Future.sequence((1 to 40).map(_ => ContentSourceSupport.fetchUrl(url, ContentSourceSupport.defaultResolveHost, admitAll))))
      all(results.map(_.isRight)) shouldBe true
    }

    "route A, B, A, B to the server each request was validated against" in {
      val (a, _, addrFor) = pinningFixture()
      val port            = a.boundPort
      val calls           = new AtomicInteger(0)
      val resolve         = resolverTo(addrFor(calls.getAndIncrement()))
      val ids             = (1 to 6).map(_ => fetchId(s"http://$rebindHost:$port/x", resolve))
      ids shouldBe Seq("A", "B", "A", "B", "A", "B")
    }

    "keep one connection per validated address while the resolver alternates" in {
      val (a, b, addrFor) = pinningFixture()
      val port            = b.boundPort
      val calls           = new AtomicInteger(0)
      val resolve         = resolverTo(addrFor(calls.getAndIncrement()))
      (1 to 6).foreach(_ => fetchId(s"http://$rebindHost:$port/x", resolve))
      (a.connectionCount, b.connectionCount) shouldBe ((1, 1))
    }

    "refuse a host now resolving to a blocked address before connecting, even with a warm pool" in {
      val server = startServer("127.0.0.1", 0, "A")
      val port   = server.boundPort
      val url    = s"http://$rebindHost:$port/x"
      val loop   = InetAddress.getByName("127.0.0.1")
      fetchId(url, resolverTo(loop)) shouldBe "A"
      val before = server.connectionCount

      val blocked = (_: String, addr: InetAddress) => addr == loop
      val result  = await(ContentSourceSupport.fetchUrl(url, resolverTo(loop), blocked))

      result.isLeft shouldBe true
      server.connectionCount shouldBe before
    }
  }

  "RestApiConnectorDriver" should {
    "reuse connections across 10 sequential requests to one address" in {
      val server = startServer("127.0.0.1", 0, "A")
      val driver = restDriver(ContentSourceSupport.defaultResolveHost)
      (1 to 10).foreach(_ => restId(driver, s"http://localhost:${server.boundPort}/x") shouldBe "A")
      server.connectionCount should be < 10
    }

    "route A, B, A, B to the server each request was validated against" in {
      val (_, b, addrFor) = pinningFixture()
      val calls           = new AtomicInteger(0)
      val driver          = restDriver(resolverTo(addrFor(calls.getAndIncrement())))
      val ids             = (1 to 4).map(_ => restId(driver, s"http://$rebindHost:${b.boundPort}/x"))
      ids shouldBe Seq("A", "B", "A", "B")
    }
  }
}
