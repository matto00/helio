package com.helio.domain.connectors

import org.apache.pekko.http.scaladsl.model.{HttpHeader, Uri}
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1013: the pure paging functions -- config validation, Link parsing, next-request derivation, looks-paged. */
class RestPaginationSpec extends AnyWordSpec with Matchers {

  private def parse(json: String) = RestPagination.parse(json.parseJson)
  private def link(value: String)  = Seq(RawHeader("Link", value))
  private val emptyObj                = JsObject.empty

  "RestPagination.parse" should {
    "accept each style and round-trip it, omitting unset optional keys" in {
      Seq(
        """{"style":"link"}""",
        """{"style":"next_url","nextUrlPath":"meta.next","maxRequests":5}""",
        """{"style":"cursor","cursorPath":"meta.next","cursorParam":"after"}""",
        """{"style":"page","pageParam":"p","startPage":0,"pageSizeParam":"per","pageSize":50}""",
        """{"style":"offset","limit":25,"offsetParam":"skip","limitParam":"take","maxRequests":100}"""
      ).foreach { raw =>
        RestPagination.parse(raw.parseJson).map(RestPagination.toJson) shouldBe Right(raw.parseJson)
      }
    }
    "default maxRequests to 20" in {
      parse("""{"style":"link"}""").map(_.effectiveMaxRequests) shouldBe Right(20)
    }
    "reject every invalid shape, naming the field" in {
      val cases = Seq(
        """{"style":"offset"}"""                          -> "pagination.limit",
        """{"style":"cursor","cursorPath":"a"}"""         -> "pagination.cursorParam",
        """{"style":"next_url"}"""                        -> "pagination.nextUrlPath",
        """{"style":"link","maxRequests":0}"""            -> "pagination.maxRequests",
        """{"style":"link","maxRequests":101}"""          -> "pagination.maxRequests",
        """{"style":"link","maxRequests":2.5}"""          -> "pagination.maxRequests",
        """{"style":"link","maxRequests":"3"}"""          -> "pagination.maxRequests",
        """{"style":"offset","limit":0}"""                -> "pagination.limit",
        """{"style":"page","pageSize":-1}"""              -> "pagination.pageSize",
        """{"style":"page","pageParam":""}"""             -> "pagination.pageParam",
        """{"style":"bogus"}"""                           -> "pagination.style",
        """{}"""                                          -> "pagination.style",
        """{"style":"link","surprise":1}"""               -> "pagination.surprise",
        """{"style":"link","cursorPath":"a"}"""           -> "pagination.cursorPath"
      )
      cases.foreach { case (raw, field) => parse(raw).left.toOption.getOrElse(fail(s"accepted $raw")) should include(field) }
      RestPagination.parse(JsString("link")).isLeft shouldBe true
    }
  }

  "RestPagination.linkNext" should {
    "take the first rel=next link among several comma-separated link-values" in {
      RestPagination.linkNext(link("""<http://h/a?p=0>; rel="prev", <http://h/a?p=2>; rel="next", <http://h/a?p=9>; rel="last"""")) shouldBe Some("http://h/a?p=2")
    }
    "match rel quoted or unquoted, case-insensitively, among space-separated tokens" in {
      RestPagination.linkNext(link("""<http://h/n>; rel=next""")) shouldBe Some("http://h/n")
      RestPagination.linkNext(link("""<http://h/n>; rel="last NEXT"""")) shouldBe Some("http://h/n")
      RestPagination.linkNext(link("""<http://h/n>; REL="Next"""")) shouldBe Some("http://h/n")
    }
    "respect a comma inside the angle brackets and read every Link header" in {
      RestPagination.linkNext(link("""<http://h/a?x=1,2>; rel="next"""")) shouldBe Some("http://h/a?x=1,2")
      RestPagination.linkNext(Seq(RawHeader("Link", """<http://h/p>; rel="prev""""), RawHeader("link", """<http://h/n>; rel="next""""))) shouldBe Some("http://h/n")
    }
    "find nothing without a next relation" in {
      RestPagination.linkNext(link("""<http://h/p>; rel="prev"""")) shouldBe None
      RestPagination.linkNext(Nil) shouldBe None
      RestPagination.linkNext(link("not a link value")) shouldBe None
    }
  }

  "RestPagination.next" should {
    val first = Uri("http://h/items?q=1")
    def next(p: RestPagination, current: Uri, json: JsValue, headers: Seq[HttpHeader], rows: Int, index: Int = 1, seen: Set[String] = Set.empty) =
      RestPagination.next(p, first, current, index, json, headers, rows, seen).map(_.map(_.uri.toString))

    "resolve a relative Link target against the current request" in {
      next(RestPagination.Link(), Uri("http://h/items?q=1"), emptyObj, link("""</items?q=1&page=2>; rel="next""""), 1) shouldBe Right(Some("http://h/items?q=1&page=2"))
    }
    "read a next_url from the body, treating absent, null and emptyObj as the end" in {
      val p = RestPagination.NextUrl("meta.next")
      next(p, first, """{"meta":{"next":"http://h/items?q=1&p=2"}}""".parseJson, Nil, 1) shouldBe Right(Some("http://h/items?q=1&p=2"))
      next(p, first, """{"meta":{"next":null}}""".parseJson, Nil, 1) shouldBe Right(None)
      next(p, first, """{"meta":{"next":""}}""".parseJson, Nil, 1) shouldBe Right(None)
      next(p, first, """{}""".parseJson, Nil, 1) shouldBe Right(None)
      next(p, first, """{"meta":{"next":5}}""".parseJson, Nil, 1).isLeft shouldBe true
    }
    "send a string or numeric cursor back in cursorParam and refuse any other type" in {
      val p = RestPagination.Cursor("c", "after")
      next(p, first, """{"c":"abc"}""".parseJson, Nil, 1) shouldBe Right(Some("http://h/items?q=1&after=abc"))
      next(p, first, """{"c":42}""".parseJson, Nil, 1) shouldBe Right(Some("http://h/items?q=1&after=42"))
      next(p, first, """{"c":{"x":1}}""".parseJson, Nil, 1).isLeft shouldBe true
    }
    "refuse a repeated cursor or next URL" in {
      val p = RestPagination.Cursor("c", "after")
      next(p, first, """{"c":"abc"}""".parseJson, Nil, 1, seen = Set("cursor:abc")).left.toOption.get should include("repeats")
      next(RestPagination.Link(), first, emptyObj, link("""<http://h/items?q=1>; rel="next""""), 1, seen = Set("http://h/items?q=1")).isLeft shouldBe true
    }
    "end page and offset on an emptyObj or short page, otherwise advance by one page or by the limit" in {
      val page = RestPagination.Page(pageSize = Some(3))
      next(page, first, emptyObj, Nil, 3, index = 2) shouldBe Right(Some("http://h/items?q=1&page=3"))
      next(page, first, emptyObj, Nil, 2) shouldBe Right(None)
      next(page, first, emptyObj, Nil, 0) shouldBe Right(None)
      val offset = RestPagination.Offset(limit = 10)
      next(offset, first, emptyObj, Nil, 10, index = 3) shouldBe Right(Some("http://h/items?q=1&offset=30"))
      next(offset, first, emptyObj, Nil, 9) shouldBe Right(None)
    }
  }

  "RestPagination.firstUri" should {
    "set page and offset parameters, replacing every existing pair of that name and keeping the others in order" in {
      val uri = Uri("http://h/x?a=1&page=9&b=2&page=8")
      RestPagination.firstUri(RestPagination.Page(startPage = Some(0), pageSizeParam = Some("n"), pageSize = Some(5)), uri).toString shouldBe "http://h/x?a=1&page=0&b=2&n=5"
      RestPagination.firstUri(RestPagination.Offset(limit = 7), Uri("http://h/x?limit=1")).toString shouldBe "http://h/x?limit=7&offset=0"
      RestPagination.firstUri(RestPagination.Link(), uri) shouldBe uri
    }
  }

  "RestPagination.looksPaged" should {
    "detect a Link next header, a paging body key, and links.next" in {
      RestPagination.looksPaged(link("""<http://h/n>; rel="next""""), emptyObj) shouldBe true
      RestPagination.looksPaged(Nil, """{"has_more":true,"data":[]}""".parseJson) shouldBe true
      RestPagination.looksPaged(Nil, """{"links":{"next":"x"}}""".parseJson) shouldBe true
    }
    "stay quiet for an unpaged response" in {
      RestPagination.looksPaged(Nil, """{"data":[],"links":{"self":"x"}}""".parseJson) shouldBe false
      RestPagination.looksPaged(Nil, """[1,2]""".parseJson) shouldBe false
      RestPagination.looksPaged(link("""<http://h/p>; rel="prev""""), emptyObj) shouldBe false
    }
  }
}
