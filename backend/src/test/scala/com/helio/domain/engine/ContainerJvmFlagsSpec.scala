package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Paths}
import scala.jdk.CollectionConverters._

/** HEL-1660 (owner ruling 7, AC7): the production container JVM exits on OutOfMemoryError so a damaged instance restarts instead of
 *  carrying on. The flag lives only in the `Dockerfile` ENTRYPOINT, so this reads it from there. */
class ContainerJvmFlagsSpec extends AnyWordSpec with Matchers {

  // sbt forks the test JVM in `backend/`; the Dockerfile sits at the repository root.
  private val entrypoint: Vector[String] =
    Files.readAllLines(Paths.get("..", "Dockerfile")).asScala.toVector.dropWhile(!_.startsWith("ENTRYPOINT"))

  "the Dockerfile ENTRYPOINT" should {
    "pass -XX:+ExitOnOutOfMemoryError to the JVM" in {
      entrypoint should not be empty
      entrypoint.exists(_.contains("\"-XX:+ExitOnOutOfMemoryError\"")) shouldBe true
    }

    "keep the heap sizing the 192 MB run budget was measured against (75% of the 1 GiB container)" in {
      entrypoint.exists(_.contains("\"-XX:MaxRAMPercentage=75.0\"")) shouldBe true
    }
  }
}
