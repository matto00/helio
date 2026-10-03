package com.helio.domain.connectors

import com.helio.domain.model.SqlSourceConfig
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.InetAddress
import java.nio.file.{Files, Path}
import java.nio.file.attribute.PosixFilePermissions
import java.sql.{Connection, DriverManager, SQLException}
import scala.util.{Success, Try}

/** HEL-998 D4: pgjdbc wraps the factory's plain socket in TLS itself after the SSLRequest exchange,
 *  so the factory must not stand between the driver and the handshake. Proven against a real
 *  TLS-enabled Postgres with a throwaway self-signed certificate; cancelled (not passed) where
 *  `openssl` is unavailable to mint one. */
class SqlConnectorTlsSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private var certDir: Path                      = _
  private var tlsPostgres: Option[EmbeddedPostgres] = None

  private def opensslAvailable: Boolean = Try(new ProcessBuilder("openssl", "version").redirectErrorStream(true).start().waitFor() == 0).getOrElse(false)

  override def beforeAll(): Unit =
    if (opensslAvailable) {
      certDir = newTempDir("helio-tls-")
      val key  = certDir.resolve("server.key")
      val cert = certDir.resolve("server.crt")
      val exit = new ProcessBuilder("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key.toString,
        "-out", cert.toString, "-subj", "/CN=localhost", "-days", "1").redirectErrorStream(true).start().waitFor()
      require(exit == 0, "openssl failed to mint the test certificate")
      Files.setPosixFilePermissions(key, PosixFilePermissions.fromString("rw-------"))
      tlsPostgres = Some(
        EmbeddedPostgres.builder()
          .setServerConfig("ssl", "on")
          .setServerConfig("ssl_cert_file", cert.toString)
          .setServerConfig("ssl_key_file", key.toString)
          .start()
      )
    }

  override def afterAll(): Unit =
    try tlsPostgres.foreach(_.close())
    finally super.afterAll()

  private def config(port: Int) = SqlSourceConfig("postgresql", "localhost", port, "postgres", "postgres", "postgres", "SELECT 1")

  private def sessionUsesTls(conn: Connection): Boolean = {
    val rs = conn.createStatement().executeQuery("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
    rs.next() && rs.getBoolean(1)
  }

  "pgjdbc through PgEgressSocketFactory" should {

    "complete sslmode=require and report an encrypted session" in {
      assume(tlsPostgres.isDefined, "openssl unavailable: cannot mint a certificate for the TLS proof")
      val cfg   = config(tlsPostgres.get.getPort)
      val props = SqlConnectorDriver.connectionProperties(cfg)
      props.setProperty("sslmode", "require")
      val conn = EgressConnectGuard.withPredicate(_ => false)(DriverManager.getConnection(SqlConnectorDriver.buildJdbcUrl(cfg), props))
      try sessionUsesTls(conn) shouldBe true
      finally conn.close()
    }

    "use TLS through SqlConnectorDriver.connect (driver default sslmode=prefer)" in {
      assume(tlsPostgres.isDefined, "openssl unavailable: cannot mint a certificate for the TLS proof")
      val conn = SqlConnectorDriver.connect(
        config(tlsPostgres.get.getPort),
        _ => Success(Array(InetAddress.getByName("93.184.216.34"))),
        (_, _) => false
      )
      try sessionUsesTls(conn) shouldBe true
      finally conn.close()
    }

    "still refuse a blocked address when sslmode=require is set" in {
      assume(tlsPostgres.isDefined, "openssl unavailable: cannot mint a certificate for the TLS proof")
      val cfg   = config(tlsPostgres.get.getPort)
      val props = SqlConnectorDriver.connectionProperties(cfg)
      props.setProperty("sslmode", "require")
      val ex = intercept[SQLException](EgressConnectGuard.withPredicate(_ => true)(DriverManager.getConnection(SqlConnectorDriver.buildJdbcUrl(cfg), props)))
      Iterator.iterate[Throwable](ex)(_.getCause).takeWhile(_ != null).exists(_.isInstanceOf[SqlEgressRefusedException]) shouldBe true
    }
  }
}
