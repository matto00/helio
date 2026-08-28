package com.helio.services.assistant

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import scala.jdk.CollectionConverters._

/** HEL-829 tasks.md 3.5 (design.md Decision 4c) — the AC's "enumerate every surface, verify each
 *  — in both directions" requirement, direction 1 (does anything already send a credential toward
 *  the model). A token-grep change-detector over the two agent-facing Scala package roots plus
 *  `helio-mcp/src/`, pinned against fresh `grep -rniIl "credential"` output at the time this spec
 *  was written (round 2 CR-1/2/3 corrections — `services/ai` does not exist, the real path is
 *  `com.helio.ai`; both Scala roots currently match ZERO files).
 *
 *  Deliberately a real filesystem walk, not a hardcoded list of "files that exist today" alone —
 *  a NEW file added to either Scala root that mentions "credential" fails this spec immediately,
 *  and a NEW/removed match under `helio-mcp/src/` fails the allow-list assertion, forcing a human
 *  to either update the allow-list with a justification or fix the actual leak. */
class CredentialSurfaceEnumerationSpec extends AnyWordSpec with Matchers {

  /** Locates the repo root by walking upward from the test JVM's cwd until a directory contains
   *  `helio-mcp/src` — robust to whether sbt forks tests with cwd `backend/` (the normal case) or
   *  the repo root itself, mirroring `JsonSchemaValidation.schemaFile`'s own upward-search
   *  precedent. */
  private def repoRoot(): File = {
    def search(dir: File, depthRemaining: Int): File =
      if (new File(dir, "helio-mcp/src").isDirectory) dir
      else if (depthRemaining <= 0 || dir.getParentFile == null)
        fail(s"could not locate helio-mcp/src searching upward from ${new File(".").getCanonicalPath}")
      else search(dir.getParentFile, depthRemaining - 1)
    search(new File(".").getCanonicalFile, 5)
  }

  private val root = repoRoot()

  private def listFilesRecursively(dir: File): Vector[File] =
    if (!dir.exists()) Vector.empty
    else {
      val entries = Option(dir.listFiles()).map(_.toVector).getOrElse(Vector.empty)
      entries.flatMap { f =>
        if (f.isDirectory) listFilesRecursively(f) else Vector(f)
      }
    }

  private def matchesToken(file: File, token: String): Boolean =
    try {
      val content = scala.io.Source.fromFile(file, "UTF-8")
      try content.mkString.toLowerCase.contains(token.toLowerCase)
      finally content.close()
    } catch {
      case _: Exception => false // binary/unreadable file — never a text match
    }

  private def filesContainingToken(dir: File, token: String): Vector[String] =
    listFilesRecursively(dir)
      .filter(matchesToken(_, token))
      .map(f => f.getAbsolutePath.stripPrefix(root.getAbsolutePath + File.separator))
      .sorted

  "the agent-facing Scala surfaces (com.helio.ai, com.helio.services.assistant)" should {
    "currently match ZERO files for the token 'credential'" in {
      filesContainingToken(new File(root, "backend/src/main/scala/com/helio/ai"), "credential") shouldBe empty
      filesContainingToken(new File(root, "backend/src/main/scala/com/helio/services/assistant"), "credential") shouldBe empty
    }
  }

  "helio-mcp/src" should {
    // Pinned to fresh `grep -rniIl "credential" helio-mcp/src/` output — each entry justified by
    // WHY it's safe (it rejects/type-references, never carries, a credential), not a blanket pass.
    val allowedMatches: Map[String, String] = Map(
      "helio-mcp/src/types.ts"                             -> "type-references ConnectorSummary, which has no credential-capable field",
      "helio-mcp/src/helioApi.ts"                          -> "type-references ConnectorSummary, which has no credential-capable field",
      "helio-mcp/src/context.ts"                           -> "type-references ConnectorSummary, which has no credential-capable field",
      "helio-mcp/src/tools/read.ts"                        -> "references the rejectCredentialField guard",
      "helio-mcp/src/tools/write.ts"                       -> "references the rejectCredentialField guard",
      "helio-mcp/src/tools/restDataSourceSchema.ts"        -> "implements the rejectCredentialField guard (rejects, never carries)",
      "helio-mcp/src/tools/restDataSourceSchema.test.ts"   -> "tests the rejectCredentialField guard's rejection case",
    )

    "match exactly the seven allow-listed files, each for its documented reason" in {
      val actual = filesContainingToken(new File(root, "helio-mcp/src"), "credential").toSet
      actual shouldBe allowedMatches.keySet

      // Every allow-list entry carries a non-empty justification — a bare filename with no
      // reason would defeat the point of an explicit allow-list.
      allowedMatches.values.foreach(_.trim should not be empty)
    }
  }
}
