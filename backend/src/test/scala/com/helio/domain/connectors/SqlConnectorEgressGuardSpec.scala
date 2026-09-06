package com.helio.domain.connectors

import com.helio.domain.model.SqlSourceConfig
import com.helio.services.sources.{ContentSourceSupport, EgressCheck}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import spray.json.JsNumber

import java.net.{InetAddress, UnknownHostException}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** HEL-952: proves the SQL connector's SSRF exposure is real (task 2), then proves the
 *  connect-time guard actually closes it (task 3), then covers every blocked class (task 4) and
 *  the `checkConfigEgress`-level `failOnUnresolvable` tolerance (task 5's disposition split, at
 *  the pure-function level ONLY — the actual `SourceService.createSql` create-time REJECTION
 *  path, and the proof that a blocked host is neither persisted nor returned as a 200, are
 *  covered separately by `SourceServiceSpec`'s "reject createSql for a host resolving to ..."
 *  block, added and mutation-checked in response to skeptic-final-1 CR1), and legitimate
 *  hosts still working (task 6).
 *
 *  Uses its own `EmbeddedPostgres` bound to loopback — a genuine member of the blocked address
 *  class, so `SqlConnectorDriver.execute` reaching it and returning real rows IS the SSRF
 *  demonstration, not a simulation of one. No Flyway migration, no shared dev database, no
 *  Playwright, no e2e.
 *
 *  task 2.2/2.3 evidence (RED-before-green — the SSRF was reachable before this guard existed) is
 *  recorded at openspec/changes/sql-connector-egress-guard/evidence/task-2.2-ssrf-reachable.txt.
 *  The "currently succeed and return rows" assertion that produced that transcript is FLIPPED
 *  below (task 3.3) to the refusal assertion now that the guard is wired in — this is that same
 *  test, not a new one, so the red-then-green pair is preserved rather than deleted. */
class SqlConnectorEgressGuardSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _

  override def beforeAll(): Unit =
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

  override def afterAll(): Unit =
    if (embeddedPostgres != null) embeddedPostgres.close()

  private def loopbackConfig(host: String = "localhost", query: String = "SELECT 1 AS one"): SqlSourceConfig =
    SqlSourceConfig(
      dialect  = "postgresql",
      host     = host,
      port     = embeddedPostgres.getPort,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def resolverFor(host: String, addr: String): String => Try[Array[InetAddress]] =
    h => if (h == host) Success(Array(InetAddress.getByName(addr))) else Failure(new RuntimeException(s"unexpected host: $h"))

  // task 2.2/2.3/3.3: the RED-before-green proof, NOW FLIPPED to the post-guard assertion. Before
  // any guard existed, this exact test asserted `execute` succeeded with rows (see the evidence
  // file above for that transcript) — proving the SSRF was reachable. Now that the connect-time
  // guard is wired in, the same call must be REFUSED, and the failure must be identifiably the
  // egress refusal (task 3.3's "not a timeout, a missing driver, or a fixture error" bar) — the
  // curated message is required to start with "Egress refused:", never a raw driver/timeout
  // message, so this assertion cannot pass for the wrong reason.
  "SqlConnectorDriver.execute against a loopback target" should {
    "be REFUSED by the connect-time guard, not succeed with rows (task 3.3, post-guard)" in {
      val result = await(SqlConnectorDriver.execute(loopbackConfig(), maxRows = 10))
      result shouldBe a[Left[_, _]]
      val Left(err) = result
      err should startWith("Egress refused:")
      err should include("localhost")
    }
  }

  // task 4: blocked-class coverage (AC1, AC2) — one assertion per class, via an injected
  // resolver, hermetic (no real DNS).
  "SqlConnectorDriver.checkConfigEgress" should {
    Seq(
      "loopback"                        -> "127.0.0.1",
      "link-local (GCP/AWS metadata)"    -> "169.254.169.254",
      "private 10/8"                    -> "10.0.0.1",
      "private 192.168/16"              -> "192.168.1.1",
      "private 172.16/12"               -> "172.16.0.1",
      "IPv6 loopback"                   -> "::1",
      "IPv6 ULA"                        -> "fd12:3456::1"
    ).foreach { case (label, addr) =>
      s"refuse a host resolving to $label ($addr)" in {
        val cfg    = loopbackConfig(host = "victim.test")
        val result = SqlConnectorDriver.checkConfigEgress(cfg, resolveHost = resolverFor("victim.test", addr))
        result shouldBe a[Left[_, _]]
      }
    }

    // task 4.2 (AC2): a DNS name resolving to an internal address is refused — proves the guard
    // checks the RESOLVED address, not the hostname string (never matches on "localhost").
    "refuse a DNS name resolving to an internal address, proving it checks the resolved address, not the hostname string" in {
      val cfg    = loopbackConfig(host = "internal-db.test")
      val result = SqlConnectorDriver.checkConfigEgress(cfg, resolveHost = resolverFor("internal-db.test", "169.254.169.254"))
      result shouldBe a[Left[_, _]]
    }

    // task 4.3: multi-A-record defence — a host resolving to one public AND one internal address
    // must still be refused (the shared `checkResolvedHost` core's `addresses.exists(...)` rule).
    "refuse when one resolved address is public and another (same host) is internal" in {
      val cfg = loopbackConfig(host = "multi.test")
      val multiResolve: String => Try[Array[InetAddress]] = h =>
        if (h == "multi.test")
          Success(Array(InetAddress.getByName("93.184.216.34"), InetAddress.getByName("10.0.0.1")))
        else Failure(new RuntimeException(s"unexpected host: $h"))
      SqlConnectorDriver.checkConfigEgress(cfg, resolveHost = multiResolve) shouldBe a[Left[_, _]]
    }

    // task 3 (Decision 2): connect time fails closed on Unresolvable too — unlike create time
    // (Decision 3), there is no behaviour to preserve for a host that cannot be connected to.
    "refuse (fail closed) an unresolvable host at connect time" in {
      val cfg    = loopbackConfig(host = "nonexistent.invalid.test")
      val result = SqlConnectorDriver.checkConfigEgress(cfg, resolveHost = _ => Failure(new UnknownHostException("nope")))
      result shouldBe a[Left[_, _]]
    }

    // task 5.3: create time (failOnUnresolvable = false) tolerates the SAME outcome.
    "tolerate an unresolvable host when failOnUnresolvable = false (create-time disposition)" in {
      val cfg    = loopbackConfig(host = "not-yet-provisioned.test")
      val result = SqlConnectorDriver.checkConfigEgress(
        cfg,
        resolveHost = _ => Failure(new UnknownHostException("nope")),
        failOnUnresolvable = false
      )
      result shouldBe a[Right[_, _]]
    }
  }

  // task 6 (AC4): legitimate hosts still work.
  "SqlConnectorDriver against a legitimate (test-admitted) host" should {
    "resolve to Allowed via checkEgressHost when mapped to a public address" in {
      ContentSourceSupport.checkEgressHost(
        "legit-db.test",
        resolveHost = resolverFor("legit-db.test", "93.184.216.34")
      ) shouldBe a[EgressCheck.Allowed]
    }

    "actually connect end-to-end and return rows when isBlocked admits the known test host" in {
      // Uses the REAL hostname "localhost" (real, unmodified DNS — no injected resolver
      // override) rather than a fake `.test` name: the actual JDBC driver does its OWN
      // independent DNS resolution inside `DriverManager.getConnection` (design.md Decision 4 —
      // the JDBC connection is not pinned, unlike REST), so a resolver override alone cannot make
      // a non-existent hostname actually connect. Only `isBlocked` is overridden here, admitting
      // this one known-safe hostname past the denylist — exactly the pattern
      // `ContentSourceSupportSpec`'s `admitLocalhost` and `DataSourceRoutesSpec` already use.
      val cfg = loopbackConfig(host = "localhost")
      val result = await(
        SqlConnectorDriver.execute(
          cfg,
          maxRows   = 10,
          isBlocked = (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
        )
      )
      result shouldBe a[Right[_, _]]
      val Right(rows) = result
      rows should not be empty
      rows.head("one") shouldBe JsNumber(1)
    }
  }

  // task 7: mutation check. The actual mutation transcripts (evidence/task-7-mutation-check-*)
  // were produced by neutralising the CALL SITE — `SqlConnectorDriver.connect`'s
  // `checkConfigEgress(...)` match was temporarily replaced with a hardcoded `Right(())` — not
  // the policy source (`ContentSourceSupport.isBlockedAddress`). That distinction matters: this
  // repo's `isBlockedAddress` is shared with the REST egress guard and its own denylist unit
  // tests, so neutralising IT would have reddened many more tests than the one this ticket's
  // guard is responsible for. Neutralising `connect`'s call site instead is scoped to exactly
  // the SQL guard this ticket adds, and the transcript shows precisely one test going red — the
  // "be REFUSED by the connect-time guard" test above — on the refusal assertion itself
  // (`Right(List(...))` returned instead of the expected `Left`), not a timeout, missing driver,
  // or fixture error. The assertion below demonstrates the same INVERSE at the
  // `checkConfigEgress` level (no source file edited): with `isBlocked` neutralised via the
  // function's own parameter, the loopback host resolves to Allowed instead of refused.
  "the mutation check (task 7)" should {
    "prove a neutralised isBlocked makes the loopback host Allowed instead of refused — the exact inverse of the refusal assertion above" in {
      val cfg    = loopbackConfig()
      val result = SqlConnectorDriver.checkConfigEgress(cfg, isBlocked = (_, _) => false)
      result shouldBe a[Right[_, _]]
    }
  }
}
