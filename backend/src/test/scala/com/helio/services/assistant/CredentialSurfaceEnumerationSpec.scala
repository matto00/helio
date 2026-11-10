package com.helio.services.assistant

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import scala.jdk.CollectionConverters._
import scala.io.Source

/** HEL-829 tasks.md 3.5 (design.md Decision 4c) — the AC's "enumerate every surface, verify each
 *  — in both directions" requirement, direction 1 (does anything already send a credential toward
 *  the model). A token-grep change-detector over the two agent-facing Scala package roots plus
 *  `helio-mcp/src/`, pinned against fresh `grep -rniIl "credential"` output at the time this spec
 *  was written (round 2 CR-1/2/3 corrections — `services/ai` does not exist, the real path is
 *  `com.helio.infrastructure.ai`; both Scala roots currently match ZERO files).
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
      val content = Source.fromFile(file, "UTF-8")
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

  "the agent-facing Scala surfaces (com.helio.infrastructure.ai, com.helio.services.assistant)" should {
    "currently match ZERO files for the token 'credential'" in {
      filesContainingToken(new File(root, "backend/src/main/scala/com/helio/infrastructure/ai"), "credential") shouldBe empty
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
      "helio-mcp/src/tools/credentialDenylist.ts"          -> "defines rejectCredentialField itself, whose refine asserts the parsed value === undefined before any downstream use -- a supplied value fails the parse and never survives to reach a caller or an HTTP call",
      "helio-mcp/src/tools/connectorSchema.ts"             -> "rejects all five credential-shaped keys plus any other unrecognized key via .strict() -- no credential-shaped input can parse successfully at all, so nothing is ever forwarded to the handler",
      "helio-mcp/src/tools/connectorSchema.test.ts"        -> "asserts, for each denylisted field, both that the parse fails AND that the bait string 'sk-should-never-be-accepted' never appears anywhere in the resulting Zod issues -- proving the value is never echoed, not just that the key is rejected",
      "helio-mcp/src/tools/connectorHandlers.ts"           -> "refuses any authType other than \"none\" BEFORE api.createConnector is ever called, and that call itself carries no user-suppliable credential parameter -- every 'credential' occurrence here is refusal/pointer prose, never a value in transit",
      "helio-mcp/src/helioApi.createConnector.test.ts"     -> "asserts the actual POST body carries a hardcoded credential: \"\" and no other credential-shaped key, by inspecting the wire payload directly rather than trusting the method's type signature",
      "helio-mcp/src/server.test.ts"                       -> "only enumerates the five credential-shaped PARAMETER NAMES the tool's advertised schema must still expose as always-rejecting properties -- asserts on property presence, never a secret value",
      // HEL-955: `createConnectorHandler` no longer refuses authType !== "none" outright -- it
      // mints a PENDING Connector (no credential passes through the call). This test asserts on
      // that pending-creation path and its `note`/`isError` prose, and on the SAME zero-HTTP-call
      // proof the pre-existing entries above assert (`calls`/`pendingCalls` inspection) -- every
      // "credential" occurrence here is prose (variable/test names, description text), never a
      // secret value in transit.
      "helio-mcp/src/tools/connectorHandlers.test.ts"      -> "asserts the pending-creation path makes zero calls to api.createConnector and that api.createPendingConnector's input carries no credential-shaped field -- 'credential' occurrences are prose/test-description only",
      // HEL-1709: the remote-connector HTTP entry (OAuth sign-in) legitimately handles Personal Access
      // Tokens. None of these five carries a credential VALUE: the matches are the CORS "credentials"
      // option/header name and prose in error and comment text. Secrets themselves (PATs, the sealing
      // key) are neither literals here nor ever logged (task 6.3 greps the diff and run logs).
      "helio-mcp/src/httpConfig.ts"                        -> "config validation message 'no path, query, fragment or credentials' for an origin URL -- prose in an error string; no credential value is read, held or logged (the sealing key is validated by length and never echoed)",
      "helio-mcp/src/oauth/patCheck.ts"                    -> "doc comment on the PatStatus 'refused' case ('not a usable connector credential'); the function sends the PAT only as the Authorization header of one GET /api/tokens and returns a status enum, never the token or a response body",
      "helio-mcp/src/oauth/routes.ts"                      -> "the CORS option 'credentials: false' on /oauth/pending (browsers may not send cookies), its doc comment, and three user-facing error-page sentences ('the credential supplied was not valid'); the PAT arrives in the POST body, is checked and sealed into a code, and is never placed in a URL or log",
      "helio-mcp/src/oauth/oauthFlow.test.ts"              -> "asserts the response header access-control-allow-credentials is ABSENT on /oauth/pending (no credentialed CORS); the test PATs are inert fixture literals",
      "helio-mcp/src/testing/httpHarness.ts"               -> "doc comment stating 'nothing here is a real credential' -- keys are generated per run and the PATs are inert stub literals for a local stub backend"
    )

    "match exactly the nineteen allow-listed files, each for its documented reason" in {
      val actual = filesContainingToken(new File(root, "helio-mcp/src"), "credential").toSet
      actual shouldBe allowedMatches.keySet

      // Every allow-list entry carries a non-empty justification — a bare filename with no
      // reason would defeat the point of an explicit allow-list.
      allowedMatches.values.foreach(_.trim should not be empty)
    }
  }
}
