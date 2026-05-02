package com.helio.api

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class ImageFitValidationSpec extends AnyWordSpec with Matchers {

  "RequestValidation.validateImageFit" should {
    "accept None (absent)" in {
      RequestValidation.validateImageFit(None) shouldBe Right(None)
    }

    "accept \"contain\"" in {
      RequestValidation.validateImageFit(Some("contain")) shouldBe Right(Some("contain"))
    }

    "accept \"cover\"" in {
      RequestValidation.validateImageFit(Some("cover")) shouldBe Right(Some("cover"))
    }

    "accept \"fill\"" in {
      RequestValidation.validateImageFit(Some("fill")) shouldBe Right(Some("fill"))
    }

    "reject \"stretch\"" in {
      RequestValidation.validateImageFit(Some("stretch")).isLeft shouldBe true
    }

    "reject \"center\"" in {
      RequestValidation.validateImageFit(Some("center")).isLeft shouldBe true
    }

    "reject empty string" in {
      RequestValidation.validateImageFit(Some("")).isLeft shouldBe true
    }

    "include valid values in the error message for invalid input" in {
      val Left(msg) = RequestValidation.validateImageFit(Some("stretch"))
      msg should include("contain")
      msg should include("cover")
      msg should include("fill")
    }
  }
}
