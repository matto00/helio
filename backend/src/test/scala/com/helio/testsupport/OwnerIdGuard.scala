package com.helio.testsupport

import spray.json._

/** HEL-1216: generic owner-id leak guard. Walks a serialized response recursively and reports every
 *  object KEY or string/number/boolean VALUE that CONTAINS `ownerId` (contains-match, not equality,
 *  so an id embedded in a longer string, URL, or key name is still caught). It deliberately does not
 *  care what the field is called -- an owner-id-equivalent under any name is a leak. */
object OwnerIdGuard {

  /** JSON-path of every offending key or value; empty means clean. */
  def leaks(json: JsValue, ownerId: String, path: String = "$"): Vector[String] = json match {
    case JsObject(fields) =>
      fields.toVector.flatMap { case (k, v) =>
        val keyLeak = if (k.contains(ownerId)) Vector(s"$path key '$k'") else Vector.empty
        keyLeak ++ leaks(v, ownerId, s"$path.$k")
      }
    case JsArray(items) => items.zipWithIndex.flatMap { case (v, i) => leaks(v, ownerId, s"$path[$i]") }
    case JsString(s)    => if (s.contains(ownerId)) Vector(s"$path value '$s'") else Vector.empty
    case other          => if (other.compactPrint.contains(ownerId)) Vector(s"$path value '${other.compactPrint}'") else Vector.empty
  }

  /** Throws with every offending path (and the raw body) when the id appears anywhere. A body that is
   *  not JSON is checked as a raw string, so a plain-text error body cannot hide the id either. */
  def assertNoOwnerId(rawBody: String, ownerId: String, context: String): Unit = {
    val found = scala.util.Try(rawBody.parseJson).toOption match {
      case Some(json) => leaks(json, ownerId)
      case None       => if (rawBody.contains(ownerId)) Vector(s"non-JSON body contains id") else Vector.empty
    }
    if (found.nonEmpty)
      throw new AssertionError(s"$context leaked owner id $ownerId at: ${found.mkString(", ")}\nbody: $rawBody")
  }
}
