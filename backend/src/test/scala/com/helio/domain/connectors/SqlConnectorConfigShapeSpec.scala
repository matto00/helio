package com.helio.domain.connectors

import com.helio.domain.model.SqlSourceConfig
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.{InetAddress, ServerSocket, SocketException}
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}
import scala.util.{Success, Try}

class SqlConnectorConfigShapeSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def cfg(dialect: String = "postgresql", database: String = "app", host: String = "db.example.com", port: Int = 5432) =
    SqlSourceConfig(dialect, host, port, database, "u", "p", "SELECT 1")

  private val publicResolver: String => Try[Array[InetAddress]] = _ => Success(Array(InetAddress.getByName("93.184.216.34")))

  "SqlConnectorDriver.validateConfigShape" should {
    Seq("postgresql", "mysql").foreach(d => s"accept dialect $d" in { SqlConnectorDriver.validateConfigShape(cfg(dialect = d)) shouldBe Right(()) })

    Seq("oracle", "mssql", "sqlite", "", "PostgreSQL", "postgres", "mysql ").foreach { d =>
      s"refuse dialect '$d' naming the supported dialects" in {
        val Left(msg) = SqlConnectorDriver.validateConfigShape(cfg(dialect = d))
        msg should include("postgresql")
        msg should include("mysql")
      }
    }

    Seq("app", "my-db_1.x$", "A1").foreach(db => s"accept database '$db'" in { SqlConnectorDriver.validateConfigShape(cfg(database = db)) shouldBe Right(()) })

    Seq(
      "x?socketFactory=javax.net.DefaultSocketFactory",
      "x&y=1",
      "x;y",
      "a/b",
      "a#b",
      "a%20b",
      "a b",
      "a=b",
      "",
      "app\n",
      "app\r\n"
    ).foreach { db =>
      s"refuse database ${db.replace("\n", "\\n").replace("\r", "\\r")}" in {
        SqlConnectorDriver.validateConfigShape(cfg(database = db)).isLeft shouldBe true
      }
    }
  }

  "SqlConnectorDriver.connect" should {
    "refuse an unknown dialect with a typed refusal and open no connection" in {
      val server  = new ServerSocket(0, 50, InetAddress.getLoopbackAddress)
      val accepts = new AtomicInteger(0)
      val t = new Thread(() => try while (true) { server.accept().close(); accepts.incrementAndGet() } catch { case _: SocketException => () })
      t.setDaemon(true)
      t.start()
      try {
        val ex = intercept[SqlConfigRefusedException](
          SqlConnectorDriver.connect(cfg(dialect = "oracle", host = "localhost", port = server.getLocalPort), publicResolver, (_, _) => false)
        )
        ex.getMessage should include("postgresql, mysql")
        Thread.sleep(300)
        accepts.get() shouldBe 0
      } finally server.close()
    }

    "surface the dialect refusal verbatim from execute and testConnection" in {
      val bad = cfg(dialect = "oracle")
      val Left(msg1) = Await.result(SqlConnectorDriver.execute(bad, 10, publicResolver), 5.seconds)
      msg1 should include("Unsupported SQL dialect 'oracle'")
      val Left(msg2) = Await.result(SqlConnectorDriver.testConnection(bad, ConnectorResolveContext.Internal, publicResolver), 5.seconds)
      msg2 should include("postgresql, mysql")
    }

    "refuse hosts that could carry URL syntax" in {
      Seq("a?b", "a/b", "a#b", "u@h", "a b", "h:5432", "h\n").foreach { h =>
        SqlConnectorDriver.checkConfigEgress(cfg(host = h), publicResolver).isLeft shouldBe true
      }
    }
  }

  "SqlConnectorDriver.buildJdbcUrl" should {
    "throw a typed refusal for an unsupported dialect" in {
      intercept[SqlConfigRefusedException](SqlConnectorDriver.buildJdbcUrl(cfg(dialect = "oracle")))
    }
  }
}
