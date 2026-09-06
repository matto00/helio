package com.helio.services.sources

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File

/** HEL-845 — the kind-mismatch guard in `SourceService.createRestWithConfig` is only a real
 *  guarantee if that is the ONLY create-time site that constructs a `RestSource`. A second
 *  create-time construction site added anywhere in `backend/src/main` would be a second,
 *  unguarded door onto the same class, silently reintroducing the mismatch this ticket closes.
 *
 *  This is a source-text scan of `backend/src/main`, not a structural or bytecode check — stated
 *  plainly here rather than dressed up as more rigorous than a text scan actually is.
 *
 *  Phrased precisely as "exactly one CREATE-TIME construction site", never "exactly one
 *  construction site": `DataSourceRepository.rowToDomain` also constructs a `RestSource`, but it
 *  rehydrates a row that was already validated at create time -- a read path, not a second,
 *  unguarded write path. That read path is not left unguarded either: a row that reached the
 *  database in a mismatched state is still caught, on every use, by the fetch-time checkpoint in
 *  `RestApiConnectorDriver.resolveConnector` (design.md Decision 2b / AC 5) -- that checkpoint is
 *  what actually satisfies AC 5 for such a row, not the absence of a second constructor. See
 *  `openspec/specs/rest-api-connector/spec.md`, "RestSource has exactly one create-time
 *  construction site", for the full rationale.
 *
 *  `DataSourceRepository.rowToDomain` is excluded from the count BY NAME (the specific file+line
 *  pattern it matches today), never by a path or package prefix -- a prefix exclusion would also
 *  swallow a future create-time site added anywhere else in the persistence package, which is
 *  precisely the silent erosion this test exists to catch. */
class RestSourceConstructionSiteSpec extends AnyWordSpec with Matchers {

  /** Mirrors `CredentialSurfaceEnumerationSpec.repoRoot` -- robust to whether sbt forks tests
   *  with cwd `backend/` (the normal case) or the repo root itself. */
  private def repoRoot(): File = {
    def search(dir: File, depthRemaining: Int): File =
      if (new File(dir, "backend/src/main").isDirectory) dir
      else if (depthRemaining <= 0 || dir.getParentFile == null)
        fail(s"could not locate backend/src/main searching upward from ${new File(".").getCanonicalPath}")
      else search(dir.getParentFile, depthRemaining - 1)
    search(new File(".").getCanonicalFile, 5)
  }

  private val mainRoot = new File(repoRoot(), "backend/src/main")

  private def listScalaFilesRecursively(dir: File): Vector[File] =
    if (!dir.exists()) Vector.empty
    else {
      val entries = Option(dir.listFiles()).map(_.toVector).getOrElse(Vector.empty)
      entries.flatMap { f =>
        if (f.isDirectory) listScalaFilesRecursively(f)
        else if (f.getName.endsWith(".scala")) Vector(f)
        else Vector.empty
      }
    }

  /** A construction-call site: the literal token `RestSource(` immediately preceded by a
   *  non-identifier character (so `resolveRestSource(` -- `PipelineProposalService.scala`'s only
   *  match -- does NOT count; matching on a raw substring would wrongly count it, exactly the
   *  wrong-place match this test's evidence run confirmed a naive matcher produces) and NOT
   *  preceded (on the same logical declaration) by `case class` / `final case class` (the type
   *  definition in `DataSource.scala`, not a construction call). Line-comment text (anything
   *  after `//` on its line) is stripped before matching, so a comment mentioning `RestSource(`
   *  is never counted -- verified concretely by this spec's own case below, not merely assumed. */
  private val constructionCallPattern = "(?<![A-Za-z0-9_])RestSource\\(".r

  private def stripLineComments(line: String): String = {
    // Deliberately naive (no string-literal awareness) -- adequate for this repo's actual
    // source, and this test says so rather than claiming a real Scala tokenizer's rigor.
    val idx = line.indexOf("//")
    if (idx >= 0) line.substring(0, idx) else line
  }

  private case class Site(file: String, line: Int, text: String)

  private def findConstructionSites(): Vector[Site] =
    listScalaFilesRecursively(mainRoot).flatMap { f =>
      val relativePath = f.getAbsolutePath.stripPrefix(repoRoot().getAbsolutePath + File.separator)
      val lines        = scala.io.Source.fromFile(f, "UTF-8").getLines().toVector
      lines.zipWithIndex.flatMap { case (rawLine, idx) =>
        val line = stripLineComments(rawLine)
        if (constructionCallPattern.findFirstIn(line).isDefined && !line.contains("case class RestSource"))
          Vector(Site(relativePath, idx + 1, rawLine.trim))
        else Vector.empty
      }
    }

  /** Named exclusion (design.md / spec rationale above) -- the ONLY site this test allows besides
   *  `SourceService.createRestWithConfig`'s own create-time call. Matched by file path AND the
   *  exact source line, not by directory/package prefix. */
  private val excludedRehydrationSite = Site(
    file = "backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala",
    line = 60,
    text = "RestSource(id, row.name, ownerId, row.createdAt, row.updatedAt, cfg, row.tag, row.inferredSchema)"
  )

  "RestSource construction sites in backend/src/main" should {

    "consist of exactly one create-time construction site (SourceService.createRestWithConfig), " +
      "plus the named, excluded DataSourceRepository.rowToDomain rehydration site" in {
        val sites            = findConstructionSites()
        val nonExcludedSites = sites.filterNot(s => s.file == excludedRehydrationSite.file && s.line == excludedRehydrationSite.line)

        withClue(
          s"expected exactly one create-time construction site; found ${nonExcludedSites.size}: " +
            nonExcludedSites.map(s => s"${s.file}:${s.line}: ${s.text}").mkString("\n  ", "\n  ", "")
        ) {
          nonExcludedSites.size shouldBe 1
        }
        nonExcludedSites.head.file shouldBe "backend/src/main/scala/com/helio/services/sources/SourceService.scala"

        // The named exclusion is present exactly where expected -- if `rowToDomain`'s
        // construction ever moves or changes, this assertion (not a silent prefix match) is what
        // notices and forces the exclusion to be re-examined rather than quietly widening.
        sites should contain(excludedRehydrationSite)
      }

    "does not count a comment mentioning RestSource( toward the total (verified concretely, not assumed)" in {
      // A same-shaped probe over a throwaway in-memory line, exercising the exact
      // stripLineComments + constructionCallPattern pipeline this spec's real scan uses --
      // confirms the comment-stripping is real, not merely assumed to work.
      val commentOnlyLine = "        // RestSource(bogus, extra, args) -- not a real construction site"
      val stripped        = stripLineComments(commentOnlyLine)
      constructionCallPattern.findFirstIn(stripped) shouldBe None
    }

    "does not count resolveRestSource( as a match (the false-positive substring this test's evidence run found)" in {
      val line = "  private def resolveRestSource(source: PipelineProposalSource, address: String, user: AuthenticatedUser) ="
      constructionCallPattern.findFirstIn(line) shouldBe None
    }
  }
}
