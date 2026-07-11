package com.helio.testutil

import org.apache.pdfbox.pdmodel.PDDocument
import org.apache.pdfbox.pdmodel.PDPage
import org.apache.pdfbox.pdmodel.PDPageContentStream
import org.apache.pdfbox.pdmodel.encryption.AccessPermission
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import org.apache.pdfbox.pdmodel.font.PDType1Font
import org.apache.pdfbox.pdmodel.font.Standard14Fonts

import java.io.ByteArrayOutputStream

/** Shared PDF fixture builder for backend tests (HEL-214). Builds real,
 *  well-formed PDFs in-memory via PDFBox rather than checking in binary
 *  fixture files — keeps the fixtures's exact per-page text content visible
 *  at the call site and avoids repo bloat. */
object PdfFixtures {

  /** Build a well-formed, non-encrypted multi-page PDF whose page N's
   *  extracted text is `pageTexts(N)`. */
  def multiPagePdf(pageTexts: Seq[String]): Array[Byte] = {
    val document = new PDDocument()
    try {
      pageTexts.foreach { text =>
        val page = new PDPage()
        document.addPage(page)
        val stream = new PDPageContentStream(document, page)
        try {
          stream.beginText()
          stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12)
          stream.newLineAtOffset(50, 700)
          stream.showText(text)
          stream.endText()
        } finally {
          stream.close()
        }
      }
      val out = new ByteArrayOutputStream()
      document.save(out)
      out.toByteArray
    } finally {
      document.close()
    }
  }

  /** Build a well-formed, single-page, password-protected PDF. */
  def encryptedPdf(ownerPassword: String = "owner-secret", userPassword: String = "user-secret"): Array[Byte] = {
    val document = new PDDocument()
    try {
      document.addPage(new PDPage())
      val policy = new StandardProtectionPolicy(ownerPassword, userPassword, new AccessPermission())
      document.protect(policy)
      val out = new ByteArrayOutputStream()
      document.save(out)
      out.toByteArray
    } finally {
      document.close()
    }
  }

  /** Bytes that are not a well-formed PDF at all. */
  val corruptBytes: Array[Byte] = "not a pdf file".getBytes("UTF-8")
}
