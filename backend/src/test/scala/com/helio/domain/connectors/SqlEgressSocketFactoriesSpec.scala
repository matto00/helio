package com.helio.domain.connectors

import com.helio.domain.model.SqlSourceConfig
import com.helio.services.sources.ContentSourceSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.{File, IOException}
import java.net.{InetAddress, InetSocketAddress, ServerSocket, SocketException}
import java.nio.file.{Files, Paths}
import java.util.concurrent.atomic.AtomicInteger
import scala.jdk.CollectionConverters._

class SqlEgressSocketFactoriesSpec extends AnyWordSpec with Matchers {

  private def listener(): (ServerSocket, AtomicInteger) = {
    val server  = new ServerSocket(0, 50, InetAddress.getLoopbackAddress)
    val accepts = new AtomicInteger(0)
    val t = new Thread(() =>
      try while (true) { server.accept().close(); accepts.incrementAndGet() }
      catch { case _: SocketException => () }
    )
    t.setDaemon(true)
    t.start()
    (server, accepts)
  }

  private val blockedByPolicy: InetAddress => Boolean = ContentSourceSupport.isBlockedAddress

  "EgressValidatingSocket" should {

    "refuse a loopback address without connecting, and close itself" in {
      val (server, accepts) = listener()
      try {
        val socket = new EgressValidatingSocket
        EgressConnectGuard.withPredicate(blockedByPolicy) {
          val ex = intercept[EgressConnectRefusedException](socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress, server.getLocalPort), 1000))
          ex.getCause shouldBe a[SqlEgressRefusedException]
        }
        socket.isClosed shouldBe true
        Thread.sleep(200)
        accepts.get() shouldBe 0
      } finally server.close()
    }

    "refuse a link-local metadata address" in {
      val socket = new EgressValidatingSocket
      EgressConnectGuard.withPredicate(blockedByPolicy) {
        intercept[EgressConnectRefusedException](socket.connect(new InetSocketAddress(InetAddress.getByName("169.254.169.254"), 80), 1000))
      }
    }

    "refuse an unresolved address (fail closed)" in {
      val socket = new EgressValidatingSocket
      EgressConnectGuard.withPredicate(_ => false) {
        intercept[EgressConnectRefusedException](socket.connect(InetSocketAddress.createUnresolved("localhost", 5432), 1000))
      }
      socket.isClosed shouldBe true
    }

    "connect when the address is allowed" in {
      val (server, accepts) = listener()
      try {
        val socket = new EgressValidatingSocket
        EgressConnectGuard.withPredicate(_ => false)(socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress, server.getLocalPort), 1000))
        socket.isConnected shouldBe true
        socket.close()
        Thread.sleep(200)
        accepts.get() shouldBe 1
      } finally server.close()
    }

    "use the production denylist when no predicate is set" in {
      val socket = new EgressValidatingSocket
      intercept[EgressConnectRefusedException](socket.connect(new InetSocketAddress(InetAddress.getLoopbackAddress, 5432), 1000))
    }

    "refuse with an IOException that is not a SocketException (mysql's address loop swallows SocketException)" in {
      val ex = new EgressConnectRefusedException("x")
      ex shouldBe an[IOException]
      ex should not be a[SocketException]
    }
  }

  "the driver factories" should {

    "hand pgjdbc a validating socket from createSocket()" in {
      new PgEgressSocketFactory().createSocket() shouldBe an[EgressValidatingSocket]
    }

    "refuse the host/port overloads for a blocked address" in {
      EgressConnectGuard.withPredicate(blockedByPolicy) {
        intercept[EgressConnectRefusedException](new PgEgressSocketFactory().createSocket(InetAddress.getLoopbackAddress, 5432))
      }
    }

    "be attached by connectionProperties for each supported dialect, via Properties and never the URL" in {
      def cfg(d: String) = SqlSourceConfig(d, "db.example.com", 5432, "app", "u", "p", "SELECT 1")
      val pg = SqlConnectorDriver.connectionProperties(cfg("postgresql"))
      pg.getProperty("socketFactory") shouldBe classOf[PgEgressSocketFactory].getName
      pg.getProperty("loginTimeout") shouldBe "0"
      SqlConnectorDriver.connectionProperties(cfg("mysql")).getProperty("socketFactory") shouldBe classOf[MysqlEgressSocketFactory].getName
      Seq("postgresql", "mysql").foreach(d => SqlConnectorDriver.buildJdbcUrl(cfg(d)) should not include "socketFactory")
    }
  }

  "the application's own database connections" should {
    "never reference the egress factories" in {
      val root = Seq("src/main/scala", "backend/src/main/scala").map(new File(_)).find(_.isDirectory).get.toPath
      val referencing = Files.walk(root).iterator().asScala
        .filter(p => p.toString.endsWith(".scala"))
        .filter { p =>
          val text = Files.readString(p)
          text.contains("PgEgressSocketFactory") || text.contains("MysqlEgressSocketFactory") || text.contains("EgressConnectGuard")
        }
        .map(_.getFileName.toString)
        .toSet
      referencing shouldBe Set("SqlEgressSocketFactories.scala", "SqlConnectorDriver.scala")
    }

    "keep PipelineRunNotifyBus on a plain DriverManager connection" in {
      val bus = Files.readString(Paths.get(Seq("src/main/scala", "backend/src/main/scala").map(new File(_)).find(_.isDirectory).get.getPath,
        "com/helio/api/routes/pipelines/PipelineRunNotifyBus.scala"))
      bus should include("DriverManager.getConnection(dbUrl, dbUser, dbPassword)")
      bus should not include "socketFactory"
    }
  }
}
