package com.helio.testkit

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import scala.jdk.CollectionConverters._

/** HEL-1228 guard: every spec obtains Pekko's route testkit through [[HelioRouteTest]] so it
 *  inherits the shared, explicit `RouteTestTimeout`. A direct `ScalatestRouteTest`/`RouteTest`
 *  mixin silently falls back to the testkit's 1-second default, so this scan fails the suite and
 *  names the offending file. A match inside a comment is a false positive accepted on purpose
 *  (fail closed). The test JVM's working directory is `backend/` (see `build.sbt`). */
class RouteTestBaseGuardSpec extends AnyWordSpec with Matchers {

  private val scanRoot: Path   = Paths.get("src", "test", "scala")
  private val baseTraitFile    = "HelioRouteTest.scala"
  private val directMixin      = """\b(?:with|extends|new)\s+(?:ScalatestRouteTest|RouteTest)\b""".r

  private def scalaSources: Vector[Path] = {
    val stream = Files.walk(scanRoot)
    try stream.iterator().asScala.filter(p => Files.isRegularFile(p) && p.toString.endsWith(".scala")).toVector
    finally stream.close()
  }

  private def read(p: Path): String = new String(Files.readAllBytes(p), StandardCharsets.UTF_8)

  private def offenders(files: Vector[Path]): Vector[String] =
    files.filterNot(_.getFileName.toString == baseTraitFile).filter(p => directMixin.findFirstIn(read(p)).isDefined).map(_.toString).sorted

  "RouteTestBaseGuardSpec" should {

    "scan a real, non-trivial source tree (non-vacuity)" in {
      Files.isDirectory(scanRoot) shouldBe true
      scalaSources.size should be > 100
    }

    "find the base trait itself and match the direct-mixin pattern in it" in {
      val base = scalaSources.filter(_.getFileName.toString == baseTraitFile)
      base should have size 1
      directMixin.findFirstIn(read(base.head)).isDefined shouldBe true
    }

    "match every direct-mixin spelling it must reject" in {
      // Spelled by concatenation so this file does not itself match the pattern it enforces.
      val kit = "Scalatest" + "RouteTest"
      Seq(s"class A extends AnyWordSpec with $kit", s"trait B extends $kit", "trait C extends Route" + "Test", s"val x = new $kit {}")
        .foreach(s => directMixin.findFirstIn(s).isDefined shouldBe true)
      Seq("class A extends AnyWordSpec with HelioRouteTest", "import org.apache.pekko.http.scaladsl.testkit.RouteTestTimeout")
        .foreach(s => directMixin.findFirstIn(s).isDefined shouldBe false)
    }

    "have no test source that mixes in the route testkit directly instead of HelioRouteTest" in {
      val bad = offenders(scalaSources)
      withClue(s"These specs mix in ScalatestRouteTest/RouteTest directly; use com.helio.testkit.HelioRouteTest:\n${bad.mkString("\n")}\n") {
        bad shouldBe empty
      }
    }
  }
}
