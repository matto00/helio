package com.helio.services

import com.helio.testutil.PdfFixtures
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class PdfTextSupportSpec extends AnyWordSpec with Matchers {

  "PdfTextSupport.validate" should {

    "return the correct page count for a well-formed, multi-page PDF" in {
      val bytes = PdfFixtures.multiPagePdf(Seq("Page one", "Page two", "Page three"))
      PdfTextSupport.validate(bytes) shouldBe Right(3)
    }

    "return Left for corrupt / non-PDF bytes" in {
      PdfTextSupport.validate(PdfFixtures.corruptBytes) match {
        case Left(msg) => msg should include("not a valid PDF")
        case other     => fail(s"Expected Left, got: $other")
      }
    }

    "return Left for a password-protected PDF" in {
      val bytes = PdfFixtures.encryptedPdf()
      PdfTextSupport.validate(bytes) match {
        case Left(msg) => msg should include("password-protected")
        case other     => fail(s"Expected Left, got: $other")
      }
    }
  }

  "PdfTextSupport.extractPages" should {

    "extract distinct per-page text and the correct page count for a multi-page PDF" in {
      val bytes  = PdfFixtures.multiPagePdf(Seq("Alpha content", "Beta content", "Gamma content"))
      val result = PdfTextSupport.extractPages(bytes)

      result.isSuccess shouldBe true
      val pages = result.get
      pages should have size 3
      pages(0) should include("Alpha content")
      pages(1) should include("Beta content")
      pages(2) should include("Gamma content")
    }

    "return a Failure for corrupt / non-PDF bytes" in {
      PdfTextSupport.extractPages(PdfFixtures.corruptBytes).isFailure shouldBe true
    }
  }
}
