package com.helio.eval

import spray.json._

import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.time.Duration
import scala.collection.concurrent.TrieMap
import scala.util.Try

/** HEL-1639 D8: a minimal blocking HTTP client for the assistant eval runner. It talks to the lane's
 *  dev backend over its normal public routes only -- the test JVM holds no model key and no database
 *  connection (HEL-1450). The session cookie is kept by hand because the dev backend marks it
 *  `HttpOnly` and a `java.net.CookieManager` would also refuse to replay a `Secure` one over http.
 *  Every non-GET carries the CSRF header the backend requires with a session cookie. */
final class EvalHttp(baseUrl: String, requestTimeout: Duration = Duration.ofSeconds(240)) {

  private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
  private val cookies = TrieMap.empty[String, String]

  private def cookieHeader: Option[String] =
    if (cookies.isEmpty) None else Some(cookies.map { case (k, v) => s"$k=$v" }.mkString("; "))

  private def send(method: String, path: String, body: Option[JsValue]): Reply = {
    val builder = HttpRequest.newBuilder(URI.create(baseUrl.stripSuffix("/") + path)).timeout(requestTimeout)
    cookieHeader.foreach(builder.header("Cookie", _))
    if (method != "GET") builder.header("X-Helio-Requested-With", "1")
    val publisher = body match {
      case Some(b) =>
        builder.header("Content-Type", "application/json")
        HttpRequest.BodyPublishers.ofString(b.compactPrint)
      case None => HttpRequest.BodyPublishers.noBody()
    }
    val response = client.send(builder.method(method, publisher).build(), HttpResponse.BodyHandlers.ofString())
    response.headers().allValues("set-cookie").forEach { raw =>
      val pair = raw.takeWhile(_ != ';')
      pair.split("=", 2) match {
        case Array(k, v) if v.nonEmpty => cookies.put(k.trim, v.trim)
        case Array(k, _)               => cookies.remove(k.trim)
        case _                         => ()
      }
    }
    Reply(response.statusCode(), response.body())
  }

  def get(path: String): Reply                         = send("GET", path, None)
  def post(path: String, body: JsValue): Reply         = send("POST", path, Some(body))
  def delete(path: String): Reply                      = send("DELETE", path, None)

  /** `POST /api/auth/login`. The password comes from the caller (an environment variable) and is never logged. */
  def login(email: String, password: String): Reply =
    post("/api/auth/login", JsObject("email" -> JsString(email), "password" -> JsString(password)))
}

final case class Reply(status: Int, body: String) {
  def ok: Boolean              = status >= 200 && status < 300
  def json: JsValue            = body.parseJson
  def jsonOpt: Option[JsValue] = Try(body.parseJson).toOption
}

object EvalJson {
  def str(v: JsValue, path: String*): Option[String] = at(v, path: _*).collect { case JsString(s) => s }

  def at(v: JsValue, path: String*): Option[JsValue] =
    path.foldLeft(Option(v)) {
      case (Some(o: JsObject), key) => o.fields.get(key)
      case _                        => None
    }

  def arr(v: JsValue, path: String*): Vector[JsValue] = at(v, path: _*) match {
    case Some(JsArray(xs)) => xs
    case _                 => Vector.empty
  }

  /** Every string value stored under any key named `key`, anywhere in `v`. */
  def collectStrings(v: JsValue, key: String): Vector[String] = v match {
    case JsObject(fields) =>
      fields.toVector.flatMap {
        case (`key`, JsString(s)) => Vector(s)
        case (_, inner)           => collectStrings(inner, key)
      }
    case JsArray(xs) => xs.flatMap(collectStrings(_, key))
    case _           => Vector.empty
  }
}
