package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class ExpressionDateTimeFunctionsSpec extends AnyWordSpec with Matchers {

  private def ev(expr: String, pairs: (String, JsValue)*): Either[EvaluationError, JsValue] =
    ExpressionEvaluator.evaluate(expr, pairs.toMap)

  private def num(expr: String, pairs: (String, JsValue)*): Double = ev(expr, pairs: _*) match {
    case Right(JsNumber(n)) => n.toDouble
    case other              => fail(s"expected a number for $expr, got $other")
  }

  private def str(expr: String, pairs: (String, JsValue)*): String = ev(expr, pairs: _*) match {
    case Right(JsString(s)) => s
    case other              => fail(s"expected a string for $expr, got $other")
  }

  private val UnitsMessage =
    "date_trunc unit must be a string literal, one of: second, minute, hour, day, week, month, quarter, year"

  "seconds_between" should {
    "return the seconds between two ISO timestamps read from fields" in {
      num(
        "seconds_between($started_at, $created_at)",
        "started_at" -> JsString("2026-07-01T12:01:30Z"),
        "created_at" -> JsString("2026-07-01T12:00:00Z")
      ) shouldBe 90.0
    }
    "keep fractional seconds and sign" in {
      num("""seconds_between("2026-07-01T00:00:00Z", "2026-07-01T00:00:01.5Z")""") shouldBe -1.5
    }
    "honour offsets and read tz-less values as UTC" in {
      num("""seconds_between("2026-07-01T12:00:00+02:00", "2026-07-01 10:00:00")""") shouldBe 0.0
    }
    "treat a bare date as midnight UTC" in {
      num("""seconds_between("2026-07-02T06:00:00Z", "2026-07-02")""") shouldBe 21600.0
    }
    "count a leap day" in {
      num("""seconds_between("2024-03-01", "2024-02-28")""") shouldBe 172800.0
    }
    "apply no DST adjustment across a US DST transition" in {
      num("""seconds_between("2026-03-09T00:00:00Z", "2026-03-08T00:00:00Z")""") shouldBe 86400.0
    }
    "accept epoch seconds, epoch millis and JSON-number epochs" in {
      num("""seconds_between("1782907260", "1782907200")""") shouldBe 60.0
      num("""seconds_between("1782907260000", "1782907200000")""") shouldBe 60.0
      num("seconds_between($a, $b)", "a" -> JsNumber(1782907260L), "b" -> JsNumber(1782907200L)) shouldBe 60.0
    }
    "return 0.0 rather than -0.0 for equal instants" in {
      val d = num("""seconds_between("2026-07-01", "2026-07-01")""")
      d shouldBe 0.0
      (1.0 / d) shouldBe Double.PositiveInfinity
    }
    "be null for a null argument" in {
      ev("seconds_between($a, $b)", "a" -> JsNull, "b" -> JsString("2026-07-01T00:00:00Z")) shouldBe Right(JsNull)
      ev("seconds_between($a, $b)", "a" -> JsString("2026-07-01T00:00:00Z"), "b" -> JsNull) shouldBe Right(JsNull)
    }
    "be null for an unparseable argument without failing" in {
      ev("seconds_between($a, $b)", "a" -> JsString("not a date"), "b" -> JsString("2026-07-01T00:00:00Z")) shouldBe Right(JsNull)
      ev("seconds_between($a, $b)", "a" -> JsString(""), "b" -> JsString("2026-07-01T00:00:00Z")) shouldBe Right(JsNull)
      ev("seconds_between($a, $b)", "a" -> JsBoolean(true), "b" -> JsString("2026-07-01T00:00:00Z")) shouldBe Right(JsNull)
    }
    "require exactly 2 arguments" in {
      ExpressionEvaluator.validate("seconds_between($a)", Set("a")) shouldBe Left("seconds_between requires 2 arguments")
    }
  }

  "date_trunc" should {
    "floor to month, week and hour in UTC" in {
      str("""date_trunc("month", "2024-02-29T17:45:12Z")""") shouldBe "2024-02-01T00:00:00Z"
      str("""date_trunc("week", "2026-03-19T08:00:00Z")""") shouldBe "2026-03-16T00:00:00Z"
      str("""date_trunc("hour", "2026-07-01T12:34:56.789+01:00")""") shouldBe "2026-07-01T11:00:00Z"
    }
    "floor every supported unit" in {
      val ts = "2026-05-20T13:45:56.789Z"
      Map(
        "second"  -> "2026-05-20T13:45:56Z",
        "minute"  -> "2026-05-20T13:45:00Z",
        "hour"    -> "2026-05-20T13:00:00Z",
        "day"     -> "2026-05-20T00:00:00Z",
        "week"    -> "2026-05-18T00:00:00Z",
        "month"   -> "2026-05-01T00:00:00Z",
        "quarter" -> "2026-04-01T00:00:00Z",
        "year"    -> "2026-01-01T00:00:00Z"
      ).foreach { case (u, expected) => withClue(u)(str(s"""date_trunc("$u", "$ts")""") shouldBe expected) }
    }
    "keep a Monday for week and floor quarters on boundaries" in {
      str("""date_trunc("week", "2026-03-16T23:59:59Z")""") shouldBe "2026-03-16T00:00:00Z"
      str("""date_trunc("week", "2026-03-22T23:59:59Z")""") shouldBe "2026-03-16T00:00:00Z"
      str("""date_trunc("quarter", "2026-12-31")""") shouldBe "2026-10-01T00:00:00Z"
      str("""date_trunc("quarter", "2026-03-31")""") shouldBe "2026-01-01T00:00:00Z"
    }
    "accept a field and an epoch number" in {
      str("""date_trunc("day", $t)""", "t" -> JsNumber(1782907200L)) shouldBe "2026-07-01T00:00:00Z"
    }
    "be null for null or unparseable input" in {
      ev("""date_trunc("day", $t)""", "t" -> JsNull) shouldBe Right(JsNull)
      ev("""date_trunc("day", $t)""", "t" -> JsString("2026-13-01")) shouldBe Right(JsNull)
    }
    "reject an unknown unit, a non-literal unit and a bare identifier at parse time, on every entry point" in {
      Seq("""date_trunc("fortnight", $ts)""", "date_trunc($unit, $ts)", "date_trunc(day, $ts)", "date_trunc(-day, $ts)",
        "date_trunc(lower(day), $ts)", """date_trunc("DAY", $ts)""", "date_trunc(1, $ts)").foreach { e =>
        withClue(e) {
          ExpressionEvaluator.validate(e, Set("ts", "unit")) shouldBe Left(UnitsMessage)
          ExpressionEvaluator.parseProblem(e) shouldBe Some(UnitsMessage)
          ExpressionEvaluator.compile(e) shouldBe Left(EvaluationError.ParseError(UnitsMessage))
          ExpressionEvaluator.evaluate(e, Map("ts" -> JsString("2026-07-01"), "unit" -> JsString("day"))) shouldBe
            Left(EvaluationError.ParseError(UnitsMessage))
        }
      }
    }
    "still fail a single-quoted unit in the tokenizer" in {
      ExpressionEvaluator.validate("date_trunc('day', $ts)", Set("ts")).left.toOption.get should include("Unexpected character")
    }
    "require exactly 2 arguments" in {
      ExpressionEvaluator.validate("""date_trunc("day")""", Set.empty) shouldBe Left("date_trunc requires 2 arguments")
    }
  }

  "add_days" should {
    "cross a leap day and accept fractions" in {
      str("""add_days("2024-02-28", 1)""") shouldBe "2024-02-29T00:00:00Z"
      str("""add_days("2026-07-01T00:00:00Z", 0.5)""") shouldBe "2026-07-01T12:00:00Z"
    }
    "go backwards with a negative count and print fractional seconds only when non-zero" in {
      str("""add_days("2026-07-01", -1)""") shouldBe "2026-06-30T00:00:00Z"
      str("""add_days("2026-07-01T00:00:00Z", 0.000001)""") shouldBe "2026-07-01T00:00:00.086400Z"
    }
    "add no DST adjustment" in {
      str("""add_days("2026-03-08T00:00:00Z", 1)""") shouldBe "2026-03-09T00:00:00Z"
    }
    "handle a large representable shift and null an unrepresentable one" in {
      str("""add_days("2026-07-01", 1000000)""") shouldBe "4764-05-28T00:00:00Z"
      ev("""add_days("2026-07-01", 1000000000000000)""") shouldBe Right(JsNull)
      ev("""add_days("2026-07-01", $n)""", "n" -> JsNumber(BigDecimal("1e300"))) shouldBe Right(JsNull)
      ev("""add_days("2026-07-01", -1000000000000000)""") shouldBe Right(JsNull)
    }
    "be null for a null argument or unparseable timestamp" in {
      ev("add_days($t, 1)", "t" -> JsNull) shouldBe Right(JsNull)
      ev("add_days($t, $n)", "t" -> JsString("2026-07-01"), "n" -> JsNull) shouldBe Right(JsNull)
      ev("add_days($t, 1)", "t" -> JsString("garbage")) shouldBe Right(JsNull)
    }
    "type-error on a text day count" in {
      ev("add_days($ts, $n)", "ts" -> JsString("2026-07-01"), "n" -> JsString("3")).left.toOption.get shouldBe an[EvaluationError.TypeError]
    }
  }

  "the date/time function family" should {
    "not include now or today" in {
      Seq("now()", "today()").foreach(e => ExpressionEvaluator.parseProblem(e) shouldBe defined)
    }
    "leave '-' numeric-only on timestamp strings" in {
      ev("$a - $b", "a" -> JsString("2026-07-01T00:01:00Z"), "b" -> JsString("2026-07-01T00:00:00Z")).left.toOption.get shouldBe
        an[EvaluationError.TypeError]
    }
    "list the new functions in the unknown-function message" in {
      val msg = ExpressionEvaluator.validate("reverse($x)", Set("x")).left.toOption.get
      Seq("seconds_between", "date_trunc", "add_days").foreach(f => msg should include(f))
    }
    "have DateTimeFunctions equal the three names" in {
      ExpressionEvaluator.DateTimeFunctions.toSet shouldBe Set("seconds_between", "date_trunc", "add_days")
      ExpressionEvaluator.DateTimeFunctions.foreach(f => ExpressionEvaluator.SupportedFunctions should contain(f))
    }
  }
}
