import java.io.File
import scala.io.Source

/** HEL-1450: which environment variables the local build forwards into forked JVMs.
  *
  * Pure and sbt-free (only java.io/scala.io), in the Scala 2.13 / Scala 3 common subset, DEFAULT package:
  * `build.sbt` (Scala 3) references it unqualified, and `backend/src/test/scala/DevEnvSpec.scala` (also default
  * package) compiles this same file into the test sources, so the spec exercises exactly the code the build runs.
  *
  * NEVER format an env map into a message: report KEY NAMES only.
  */
object DevEnv {

  /** Every non-comment KEY=VALUE line of an env file; empty when the file is absent. */
  def parseDotEnv(file: File): Map[String, String] =
    if (!file.exists()) Map.empty
    else {
      val src = Source.fromFile(file, "UTF-8")
      try
        src
          .getLines()
          .map(_.trim)
          .filter(line => line.nonEmpty && !line.startsWith("#"))
          .flatMap { line =>
            line.split("=", 2) match {
              case Array(key, value) if key.trim.nonEmpty => Some(key.trim -> value.trim)
              case _                                      => None
            }
          }
          .toMap
      finally src.close()
    }

  /** Keys the dev server never receives from `.env` (read by no code in the repo). */
  val neverForwardKeys: Set[String] = Set("GCLOUD_DB_PASSWORD")

  /** Keys that must never reach a forked test JVM from `backend/.env`. */
  val deniedTestKeys: Set[String] = Set(
    "GCLOUD_DB_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_REDIRECT_URI",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "HELIO_OWNER_EMAILS",
    "DB_PASSWORD"
  )

  /** The fixed key set of the test environment. */
  val testEnvKeys: Set[String] = Set("CONNECTOR_MASTER_KEY", "CONNECTOR_MASTER_KEY_ID")

  /** The fixed, committed, test-only connector values: the SAME public values `.github/workflows/ci.yml`'s
    * `backend` job sets (keep the two in sync; both are public test-only values, not secrets).
    */
  val testEnv: Map[String, String] = Map(
    "CONNECTOR_MASTER_KEY" -> "Npxr5hOsyxOtPW4HWFBYHmWKcbPDP+ss+3x1fAdNaP0=",
    "CONNECTOR_MASTER_KEY_ID" -> "ci-test-2026-08"
  )

  /** Test environment for the given parsed `.env`. Always the fixed [[testEnv]]: no `.env` key or value reaches tests (CI has no `.env` and passes). */
  def testEnvFor(dotEnv: Map[String, String]): Map[String, String] = testEnv

  /** The environment the dev server (`sbt run`) receives, given the parsed `.env` and the sbt process env:
    * `.env` minus the never-forward keys, never overriding a key the process env already has (shell wins). */
  def runEnv(dotEnv: Map[String, String], processEnv: Map[String, String]): Map[String, String] =
    dotEnv.filter { case (k, _) => !neverForwardKeys.contains(k) && !processEnv.contains(k) }

  /** Key-name-only description of how a computed test env differs from [[testEnv]]; empty when identical. */
  def testEnvMismatch(actual: Map[String, String]): Option[String] = {
    val unexpected = (actual.keySet -- testEnv.keySet).toSeq.sorted
    val missing = (testEnv.keySet -- actual.keySet).toSeq.sorted
    val differing = testEnv.keySet.intersect(actual.keySet).filter(k => actual(k) != testEnv(k)).toSeq.sorted
    if (unexpected.isEmpty && missing.isEmpty && differing.isEmpty) None
    else
      Some(
        s"Test / envVars must equal DevEnv.testEnv (HEL-1450). unexpected keys: ${unexpected.mkString(", ")}; " +
          s"missing keys: ${missing.mkString(", ")}; keys whose value differs: ${differing.mkString(", ")}"
      )
  }
}
