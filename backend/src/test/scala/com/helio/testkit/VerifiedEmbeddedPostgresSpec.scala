package com.helio.testkit

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.IOException
import java.net.{InetAddress, InetSocketAddress, ServerSocket, Socket}
import java.nio.file.{Files, Path, Paths}
import java.sql.{Connection, SQLException}
import java.util.Comparator
import java.util.concurrent.atomic.{AtomicInteger, AtomicReference}

/** HEL-1445 regression: a zonky embedded-Postgres instance that loses its port silently adopts
 *  whichever other cluster is listening there. Cluster A is the "foreign" cluster; every scenario
 *  forces a start onto A's port, which is the race made deterministic. */
class VerifiedEmbeddedPostgresSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  import VerifiedEmbeddedPostgres.showDataDirectory

  private val marker = "hel1445_marker"

  private lazy val clusterA: EmbeddedPostgres = {
    val a = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())
    withConnection(a)(_.createStatement().execute(s"CREATE TABLE $marker (id int)"))
    a
  }

  private def withConnection[T](pg: EmbeddedPostgres)(f: Connection => T): T = {
    val c = pg.getPostgresDatabase.getConnection
    try f(c)
    finally c.close()
  }

  private def hasMarker(pg: EmbeddedPostgres): Boolean =
    withConnection(pg) { c =>
      val rs = c.createStatement().executeQuery(s"SELECT to_regclass('$marker') IS NOT NULL")
      rs.next()
      rs.getBoolean(1)
    }

  private def assertForeignClusterIntact(): Unit = {
    hasMarker(clusterA) shouldBe true
    showDataDirectory(clusterA) should not be empty
  }

  /** True when nothing listens on `port` (a postmaster that was stopped, or never started). */
  private def portRefused(port: Int): Boolean = {
    val sock = new Socket()
    try { sock.connect(new InetSocketAddress(InetAddress.getLoopbackAddress, port), 500); false }
    catch { case _: IOException => true }
    finally sock.close()
  }

  private def freePort(): Int = {
    val ss = new ServerSocket(0, 1, InetAddress.getLoopbackAddress)
    try ss.getLocalPort finally ss.close()
  }

  private def removeIfLeft(dir: Path): Unit = {
    val stream = if (Files.exists(dir)) Some(Files.walk(dir)) else None
    try stream.foreach(_.sorted(Comparator.reverseOrder[Path]()).forEach(p => Files.deleteIfExists(p)))
    finally stream.foreach(_.close())
  }

  override protected def afterAll(): Unit = {
    clusterA.close()
    super.afterAll()
  }

  "an unverified direct start pinned to a port another cluster holds" should {
    "silently attach to that other cluster (the defect)" in {
      val a      = clusterA
      val stolen = EmbeddedPostgres.builder().setPort(a.getPort).start() // embedded-pg-guard: deliberate unverified start (port-steal repro)
      try showDataDirectory(stolen) shouldBe showDataDirectory(a)
      finally stolen.close()
    }
  }

  "VerifiedEmbeddedPostgres.start pinned to a port another cluster holds" should {
    "end on its own cluster on a different port and leave the foreign cluster untouched" in {
      val a    = clusterA
      val aDir = showDataDirectory(a)
      val own  = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setPort(a.getPort))
      try {
        own.getPort should not be a.getPort
        showDataDirectory(own) should not be aDir
        hasMarker(own) shouldBe false
      } finally own.close()
      assertForeignClusterIntact()
      showDataDirectory(a) shouldBe aDir
    }

    "fail loudly naming every directory when all attempts collide, leaving the foreign cluster intact" in {
      val a    = clusterA
      val aDir = showDataDirectory(a)
      val ex = the[IllegalStateException] thrownBy
        VerifiedEmbeddedPostgres.startWith(
          EmbeddedPostgres.builder().setPort(a.getPort),
          maxAttempts = 2,
          nextPort = () => a.getPort,
          observeDataDirectory = showDataDirectory
        )
      ex.getMessage should include(aDir)
      val owns = """expected data_directory (\S+) but""".r.findAllMatchIn(ex.getMessage).map(_.group(1)).toVector
      owns should have size 2
      owns.distinct should have size 2
      owns.foreach { d => d should not be aDir; Files.exists(Paths.get(d)) shouldBe false }
      assertForeignClusterIntact()
      showDataDirectory(a) shouldBe aDir
    }
  }

  "a failed ownership check (the closed-connection shape)" should {
    "discard the attempt's own data directory and retry" in {
      val firstDir = new AtomicReference[String]()
      val calls    = new AtomicInteger(0)
      val own = VerifiedEmbeddedPostgres.startWith(
        EmbeddedPostgres.builder(),
        maxAttempts = 2,
        nextPort = () => 0,
        observeDataDirectory = pg =>
          if (calls.getAndIncrement() == 0) {
            firstDir.set(showDataDirectory(pg))
            throw new SQLException("This connection has been closed.")
          } else showDataDirectory(pg)
      )
      try {
        showDataDirectory(own) should not be firstDir.get()
        Files.exists(Paths.get(firstDir.get())) shouldBe false
      } finally own.close()
    }

    "carry the recorded error in the exhaustion message instead of propagating it as-is" in {
      val ex = the[IllegalStateException] thrownBy
        VerifiedEmbeddedPostgres.startWith(
          EmbeddedPostgres.builder(),
          maxAttempts = 1,
          nextPort = () => 0,
          observeDataDirectory = _ => throw new SQLException("This connection has been closed.")
        )
      ex.getMessage should include("This connection has been closed.")
    }
  }

  "a fatal throwable during the ownership check (HEL-1474)" should {
    "close the attempt's instance, delete its data directory and propagate the same throwable without a retry" in {
      val dir      = Files.createTempDirectory("hel1474-fatal") // temp-dir-hygiene: reviewed — the helper under test deletes it; removeIfLeft in finally
      val captured = new AtomicReference[EmbeddedPostgres]()
      val calls    = new AtomicInteger(0)
      val fatal    = new InterruptedException("hel1474 fatal")
      try {
        val thrown = the[InterruptedException] thrownBy
          VerifiedEmbeddedPostgres.startWith(
            EmbeddedPostgres.builder(),
            maxAttempts = 3,
            nextPort = () => 0,
            observeDataDirectory = pg => { calls.incrementAndGet(); captured.set(pg); throw fatal },
            newDataDirectory = () => dir
          )
        (thrown should be).theSameInstanceAs(fatal)
        calls.get shouldBe 1
        Files.exists(dir) shouldBe false
        portRefused(captured.get.getPort) shouldBe true
      } finally {
        Option(captured.get).foreach(_.close())
        removeIfLeft(dir)
      }
    }
  }

  "a zonky start that fails before launching a postmaster (HEL-1474)" should {
    "delete the attempt's data directory and propagate the library's error unchanged" in {
      val dir   = Files.createTempDirectory("hel1474-initdb") // temp-dir-hygiene: reviewed — the helper under test deletes it; removeIfLeft in finally
      val port  = freePort()
      val calls = new AtomicInteger(0)
      try {
        // An invalid locale makes initdb exit non-zero inside the constructor, before the postmaster launch
        // and its shutdown hook (zonky 2.0.7 EmbeddedPostgres.java:157 vs :275/:283; proof/zonky-start-failure.txt).
        val ex = the[IllegalStateException] thrownBy
          VerifiedEmbeddedPostgres.startWith(
            EmbeddedPostgres.builder().setPort(port).setLocaleConfig("locale", "hel1474-no-such-locale"),
            maxAttempts = 3,
            nextPort = () => 0,
            observeDataDirectory = showDataDirectory,
            newDataDirectory = () => { calls.incrementAndGet(); dir }
          )
        ex.getMessage should include("initdb")
        calls.get shouldBe 1
        Files.exists(dir) shouldBe false
        portRefused(port) shouldBe true
      } finally removeIfLeft(dir)
    }
  }
}
