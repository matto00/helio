package com.helio.spark

import java.io.{ByteArrayInputStream, ByteArrayOutputStream}

import net.jpountz.lz4.LZ4Factory
import org.apache.commons.io.IOUtils
import org.apache.spark.SparkConf
import org.apache.spark.io.LZ4CompressionCodec
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1367: proves Spark's default LZ4 codec round-trips on the pinned at.yawk.lz4 jar. */
class Lz4CodecSpec extends AnyWordSpec with Matchers {

  private val JarVersion = """lz4-java-(\d+)\.(\d+)\.(\d+)\.jar""".r

  "Spark's LZ4CompressionCodec" should {

    "round-trip bytes through the lz4-java on the classpath" in {
      val codec   = new LZ4CompressionCodec(new SparkConf(false))
      val payload = Array.tabulate[Byte](200000)(i => (i % 251).toByte)

      val sink = new ByteArrayOutputStream()
      val out  = codec.compressedOutputStream(sink)
      out.write(payload)
      out.close()

      val in = codec.compressedInputStream(new ByteArrayInputStream(sink.toByteArray))
      try IOUtils.toByteArray(in) shouldBe payload
      finally in.close()
      sink.size() should be < payload.length
    }

    "run on at.yawk.lz4 lz4-java >= 1.11.4 (GHSA-mcr4-qmvw-px4g fix)" in {
      val location = classOf[LZ4Factory].getProtectionDomain.getCodeSource.getLocation.getPath
      val file     = location.substring(location.lastIndexOf('/') + 1)
      file match {
        case JarVersion(major, minor, patch) =>
          val version = (major.toInt, minor.toInt, patch.toInt)
          withClue(s"resolved lz4-java jar: $location") {
            Ordering[(Int, Int, Int)].gteq(version, (1, 11, 4)) shouldBe true
          }
        case other => fail(s"unrecognised lz4-java jar name: $other (from $location)")
      }
      location should include("/at/yawk/lz4/")
    }
  }
}
