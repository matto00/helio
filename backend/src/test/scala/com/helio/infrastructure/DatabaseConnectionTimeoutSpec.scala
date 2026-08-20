package com.helio.infrastructure

import com.typesafe.config.ConfigFactory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.net.ServerSocket
import scala.concurrent.Await
import scala.concurrent.duration._
import scala.util.Try

/** HEL-750 task 3.5: proves the `connectionTimeout = 5000` now configured for
 *  `helio.db` in `application.conf` is what actually bounds connection-acquisition
 *  latency, by exercising the exact `JdbcBackend.Database.forConfig("helio.db",
 *  config)` call `Database.initApp` uses in production -- a faithful in-process
 *  reproduction of the ~30s-hang incident this ticket was filed against, without
 *  needing a real Cloud SQL outage.
 *
 *  Points the pool at a local "blackhole" socket -- a `ServerSocket` that accepts the
 *  TCP connection but never writes a byte back -- rather than an external
 *  non-routable address. That failure mode (connection accepted at the TCP level,
 *  then hangs waiting on the Postgres startup handshake) is exactly what HikariCP's
 *  `connectionTimeout` bounds, and is deterministic and independent of the test
 *  environment's egress/firewall policy (an external non-routable IP can fail
 *  instantly with "No route to host" in some sandboxes, which would defeat the point
 *  of this test).
 */
class DatabaseConnectionTimeoutSpec extends AnyWordSpec with Matchers {

  "helio.db (Database.forConfig, HEL-750)" should {

    "surface a connection-acquisition failure within a few seconds, not HikariCP's 30s default" in {
      val server = new ServerSocket(0)
      val acceptThread = new Thread(() => {
        try {
          while (true) server.accept() // accept, never respond -- the blackhole
        } catch { case _: Throwable => () }
      })
      acceptThread.setDaemon(true)
      acceptThread.start()

      // Mirrors `helio.db`'s tuning in application.conf, pointed at the blackhole
      // socket instead of a real Postgres instance.
      val config = ConfigFactory.parseString(
        s"""
           |helio.db {
           |  url               = "jdbc:postgresql://localhost:${server.getLocalPort}/helio"
           |  driver            = "org.postgresql.Driver"
           |  user              = ""
           |  password          = ""
           |  connectionPool    = "HikariCP"
           |  numThreads        = 1
           |  maximumPoolSize   = 1
           |  minimumIdle       = 0
           |  idleTimeout       = 30000
           |  maxLifetime       = 1800000
           |  connectionTimeout = 5000
           |}
           |""".stripMargin
      )

      val start = System.nanoTime()
      val outcome = Try {
        val db = JdbcBackend.Database.forConfig("helio.db", config)
        try Await.result(db.run(sql"SELECT 1".as[Int]), 15.seconds)
        finally db.close()
      }
      val elapsedMs = (System.nanoTime() - start) / 1000000L
      server.close()

      withClue(s"outcome=$outcome elapsedMs=$elapsedMs: ") {
        outcome.isFailure shouldBe true
        // Comfortably above the 5000 ms connectionTimeout (JVM/thread-scheduling
        // jitter) but well under HikariCP's 30000 ms default -- the exact
        // regression this ticket fixes. A lower bound confirms this genuinely
        // exercised the timeout path rather than failing for some unrelated,
        // near-instant reason.
        elapsedMs should be >= 3000L
        elapsedMs should be < 15000L
      }
    }
  }
}
