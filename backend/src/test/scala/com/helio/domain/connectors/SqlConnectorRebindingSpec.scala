package com.helio.domain.connectors

import com.helio.domain.model.SqlSourceConfig
import com.helio.testsupport.AcceptRecordingListener
import com.helio.services.sources.ContentSourceSupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.InetAddress
import scala.util.{Success, Try}

/** HEL-998: the guard's lookup sees a public address for the host while the JDBC driver's own,
 *  independent lookup of the same name lands on loopback (a DNS rebind). The only injected seam is
 *  the guard's `resolveHost`; the driver resolves "localhost" itself, so nothing here can make the
 *  driver's lookup differ from the real one. Loopback is the "internal" target, so reaching the
 *  listener / the embedded server IS the SSRF, not a simulation of it. */
class SqlConnectorRebindingSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private var embeddedPostgres: EmbeddedPostgres = _

  override def beforeAll(): Unit =
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

  override def afterAll(): Unit =
    if (embeddedPostgres != null) embeddedPostgres.close()

  private val publicOnFirstLookup: String => Try[Array[InetAddress]] =
    _ => Success(Array(InetAddress.getByName("93.184.216.34")))

  private def config(dialect: String, port: Int): SqlSourceConfig =
    SqlSourceConfig(dialect, "localhost", port, "postgres", "postgres", "postgres", "SELECT 1")

  "SqlConnectorDriver.connect with a rebinding resolver (public for the guard, loopback for the driver)" should {

    "never reach the internal address for postgresql" in {
      val result = Try(SqlConnectorDriver.connect(config("postgresql", embeddedPostgres.getPort), publicOnFirstLookup))
      result.foreach(_.close())
      result.failed.toOption.collect { case e: SqlEgressRefusedException => e } should not be empty
    }

    "never reach the internal address for mysql" in {
      val listener = AcceptRecordingListener.start()
      try {
        val result = Try(SqlConnectorDriver.connect(config("mysql", listener.port), publicOnFirstLookup))
        result.foreach(_.close())
        // HEL-1341 D4: sentinel-identified barrier -- nothing but the sentinel was ever accepted.
        val (accepted, sentinelPort) = listener.acceptedThroughSentinel()
        accepted shouldBe List(sentinelPort)
        result.failed.toOption.collect { case e: SqlEgressRefusedException => e } should not be empty
      } finally listener.close()
    }
  }

  "the connect-time hook on its own (guard made permissive)" should {

    "refuse loopback for postgresql when only the hook is strict" in {
      val result = Try(
        SqlConnectorDriver.connect(
          config("postgresql", embeddedPostgres.getPort),
          resolveHost      = publicOnFirstLookup,
          isBlocked        = (_, _) => false,
          connectIsBlocked = Some(addr => ContentSourceSupport.isBlockedAddress(addr))
        )
      )
      result.foreach(_.close())
      result.failed.toOption.collect { case e: SqlEgressRefusedException => e } should not be empty
    }

    "refuse loopback for mysql when only the hook is strict, without a connection attempt" in {
      val listener = AcceptRecordingListener.start()
      try {
        val result = Try(
          SqlConnectorDriver.connect(
            config("mysql", listener.port),
            resolveHost      = publicOnFirstLookup,
            isBlocked        = (_, _) => false,
            connectIsBlocked = Some(addr => ContentSourceSupport.isBlockedAddress(addr))
          )
        )
        result.foreach(_.close())
        // HEL-1341 D4: sentinel-identified barrier -- nothing but the sentinel was ever accepted.
        val (accepted, sentinelPort) = listener.acceptedThroughSentinel()
        accepted shouldBe List(sentinelPort)
        result.failed.toOption.collect { case e: SqlEgressRefusedException => e } should not be empty
      } finally listener.close()
    }

    "connect and run a query when the hook admits the address" in {
      val conn = SqlConnectorDriver.connect(
        config("postgresql", embeddedPostgres.getPort),
        resolveHost      = publicOnFirstLookup,
        isBlocked        = (_, _) => false,
        connectIsBlocked = Some(_ => false)
      )
      try {
        val rs = conn.createStatement().executeQuery("SELECT 1")
        rs.next() shouldBe true
        rs.getInt(1) shouldBe 1
      } finally conn.close()
    }

    "not leak a connect predicate onto the calling thread after connect returns" in {
      EgressConnectGuard.withPredicate(_ => false)(())
      EgressConnectGuard.isBlocked(InetAddress.getLoopbackAddress) shouldBe true
    }
  }

  "database names that try to inject JDBC URL parameters" should {

    "not be able to override the socket factory (refused before any connection)" in {
      val cfg = config("postgresql", embeddedPostgres.getPort).copy(database = "postgres?socketFactory=javax.net.DefaultSocketFactory")
      val ex  = intercept[SqlConfigRefusedException](SqlConnectorDriver.connect(cfg, publicOnFirstLookup, (_, _) => false))
      ex.getMessage should include("database")
    }
  }
}
