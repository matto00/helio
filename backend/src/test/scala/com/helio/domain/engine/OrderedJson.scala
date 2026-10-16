package com.helio.domain.engine

import spray.json.{JsArray, JsBoolean, JsNull, JsNumber, JsObject, JsString, JsValue}

/** HEL-1581: a JSON tree that keeps object key order and number text, so a regenerated parity-corpus file differs from
 *  its source only where an expectation was filled in (spray's `JsObject` is an unordered `Map` past four keys). */
sealed trait OJ

object OJ {
  final case class Obj(fields: Vector[(String, OJ)]) extends OJ {
    def get(key: String): Option[OJ] = fields.collectFirst { case (k, v) if k == key => v }

    def apply(key: String): OJ = get(key).getOrElse(throw new NoSuchElementException(s"missing key '$key'"))

    def contains(key: String): Boolean = fields.exists(_._1 == key)

    def updated(key: String, value: OJ): Obj =
      if (contains(key)) Obj(fields.map { case (k, v) => if (k == key) (k, value) else (k, v) })
      else Obj(fields :+ (key -> value))
  }
  final case class Arr(items: Vector[OJ])  extends OJ
  final case class Str(s: String)          extends OJ
  final case class Num(text: String)       extends OJ
  final case class Bool(b: Boolean)        extends OJ
  case object Null                         extends OJ

  /** A JSON string literal; everything outside printable ASCII is `\\uXXXX`-escaped so invisible characters stay visible in review. */
  def quote(s: String): String = {
    val sb = new StringBuilder("\"")
    s.foreach {
      case '"'  => sb ++= "\\\""
      case '\\' => sb ++= "\\\\"
      case '\n' => sb ++= "\\n"
      case '\t' => sb ++= "\\t"
      case '\r' => sb ++= "\\r"
      case c if c < ' ' || c > '~' => sb ++= f"\\u${c.toInt}%04x"
      case c => sb += c
    }
    sb += '"'
    sb.toString
  }

  def parse(text: String): OJ = {
    val p = new Parser(text)
    val v = p.value()
    p.skipWs()
    require(p.atEnd, s"trailing characters at ${p.pos}")
    v
  }

  def toSpray(v: OJ): JsValue = v match {
    case Obj(fields) => JsObject(fields.map { case (k, x) => k -> toSpray(x) }.toMap)
    case Arr(items)  => JsArray(items.map(toSpray))
    case Str(s)      => JsString(s)
    case Num(t)      => JsNumber(BigDecimal(t))
    case Bool(b)     => JsBoolean(b)
    case Null        => JsNull
  }

  /** Compact, order-preserving text (what the step config decoders receive). */
  def compact(v: OJ): String = v match {
    case Obj(fields) => fields.map { case (k, x) => s"${quote(k)}:${compact(x)}" }.mkString("{", ",", "}")
    case Arr(items)  => items.map(compact).mkString("[", ",", "]")
    case Str(s)      => quote(s)
    case Num(t)      => t
    case Bool(b)     => b.toString
    case Null        => "null"
  }

  /** Objects down to depth 2 (file, vector, vector fields) are expanded, as are arrays at depths 0-1; the rest is one line. */
  def render(v: OJ, depth: Int = 0): String =
    if (depth >= 3) compact(v)
    else
      v match {
        case Obj(fields) if fields.isEmpty => "{}"
        case Obj(fields) =>
          val pad = "  " * (depth + 1)
          fields.map { case (k, x) => s"$pad${quote(k)}: ${render(x, depth + 1)}" }.mkString("{\n", ",\n", s"\n${"  " * depth}}")
        case Arr(items) if items.isEmpty => "[]"
        case Arr(items) if depth < 2 =>
          val pad = "  " * (depth + 1)
          items.map(i => pad + render(i, depth + 1)).mkString("[\n", ",\n", s"\n${"  " * depth}]")
        case other => compact(other)
      }

  private final class Parser(s: String) {
    var pos = 0

    def atEnd: Boolean = pos >= s.length

    def skipWs(): Unit = while (pos < s.length && s(pos).isWhitespace) pos += 1

    def value(): OJ = {
      skipWs()
      s(pos) match {
        case '{' => obj()
        case '[' => arr()
        case '"' => Str(string())
        case 't' => lit("true", Bool(true))
        case 'f' => lit("false", Bool(false))
        case 'n' => lit("null", Null)
        case _   => num()
      }
    }

    private def lit(word: String, v: OJ): OJ = {
      require(s.startsWith(word, pos), s"bad literal at $pos")
      pos += word.length
      v
    }

    private def num(): OJ = {
      val start = pos
      while (pos < s.length && "+-0123456789.eE".indexOf(s(pos)) >= 0) pos += 1
      require(pos > start, s"bad value at $start")
      Num(s.substring(start, pos))
    }

    private def string(): String = {
      pos += 1
      val sb = new StringBuilder
      while (s(pos) != '"') {
        if (s(pos) == '\\') {
          s(pos + 1) match {
            case 'n' => sb += '\n'
            case 't' => sb += '\t'
            case 'r' => sb += '\r'
            case 'b' => sb += '\b'
            case 'f' => sb += '\f'
            case 'u' =>
              sb += Integer.parseInt(s.substring(pos + 2, pos + 6), 16).toChar
              pos += 4
            case other => sb += other
          }
          pos += 2
        } else {
          sb += s(pos)
          pos += 1
        }
      }
      pos += 1
      sb.toString
    }

    private def arr(): OJ = {
      pos += 1
      val items = Vector.newBuilder[OJ]
      skipWs()
      if (s(pos) == ']') pos += 1
      else {
        var more = true
        while (more) {
          items += value()
          skipWs()
          if (s(pos) == ',') pos += 1 else { require(s(pos) == ']', s"expected ] at $pos"); pos += 1; more = false }
        }
      }
      Arr(items.result())
    }

    private def obj(): OJ = {
      pos += 1
      val fields = Vector.newBuilder[(String, OJ)]
      skipWs()
      if (s(pos) == '}') pos += 1
      else {
        var more = true
        while (more) {
          skipWs()
          val key = string()
          skipWs()
          require(s(pos) == ':', s"expected : at $pos")
          pos += 1
          fields += (key -> value())
          skipWs()
          if (s(pos) == ',') pos += 1 else { require(s(pos) == '}', s"expected } at $pos"); pos += 1; more = false }
        }
      }
      Obj(fields.result())
    }
  }
}
