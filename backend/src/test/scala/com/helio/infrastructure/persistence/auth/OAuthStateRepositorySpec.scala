package com.helio.infrastructure.persistence.auth

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend

import scala.collection.mutable.ArrayBuffer
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1019 tasks.md section 4 — the load-bearing evidence for the OAuth CSRF cross-instance
 *  fix. `object AuthService`'s prior `ConcurrentHashMap` made two `new AuthService(...)`
 *  instances share ONE store, which is exactly why a naive "construct two AuthService instances"
 *  test proves nothing (ticket, verified refinement). This spec instead constructs, for every
 *  cross-process assertion, two entirely separate [[OAuthStateRepository]] instances — each with
 *  its own [[DbContext]] and its own `JdbcBackend.Database` connection pool obtained from the
 *  SAME `EmbeddedPostgres` instance — so the only thing they share is the durable storage layer
 *  itself, exactly mirroring two independent Cloud Run processes talking to one Postgres
 *  database. */
class OAuthStateRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with BeforeAndAfterEach {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _

  // Non-blocking suggestion from evaluation-1.md: every `forDataSource` call opens a real
  // connection pool; track every one this spec creates (`newRepository`, `readRow`, the ad hoc
  // out-of-band connections in the expiry/pruning/durability tests) and close them all after each
  // test, rather than leaking ~20 pools per run.
  private val openDbs = ArrayBuffer.empty[JdbcBackend.Database]

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
  }

  override def afterEach(): Unit = {
    openDbs.foreach(_.close())
    openDbs.clear()
    super.afterEach()
  }

  override def afterAll(): Unit = {
    if (embeddedPostgres != null) embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def trackedDb(): JdbcBackend.Database = {
    val db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
    openDbs += db
    db
  }

  /** Every call returns a genuinely new `OAuthStateRepository`, backed by its OWN
   *  `JdbcBackend.Database` connection pool (a fresh `forDataSource` call) and its OWN
   *  `DbContext` — no object is shared between two repositories returned by two calls to this
   *  method, other than the underlying EmbeddedPostgres storage. This is what makes 4.1
   *  meaningful: unlike two `new AuthService(...)`s over the pre-fix companion map, these two
   *  instances hold no in-memory state in common. */
  private def newRepository(): OAuthStateRepository = {
    val db = trackedDb()
    // The embedded instance connects as the Postgres superuser, so both "pools" here are the
    // same superuser connection — that's fine for THIS spec (it isolates the in-memory-sharing
    // defect, not the grant), and is exactly the same simplification GoogleOAuthRoutesSpec and
    // RlsPolicyGuardSpec already make. The grant itself is verified separately (tasks.md 1.4),
    // against a non-superuser-migrated database, because this embedded harness cannot catch a
    // missing GRANT either way.
    new OAuthStateRepository(new DbContext(db, db))
  }

  /** Out-of-band read, on a connection entirely separate from any `OAuthStateRepository` under
   *  test — used to assert durability (the row actually landed in Postgres) and to delete a row
   *  behind a repository's back (the durability-negative arm, CR1). */
  private def readRow(state: String): Option[String] = {
    import slick.jdbc.PostgresProfile.api._
    await(trackedDb().run(sql"SELECT state FROM oauth_states WHERE state = $state".as[String].headOption))
  }

  private def deleteRowOutOfBand(state: String): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(trackedDb().run(sqlu"DELETE FROM oauth_states WHERE state = $state"))
  }

  private def cleanTable(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(trackedDb().run(sqlu"TRUNCATE TABLE oauth_states"))
  }

  "Cross-process round trip (tasks.md 4.1)" should {

    "validate a state issued by one repository instance through a separately constructed instance" in {
      cleanTable()
      val issuer    = newRepository()
      val validator = newRepository()

      val state = await(issuer.issue())
      state should not be empty

      // CR1 (evaluation-1.md): assert the row actually landed in Postgres, on a connection
      // entirely separate from `issuer` — this is what a JVM-wide (companion-object-shaped)
      // in-memory store cannot fake. Without this, a mutant that never writes to the database at
      // all still passes the assertion below (two in-process instances of the SAME map both
      // "see" the state), which is exactly the class of vacuous green evaluation-1.md found.
      readRow(state) shouldBe defined

      val result = await(validator.validateAndConsume(state))
      result shouldBe true
    }

    "still succeed after the issuing instance is entirely discarded" in {
      cleanTable()
      var issuer: OAuthStateRepository = newRepository()
      val state                        = await(issuer.issue())
      issuer = null // discard — nothing else in the JVM references the issuing instance

      val validator = newRepository()
      await(validator.validateAndConsume(state)) shouldBe true
    }

    "fail once the row has been deleted out-of-band, even though issue() reported success (durability negative arm, tasks.md 4.2/CR1)" in {
      cleanTable()
      val issuer    = newRepository()
      val validator = newRepository()

      val state = await(issuer.issue())
      readRow(state) shouldBe defined // sanity: the row really is there before we remove it

      // Simulates the state never having reached durable storage at all (or having been lost
      // between issue and validate) by deleting it through a connection neither repository
      // instance holds a reference to. An in-memory store — per-instance OR JVM-wide — cannot
      // distinguish this from "the state I have in my map is still there", because it never
      // consulted Postgres in the first place. Only a genuinely durability-backed store fails
      // this the way the real implementation does.
      deleteRowOutOfBand(state)

      await(validator.validateAndConsume(state)) shouldBe false
    }
  }

  "Instrument sanity (tasks.md 4.10)" should {

    "confirm the instrument returns the negative for a state known to be invalid, before trusting any other assertion" in {
      cleanTable()
      val repo = newRepository()
      // Verified-known-bad input: never issued by anything.
      await(repo.validateAndConsume("00000000000000000000000000000000")) shouldBe false
    }
  }

  "Forged / never-issued state (tasks.md 4.3)" should {

    "fail validation" in {
      cleanTable()
      val issuer    = newRepository()
      val validator = newRepository()
      await(issuer.issue()) // establish that the table/round trip works at all in this test
      await(validator.validateAndConsume("forged-state-value-never-issued")) shouldBe false
    }
  }

  "Expired state (tasks.md 4.4)" should {

    "fail validation once expires_at has elapsed" in {
      cleanTable()
      import slick.jdbc.PostgresProfile.api._
      val repo = newRepository()
      val state = await(repo.issue())

      // Force this specific row into the past rather than sleeping 300s.
      await(trackedDb().run(sqlu"UPDATE oauth_states SET expires_at = now() - interval '1 second' WHERE state = $state"))

      await(repo.validateAndConsume(state)) shouldBe false
    }
  }

  "Replay (tasks.md 4.5)" should {

    "let the first validation succeed and every subsequent validation of the same state fail" in {
      cleanTable()
      val issuer    = newRepository()
      val validator = newRepository()
      val state     = await(issuer.issue())

      await(validator.validateAndConsume(state)) shouldBe true
      await(validator.validateAndConsume(state)) shouldBe false
      await(issuer.validateAndConsume(state)) shouldBe false
    }
  }

  "Concurrent validation (tasks.md 4.6)" should {

    "let exactly one of many concurrent validations of the same state succeed" in {
      cleanTable()
      val issuer = newRepository()
      val state  = await(issuer.issue())

      val validators = Vector.fill(10)(newRepository())
      val results    = await(Future.sequence(validators.map(_.validateAndConsume(state))))

      results.count(identity) shouldBe 1
    }
  }

  "Pruning (tasks.md 4.8)" should {

    "remove an expired row and leave an unexpired unconsumed row still valid" in {
      cleanTable()
      import slick.jdbc.PostgresProfile.api._
      val repo = newRepository()

      val expiredState   = await(repo.issue())
      val unexpiredState = await(repo.issue())

      // Sanity per the non-blocking suggestion in evaluation-1.md: confirm the expired row is
      // actually present BEFORE pruning, so a later "not found" distinguishes "pruned correctly"
      // from "nothing was ever stored" (a mutant that stores nothing would otherwise pass this
      // test vacuously).
      readRow(expiredState) shouldBe defined

      await(trackedDb().run(sqlu"UPDATE oauth_states SET expires_at = now() - interval '1 second' WHERE state = $expiredState"))

      // `issue()` prunes expired rows as a side effect of every write (design.md: pruning is
      // expiry-driven, not scheduled) — a third issue triggers the prune.
      await(repo.issue())

      readRow(expiredState) shouldBe empty
      await(repo.validateAndConsume(unexpiredState)) shouldBe true
    }
  }

  "No state value is ever logged (tasks.md 4.9)" should {

    "emit no log record containing the state value across issue, a failing validation, and a succeeding one" in {
      cleanTable()
      // Scoped to `com.helio` — our own application loggers — rather than the root logger:
      // the root logger also carries Slick's own internal statement/compiler debug tracing
      // (which echoes bound parameter VALUES, including the state, as part of the framework's
      // own unrelated SQL debug output whenever DEBUG happens to be enabled for it). That
      // framework-internal echo is not what this requirement targets — the requirement is that
      // *this system's own logging calls* never pass a state value, which is what this scope
      // actually verifies: `OAuthStateRepository` and `OAuthRoutes` never format a state into a
      // `log.*` call in the first place.
      val logbackLogger = LoggerFactory.getLogger("com.helio").asInstanceOf[LogbackLogger]
      val appender      = new ListAppender[ILoggingEvent]()
      appender.start()
      logbackLogger.addAppender(appender)

      try {
        val issuer    = newRepository()
        val validator = newRepository()
        val state     = await(issuer.issue())
        await(validator.validateAndConsume("some-forged-value-not-the-real-state")) shouldBe false
        await(validator.validateAndConsume(state)) shouldBe true

        import scala.jdk.CollectionConverters._
        val allMessages = appender.list.asScala.map(_.getFormattedMessage).mkString("\n")
        allMessages should not include state
      } finally {
        logbackLogger.detachAppender(appender)
      }
    }
  }
}
