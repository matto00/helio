package com.helio.domain.connectors

import org.apache.pekko.http.scaladsl.model.{HttpHeader, Uri}
import spray.json._

import scala.concurrent.duration._
import scala.util.Try

/** How a REST source pages (HEL-1013). One case per idiom; optional fields stay `Option` so a stored config echoes back
 *  exactly what was written, and the `effective*` members apply the defaults. */
sealed trait RestPagination {
  def maxRequests: Option[Int]
  def effectiveMaxRequests: Int = maxRequests.getOrElse(RestPagination.DefaultMaxRequests)
  def style: String
}

object RestPagination {
  final case class Link(maxRequests: Option[Int] = None) extends RestPagination { val style = "link" }
  final case class NextUrl(nextUrlPath: String, maxRequests: Option[Int] = None) extends RestPagination { val style = "next_url" }
  final case class Cursor(cursorPath: String, cursorParam: String, maxRequests: Option[Int] = None) extends RestPagination {
    val style = "cursor"
  }
  final case class Page(
      pageParam: Option[String] = None,
      startPage: Option[Int] = None,
      pageSizeParam: Option[String] = None,
      pageSize: Option[Int] = None,
      maxRequests: Option[Int] = None
  ) extends RestPagination {
    val style = "page"
    def effectivePageParam: String = pageParam.getOrElse("page")
    def effectiveStartPage: Int    = startPage.getOrElse(1)
  }
  final case class Offset(
      limit: Int,
      offsetParam: Option[String] = None,
      limitParam: Option[String] = None,
      maxRequests: Option[Int] = None
  ) extends RestPagination {
    val style = "offset"
    def effectiveOffsetParam: String = offsetParam.getOrElse("offset")
    def effectiveLimitParam: String  = limitParam.getOrElse("limit")
  }

  val DefaultMaxRequests = 20
  val MaxMaxRequests     = 100

  /** The total time budget of one paged fetch. */
  val TotalTimeout: FiniteDuration = 120.seconds

  /** The top-level body keys that make an unconfigured response look paged. */
  val PagingBodyKeys: Set[String] =
    Set("next", "next_url", "nextUrl", "next_page", "nextPage", "cursor", "next_cursor", "nextCursor", "has_more", "hasMore")

  // ---- config parse / write -------------------------------------------------------------------------------------

  private val commonKeys = Set("style", "maxRequests")
  private val keysByStyle = Map(
    "link"     -> commonKeys,
    "next_url" -> (commonKeys + "nextUrlPath"),
    "cursor"   -> (commonKeys + "cursorPath" + "cursorParam"),
    "page"     -> (commonKeys + "pageParam" + "startPage" + "pageSizeParam" + "pageSize"),
    "offset"   -> (commonKeys + "offsetParam" + "limitParam" + "limit")
  )

  /** Total: every malformed shape is a `Left` naming the field. An unknown key is rejected only inside this object. */
  def parse(json: JsValue): Either[String, RestPagination] = json match {
    case JsObject(fields) =>
      for {
        style <- fields.get("style") match {
          case Some(JsString(s)) if keysByStyle.contains(s) => Right(s)
          case Some(JsString(s))                            => Left(s"pagination.style '$s' is not one of link, next_url, cursor, page, offset")
          case _                                            => Left("pagination.style is required (link, next_url, cursor, page or offset)")
        }
        _ <- fields.keys.find(k => !keysByStyle(style).contains(k)) match {
          case Some(k) => Left(s"pagination.$k is not accepted for style '$style'")
          case None    => Right(())
        }
        maxRequests <- optInt(fields, "maxRequests", 1, MaxMaxRequests)
        built <- style match {
          case "link" => Right(Link(maxRequests))
          case "next_url" =>
            reqString(fields, "nextUrlPath").map(NextUrl(_, maxRequests))
          case "cursor" =>
            for {
              path  <- reqString(fields, "cursorPath")
              param <- reqString(fields, "cursorParam")
            } yield Cursor(path, param, maxRequests)
          case "page" =>
            for {
              pageParam     <- optString(fields, "pageParam")
              startPage     <- optInt(fields, "startPage", 0, 1000000)
              pageSizeParam <- optString(fields, "pageSizeParam")
              pageSize      <- optInt(fields, "pageSize", 1, 10000)
            } yield Page(pageParam, startPage, pageSizeParam, pageSize, maxRequests)
          case _ =>
            for {
              limit       <- reqInt(fields, "limit", 1, 10000)
              offsetParam <- optString(fields, "offsetParam")
              limitParam  <- optString(fields, "limitParam")
            } yield Offset(limit, offsetParam, limitParam, maxRequests)
        }
      } yield built
    case _ => Left("pagination must be an object")
  }

  def toJson(p: RestPagination): JsObject = {
    def s(name: String, v: Option[String]) = v.map(name -> JsString(_))
    def n(name: String, v: Option[Int])    = v.map(name -> JsNumber(_))
    val entries: Seq[Option[(String, JsValue)]] = p match {
      case Link(_)        => Seq.empty
      case NextUrl(path, _) => Seq(Some("nextUrlPath" -> JsString(path)))
      case Cursor(path, param, _) => Seq(Some("cursorPath" -> JsString(path)), Some("cursorParam" -> JsString(param)))
      case pg: Page =>
        Seq(s("pageParam", pg.pageParam), n("startPage", pg.startPage), s("pageSizeParam", pg.pageSizeParam), n("pageSize", pg.pageSize))
      case o: Offset => Seq(s("offsetParam", o.offsetParam), s("limitParam", o.limitParam), Some("limit" -> JsNumber(o.limit)))
    }
    JsObject((Seq[Option[(String, JsValue)]](Some("style" -> JsString(p.style))) ++ entries :+ n("maxRequests", p.maxRequests)).flatten.toMap)
  }

  private def reqString(f: Map[String, JsValue], k: String): Either[String, String] = f.get(k) match {
    case Some(JsString(v)) if v.trim.nonEmpty => Right(v.trim)
    case Some(_)                              => Left(s"pagination.$k must be a non-empty string")
    case None                                 => Left(s"pagination.$k is required")
  }
  private def optString(f: Map[String, JsValue], k: String): Either[String, Option[String]] =
    if (f.contains(k)) reqString(f, k).map(Some(_)) else Right(None)
  private def intOf(k: String, lo: Int, hi: Int, v: JsValue): Either[String, Int] = v match {
    case JsNumber(n) if n.isWhole && n >= lo && n <= hi => Right(n.toInt)
    case _                                              => Left(s"pagination.$k must be an integer from $lo to $hi")
  }
  private def optInt(f: Map[String, JsValue], k: String, lo: Int, hi: Int): Either[String, Option[Int]] =
    f.get(k).fold[Either[String, Option[Int]]](Right(None))(v => intOf(k, lo, hi, v).map(Some(_)))
  private def reqInt(f: Map[String, JsValue], k: String, lo: Int, hi: Int): Either[String, Int] =
    f.get(k).fold[Either[String, Int]](Left(s"pagination.$k is required"))(v => intOf(k, lo, hi, v))

  // ---- request derivation (pure) --------------------------------------------------------------------------------

  /** Sets `name` to `value`: the first existing pair of that name is replaced in place, any further pair of that name is
   *  dropped, and with none the pair is appended. Every other pair keeps its order. */
  def withParam(uri: Uri, name: String, value: String): Uri = {
    val pairs = uri.query().toVector
    val set =
      if (!pairs.exists(_._1 == name)) pairs :+ (name -> value)
      else {
        val idx = pairs.indexWhere(_._1 == name)
        pairs.zipWithIndex.collect {
          case (_, i) if i == idx                 => name -> value
          case (kv, _) if kv._1 != name           => kv
        }
      }
    uri.withQuery(Uri.Query(set: _*))
  }

  /** The URI of request one: `page` and `offset` set their parameters, every other style sends `uri` unchanged. */
  def firstUri(p: RestPagination, uri: Uri): Uri = p match {
    case pg: Page =>
      val withPage = withParam(uri, pg.effectivePageParam, pg.effectiveStartPage.toString)
      (pg.pageSizeParam, pg.pageSize) match {
        case (Some(param), Some(size)) => withParam(withPage, param, size.toString)
        case _                         => withPage
      }
    case o: Offset => withParam(withParam(uri, o.effectiveOffsetParam, "0"), o.effectiveLimitParam, o.limit.toString)
    case _         => uri
  }

  /** The follow-up request: its URI and a key the loop uses to refuse a repeat. */
  final case class Next(uri: Uri, key: String)

  /** `pageIndex` is the 1-based index of the page just read; `first` is [[firstUri]]'s result; `current` is the URI that
   *  page was requested from. `Right(None)` is the end of the paging. */
  def next(
      p: RestPagination,
      first: Uri,
      current: Uri,
      pageIndex: Int,
      json: JsValue,
      headers: Seq[HttpHeader],
      rowCount: Int,
      seen: Set[String]
  ): Either[String, Option[Next]] = {
    def noRepeat(n: Next, what: String): Either[String, Option[Next]] =
      if (seen.contains(n.key)) Left(s"the $what repeats an earlier page, so paging would never end") else Right(Some(n))
    p match {
      case _: Link =>
        linkNext(headers).fold[Either[String, Option[Next]]](Right(None))(t => resolve(t, current).flatMap(u => noRepeat(Next(u, u.toString), "next link")))
      case n: NextUrl =>
        valueAt(json, n.nextUrlPath) match {
          case None => Right(None)
          case Some(JsString(s)) =>
            resolve(s, current).flatMap(u => noRepeat(Next(u, u.toString), "next URL"))
          case Some(_) => Left(s"'${n.nextUrlPath}' is not a string")
        }
      case c: Cursor =>
        valueAt(json, c.cursorPath) match {
          case None                          => Right(None)
          case Some(JsString(v))             => noRepeat(Next(withParam(first, c.cursorParam, v), s"cursor:$v"), "cursor")
          case Some(JsNumber(v))             => noRepeat(Next(withParam(first, c.cursorParam, v.toString), s"cursor:$v"), "cursor")
          case Some(_)                       => Left(s"'${c.cursorPath}' is neither a string nor a number")
        }
      case pg: Page =>
        if (rowCount == 0 || pg.pageSize.exists(rowCount < _)) Right(None)
        else Right(Some(Next(withParam(first, pg.effectivePageParam, (pg.effectiveStartPage + pageIndex).toString), s"page:$pageIndex")))
      case o: Offset =>
        if (rowCount == 0 || rowCount < o.limit) Right(None)
        else Right(Some(Next(withParam(first, o.effectiveOffsetParam, (pageIndex.toLong * o.limit).toString), s"offset:$pageIndex")))
    }
  }

  /** The value at a dot path; absent, null and an empty string are all "no value". */
  private def valueAt(json: JsValue, path: String): Option[JsValue] =
    path.split("\\.").foldLeft[Option[JsValue]](Some(json)) {
      case (Some(JsObject(f)), seg) => f.get(seg)
      case _                        => None
    }.filter {
      case JsNull      => false
      case JsString(s) => s.nonEmpty
      case _           => true
    }

  private def resolve(target: String, base: Uri): Either[String, Uri] =
    Try(Uri(target).resolvedAgainst(base)).toEither.left.map(_ => "the next page address is not a valid URL")

  // ---- Link header (RFC 8288) -----------------------------------------------------------------------------------

  /** The target of the first link whose `rel` holds the token `next`, across every `Link` header. */
  def linkNext(headers: Seq[HttpHeader]): Option[String] =
    headers.filter(_.lowercaseName == "link").flatMap(h => splitLinkValues(h.value())).flatMap(parseLinkValue).collectFirst {
      case (target, params) if params.exists { case (k, v) => k == "rel" && v.toLowerCase.split("\\s+").contains("next") } => target
    }

  private def splitLinkValues(raw: String): Seq[String] = {
    val out = Vector.newBuilder[String]
    val cur = new StringBuilder
    var inAngle = false
    var inQuote = false
    raw.foreach { ch =>
      if (ch == '<' && !inQuote) inAngle = true
      else if (ch == '>' && !inQuote) inAngle = false
      else if (ch == '"' && !inAngle) inQuote = !inQuote
      if (ch == ',' && !inAngle && !inQuote) { out += cur.toString; cur.clear() }
      else cur.append(ch)
    }
    out += cur.toString
    out.result().map(_.trim).filter(_.nonEmpty)
  }

  private def parseLinkValue(value: String): Option[(String, Seq[(String, String)])] =
    if (!value.startsWith("<")) None
    else {
      val close = value.indexOf('>')
      if (close < 0) None
      else {
        val params = value.substring(close + 1).split(";").toVector.map(_.trim).filter(_.contains("=")).map { kv =>
          val i = kv.indexOf('=')
          kv.substring(0, i).trim.toLowerCase -> kv.substring(i + 1).trim.stripPrefix("\"").stripSuffix("\"")
        }
        Some((value.substring(1, close).trim, params))
      }
    }

  /** True when a single response carries a paging signal, so create/infer can say the source may be limited to page one. */
  def looksPaged(headers: Seq[HttpHeader], json: JsValue): Boolean =
    linkNext(headers).isDefined || (json match {
      case JsObject(f) =>
        f.keys.exists(PagingBodyKeys.contains) || (f.get("links") match {
          case Some(JsObject(l)) => l.contains("next")
          case _                 => false
        })
      case _ => false
    })

  /** The create/infer notice for a response judged by `looksPaged`; `None` otherwise. */
  def noticeFor(looksPaged: Boolean): Option[String] = if (looksPaged) Some(PagingNotice) else None

  val PagingNotice: String =
    "This response looks paged: the source may be limited to its first page. Paging can be configured on the source (pagination)."
}
