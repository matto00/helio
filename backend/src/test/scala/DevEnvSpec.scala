import java.io.File
import java.security.MessageDigest

import org.scalatest.funsuite.AnyFunSuite

/** HEL-1450: pins which `backend/.env` keys reach forked test JVMs and the dev server.
  *
  * Default package on purpose: `DevEnv` (backend/project/DevEnv.scala) is a default-package object compiled into
  * the test sources, and a packaged spec cannot see a default-package object. Assertions are by KEY NAME and
  * SHA-256 only; no failure message ever formats a value or a whole env map.
  */
class DevEnvSpec extends AnyFunSuite {

  /** Never `assert(cond, clue)`: ScalaTest's macro renders the operands (whole env maps) into the failure. */
  private def check(cond: Boolean, msg: => String): Unit = if (!cond) fail(msg)

  private def sha256(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8")).map("%02x".format(_)).mkString

  private lazy val fixture: Map[String, String] =
    DevEnv.parseDotEnv(new File("src/test/resources/devenv/fixture.env")) // forked test JVM cwd is backend/

  test("fixture carries every denylisted key and the connector key (precondition)") {
    val missing = (DevEnv.deniedTestKeys ++ DevEnv.testEnvKeys) -- fixture.keySet
    check(missing.isEmpty, s"fixture is missing keys: ${missing.toSeq.sorted.mkString(", ")}")
  }

  test("test env carries none of the denylisted keys") {
    val leaked = DevEnv.testEnvFor(fixture).keySet.intersect(DevEnv.deniedTestKeys)
    check(leaked.isEmpty, s"test env leaks keys: ${leaked.toSeq.sorted.mkString(", ")}")
  }

  test("test env keys are exactly the fixed test-only set") {
    val keys = DevEnv.testEnvFor(fixture).keySet
    val unexpected = keys -- DevEnv.testEnvKeys
    val missing = DevEnv.testEnvKeys -- keys
    check(
      unexpected.isEmpty && missing.isEmpty,
      s"unexpected keys: ${unexpected.toSeq.sorted.mkString(", ")}; missing keys: ${missing.toSeq.sorted.mkString(", ")}"
    )
  }

  test("test env connector key is the committed test value, not the .env value (by hash)") {
    val actual = DevEnv.testEnvFor(fixture).get("CONNECTOR_MASTER_KEY").map(sha256(_))
    check(actual.isDefined, "test env has no CONNECTOR_MASTER_KEY")
    check(
      fixture.get("CONNECTOR_MASTER_KEY").map(sha256(_)) != actual,
      "test env CONNECTOR_MASTER_KEY hash equals the .env value's hash"
    )
    check(
      actual == DevEnv.testEnv.get("CONNECTOR_MASTER_KEY").map(sha256(_)),
      "test env CONNECTOR_MASTER_KEY hash differs from the fixed test value's hash"
    )
  }

  test("test env is identical whether or not a .env exists") {
    check(DevEnv.testEnvFor(fixture) == DevEnv.testEnvFor(Map.empty), "test env differs with vs without a .env")
  }

  test("run env excludes never-forward keys and keeps others") {
    val run = DevEnv.runEnv(fixture, Map.empty)
    check(!run.contains("GCLOUD_DB_PASSWORD"), "run env contains GCLOUD_DB_PASSWORD")
    check(run.contains("GOOGLE_CLIENT_ID"), "run env lacks GOOGLE_CLIENT_ID")
  }

  test("run env does not override a key present in the process env") {
    val run = DevEnv.runEnv(fixture, Map("HELIO_OWNER_EMAILS" -> "shell-value"))
    check(!run.contains("HELIO_OWNER_EMAILS"), "run env sets HELIO_OWNER_EMAILS despite the process env having it")
    check(run.contains("GOOGLE_CLIENT_ID"), "run env lacks GOOGLE_CLIENT_ID")
  }
}
