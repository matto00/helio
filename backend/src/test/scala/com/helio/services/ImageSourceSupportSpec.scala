package com.helio.services

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import javax.imageio.ImageIO

class ImageSourceSupportSpec extends AnyWordSpec with Matchers {

  /** Encode a real in-memory image via `ImageIO` (JDK-standard) so tests
   *  exercise the actual decode path rather than embedding raw fixture
   *  bytes. */
  private def encode(width: Int, height: Int, format: String): Array[Byte] = {
    val image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    val out    = new ByteArrayOutputStream()
    ImageIO.write(image, format, out)
    out.toByteArray
  }

  "ImageSourceSupport.dimensionsAndMime" should {

    "read width/height/mimeType for a valid PNG" in {
      val bytes  = encode(4, 3, "png")
      val result = ImageSourceSupport.dimensionsAndMime(bytes, "photo.png")
      result shouldBe Right((4, 3, "image/png"))
    }

    "read width/height/mimeType for a valid JPEG (.jpg extension)" in {
      val bytes  = encode(8, 6, "jpg")
      val result = ImageSourceSupport.dimensionsAndMime(bytes, "photo.jpg")
      result shouldBe Right((8, 6, "image/jpeg"))
    }

    "read width/height/mimeType for a valid JPEG (.jpeg extension)" in {
      val bytes  = encode(8, 6, "jpg")
      val result = ImageSourceSupport.dimensionsAndMime(bytes, "photo.jpeg")
      result shouldBe Right((8, 6, "image/jpeg"))
    }

    "derive the correct MIME type per supported extension" in {
      val bytes = encode(2, 2, "png")
      ImageSourceSupport.dimensionsAndMime(bytes, "x.png").map(_._3) shouldBe Right("image/png")
    }

    "return Left for corrupt/unreadable bytes with a supported extension" in {
      val bytes  = Array[Byte](0x00, 0x01, 0x02, 0x03)
      val result = ImageSourceSupport.dimensionsAndMime(bytes, "broken.png")
      result match {
        case Left(msg) => msg should include("Unable to read image dimensions")
        case other     => fail(s"Expected Left, got: $other")
      }
    }

    "return Left for a truncated-but-header-valid PNG (ImageIO.read throws rather than returning null)" in {
      // Unlike total-garbage bytes above (no recognizable magic number, so
      // ImageIO.read returns null), a real PNG with its trailing bytes cut
      // off still has a recognizable header/magic number, so a reader *is*
      // found — but decoding the (now-incomplete) pixel data throws
      // javax.imageio.IIOException rather than returning null. This is the
      // realistic interrupted-upload/partial-fetch failure mode.
      val full       = encode(16, 16, "png")
      val truncated  = full.dropRight(30)
      val result     = ImageSourceSupport.dimensionsAndMime(truncated, "broken.png")
      result match {
        case Left(msg) => msg should include("Unable to read image dimensions")
        case other     => fail(s"Expected Left, got: $other")
      }
    }

    "return Left for an unsupported extension" in {
      val bytes  = encode(2, 2, "png")
      val result = ImageSourceSupport.dimensionsAndMime(bytes, "x.tiff")
      result match {
        case Left(msg) => msg should include("Unsupported image extension")
        case other     => fail(s"Expected Left, got: $other")
      }
    }
  }
}
