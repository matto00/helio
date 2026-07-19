package com.helio.services

import org.apache.pdfbox.Loader
import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException
import org.apache.pdfbox.text.PDFTextStripper
import org.apache.pdfbox.text.TextPosition
import org.slf4j.LoggerFactory

import java.io.IOException
import java.util.{List => JList}
import scala.collection.mutable.ArrayBuffer
import scala.util.Try

/** PDF-specific text extraction support (HEL-214) — deliberately a standalone
 *  object, not folded into [[ContentSourceSupport]]: mirrors HEL-215's
 *  precedent that per-connector `loadRows` extraction logic stays
 *  per-connector rather than generalized across content kinds (see
 *  `InProcessPipelineEngine`'s "Text loader" comment). Built on Apache PDFBox
 *  (`org.apache.pdfbox:pdfbox:3.0.3` — mature, Apache-2.0-licensed, pure-JVM;
 *  see design.md's "Dependency" decision for the full rationale over iText /
 *  shelling out to `pdftotext`). */
object PdfTextSupport {

  private val log = LoggerFactory.getLogger(getClass)

  /** Ingest-time validation: opens the document once via `Loader.loadPDF`,
   *  always closes it, and returns the page count on success. Deliberately
   *  does *not* perform a text walk — that's `extractPages`'s job, deferred
   *  to pipeline-run time (see design.md's "Extraction deferred to
   *  pipeline-run time" decision, which mirrors CSV/Text's ingest-time-only
   *  decode validation). Returns `Left` with a descriptive message for
   *  password-protected PDFs (`InvalidPasswordException`) or corrupt/
   *  non-PDF bytes (`IOException`), so the service layer can map either to a
   *  400 rather than deferring to a confusing failure on the first pipeline
   *  run. */
  def validate(bytes: Array[Byte]): Either[String, Int] = {
    var document: PDDocument = null
    try {
      document = Loader.loadPDF(bytes)
      Right(document.getNumberOfPages)
    } catch {
      case _: InvalidPasswordException =>
        Left("PDF is password-protected; encrypted PDFs are not supported")
      case e: IOException =>
        // HEL-311: keep the curated "File is not a valid PDF" category
        // message, drop the raw parser-exception tail; log the cause.
        log.warn("File is not a valid PDF", e)
        Left("File is not a valid PDF")
    } finally {
      if (document != null) document.close()
    }
  }

  /** Single-pass per-page text extraction. Subclasses `PDFTextStripper` and
   *  accumulates each page's text by overriding `writeString` (appends to a
   *  per-page `StringBuilder`) and `endPage` (pushes the accumulated page's
   *  text into the result buffer and resets the builder). `getText(document)`
   *  is called exactly once, which walks the whole document a single time and
   *  drives both overrides — this avoids the O(n^2) anti-pattern of calling
   *  `setStartPage(i)/setEndPage(i)/getText(doc)` in a loop over pages (each
   *  such call re-walks the document from page 1), which would be a real
   *  performance problem on large PDFs (CLAUDE.md's "optimize for performance
   *  by default" rule applies directly here). */
  def extractPages(bytes: Array[Byte]): Try[Vector[String]] = Try {
    var document: PDDocument = null
    try {
      document = Loader.loadPDF(bytes)
      val stripper = new PerPageTextStripper
      stripper.getText(document)
      stripper.pages.toVector
    } finally {
      if (document != null) document.close()
    }
  }

  /** `PDFTextStripper` subclass driving the single-pass extraction described
   *  in [[extractPages]]'s doc comment. `writeString` may be invoked multiple
   *  times per page (once per line/text-run within the page's content
   *  stream); `endPage` fires exactly once per page, after all of that
   *  page's `writeString` calls, per PDFBox's own processing order. */
  private class PerPageTextStripper extends PDFTextStripper {
    private val currentPage = new StringBuilder
    private val pagesBuf    = ArrayBuffer.empty[String]

    def pages: Seq[String] = pagesBuf.toSeq

    override def writeString(text: String, textPositions: JList[TextPosition]): Unit =
      currentPage.append(text)

    override def endPage(page: PDPage): Unit = {
      pagesBuf += currentPage.toString
      currentPage.setLength(0)
      super.endPage(page)
    }
  }
}
