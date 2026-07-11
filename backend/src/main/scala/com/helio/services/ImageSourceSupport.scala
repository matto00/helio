package com.helio.services

import javax.imageio.ImageIO
import java.io.{ByteArrayInputStream, IOException}

/** Image-specific helpers used by `DataSourceService`'s image connector
 *  (HEL-216). Mirrors `DataSourceCsvSupport`'s per-connector-helper
 *  precedent — lightweight, no Pekko / repository dependencies, so it can be
 *  unit-tested in isolation. */
object ImageSourceSupport {

  /** Extension-driven MIME type map (not `Content-Type`-header sniffing) —
   *  same approach as `ContentSourceSupport.validateExtension`, consistent
   *  with `TextSource`'s upload path, which also trusts the filename over
   *  headers. Keyed on the lower-cased, dot-free extension. */
  private val mimeTypeByExtension: Map[String, String] = Map(
    "png"  -> "image/png",
    "jpg"  -> "image/jpeg",
    "jpeg" -> "image/jpeg",
    "gif"  -> "image/gif",
    "webp" -> "image/webp",
    "bmp"  -> "image/bmp"
  )

  /** Read width/height via `javax.imageio.ImageIO.read` (JDK-standard, no new
   *  dependency) and derive the MIME type from the (already-validated)
   *  extension. Returns `Left` with a descriptive message when `ImageIO.read`
   *  either returns `null` or throws. A `null` result is `ImageIO`'s
   *  documented signal for "no registered reader could decode this stream"
   *  (e.g. total-garbage bytes with no recognizable magic number). But when a
   *  reader *is* found (a valid header) and the pixel data itself is
   *  truncated or corrupt — the realistic failure mode for an
   *  interrupted upload or a partially-fetched URL — `ImageIO.read` instead
   *  *throws* `javax.imageio.IIOException` (a `java.io.IOException`
   *  subclass), so both cases must be handled to reach the same graceful
   *  `Left`. Mirrors `PdfTextSupport.validate`'s try/catch structure for the
   *  equivalent PDFBox `IOException` failure mode. `filename`'s extension is
   *  assumed to already be validated (via
   *  `ContentSourceSupport.validateExtension`) by the caller — an extension
   *  outside `mimeTypeByExtension`'s keys is treated as a defensive `Left`
   *  rather than throwing. */
  def dimensionsAndMime(bytes: Array[Byte], filename: String): Either[String, (Int, Int, String)] = {
    val ext = filename.lastIndexOf('.') match {
      case -1 => ""
      case i  => filename.substring(i + 1).toLowerCase
    }
    val corruptMessage =
      s"Unable to read image dimensions from '$filename': the file is corrupt or the image codec is unsupported"
    mimeTypeByExtension.get(ext) match {
      case None =>
        Left(s"Unsupported image extension: '.$ext'")
      case Some(mimeType) =>
        try {
          Option(ImageIO.read(new ByteArrayInputStream(bytes))) match {
            case None =>
              Left(corruptMessage)
            case Some(image) =>
              Right((image.getWidth, image.getHeight, mimeType))
          }
        } catch {
          case _: IOException =>
            Left(corruptMessage)
        }
    }
  }
}
