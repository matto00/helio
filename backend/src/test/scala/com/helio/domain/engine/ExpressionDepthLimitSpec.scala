package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsNumber

import java.util.concurrent.atomic.AtomicReference

/** HEL-1455 item 5: expression nesting is bounded (100 levels) and so is a parsed tree (200 levels), on the strict
 *  parser and on the legacy fallback alike, so a pathological expression is a clear parse error, never a
 *  `StackOverflowError`. */
class ExpressionDepthLimitSpec extends AnyWordSpec with Matchers {

  private val N = 10000

  private def parens(n: Int, inner: String): String = "(" * n + inner + ")" * n
  private def flat(op: String, terms: Int): String  = Vector.fill(terms)("1").mkString(op)

  private val deepUnary    = "-" * N + "1"
  private val deepNot      = "not " * N + "true"
  private val deepBrackets = parens(N, "1")
  private val deepCalls    = "abs(" * N + "1" + ")" * N
  private val deepLegacy   = "x + " + parens(N, "1") // strict fails on the bare `x`, so the legacy parser runs
  private val longFlat     = flat("+", N)

  private val nestingMsg = "nested too deeply"
  private val treeMsg    = "tree is too deep"

  private def ev(e: String) = ExpressionEvaluator.evaluate(e, Map.empty)
  private def problem(e: String): Option[String] = ExpressionEvaluator.parseProblem(e)

  "the nesting limit (100)" should {
    "reject 10000 chained unary minuses with a parse error, not a stack overflow" in {
      problem(deepUnary).get should include(nestingMsg)
      ExpressionEvaluator.validate(deepUnary, Set.empty).left.toOption.get should include(nestingMsg)
    }
    "reject 10000 chained nots" in { problem(deepNot).get should include(nestingMsg) }
    "reject 10000 nested brackets on the strict parser" in { problem(deepBrackets).get should include(nestingMsg) }
    "reject 10000 nested call arguments" in { problem(deepCalls).get should include(nestingMsg) }
    "reject deep brackets reached through the legacy fallback" in {
      problem(deepLegacy).get should include(nestingMsg)
      ExpressionEvaluator.validateTolerant(deepLegacy, Set("x")).left.toOption.get should include(nestingMsg)
      ExpressionEvaluator.evaluate(deepLegacy, Map.empty) shouldBe Left(EvaluationError.ParseError(problem(deepLegacy).get))
    }
    "accept exactly 100 levels and reject 101" in {
      problem("-" * 100 + "1") shouldBe None
      ev("-" * 100 + "1") shouldBe Right(JsNumber(1))
      ev(parens(100, "1")) shouldBe Right(JsNumber(1))
      problem("-" * 101 + "1").get should include(nestingMsg)
      problem(parens(100, "1")) shouldBe None
      problem(parens(101, "1")).get should include(nestingMsg)
      problem("not " * 100 + "true") shouldBe None
      problem("not " * 101 + "true").get should include(nestingMsg)
      problem("abs(" * 100 + "1" + ")" * 100) shouldBe None
      problem("abs(" * 101 + "1" + ")" * 101).get should include(nestingMsg)
    }
    "accept 100 legacy-fallback brackets and reject 101" in {
      problem("x + " + parens(100, "1")) shouldBe None
      problem("x + " + parens(101, "1")).get should include(nestingMsg)
    }
  }

  "the tree-depth limit (200)" should {
    "reject a 10000-term flat chain" in {
      ExpressionEvaluator.evaluate(longFlat, Map.empty) shouldBe Left(EvaluationError.ParseError(problem(longFlat).getOrElse("no parse error")))
      problem(longFlat).get should include(treeMsg)
      ExpressionEvaluator.inferType(longFlat, Map.empty).left.toOption.get should include(treeMsg)
    }
    "reject a long flat chain on the legacy fallback" in {
      problem("x + " + flat("+", N)).get should include(treeMsg)
    }
    "accept a 200-deep tree and reject a 201-deep one (a lone literal is depth 1)" in {
      problem(flat("+", 200)) shouldBe None
      ev(flat("+", 200)) shouldBe Right(JsNumber(200))
      ev(flat("*", 200)) shouldBe Right(JsNumber(1))
      problem(flat("+", 201)).get should include(treeMsg)
      problem(flat("*", 200)) shouldBe None
      problem(flat("*", 201)).get should include(treeMsg)
    }
  }

  "bracket groups keep their pre-HEL-1455 failure behaviour (not a parse change)" should {
    "still reject a bare identifier inside brackets with the closing-bracket error" in {
      problem("(x) + 1") shouldBe Some("Expected closing ')'")
      problem("(x * 2)") shouldBe Some("Expected closing ')'")
      problem("floor((x))") shouldBe Some("Expected closing ')'")
    }
  }

  "the worst in-limit shapes (design D6c)" should {
    "run every consumer on a 512 KB-stack thread without overflowing" in {
      val shapes = Vector(
        "flat +"      -> flat("+", 200),
        "flat -*"     -> Vector.tabulate(199)(_ => "1").zipWithIndex.foldLeft("1") { case (acc, (_, i)) => acc + (if (i % 2 == 0) "-" else "*") + "1" },
        "abs + chain" -> ("abs(" * 100 + flat("+", 100) + ")" * 100),
        "paren chain" -> (parens(100, flat("+", 100))),
        "concat"      -> ("concat(" * 100 + "1" + ")" * 100),
        "if"          -> ("if(true, 1, " * 100 + "1" + ")" * 100)
      )
      val failure = new AtomicReference[Throwable](null)
      val t = new Thread(null, () => {
        try shapes.foreach { case (name, e) =>
          withClue(s"shape '$name': ") {
            ExpressionEvaluator.parseProblem(e) shouldBe None
            ExpressionEvaluator.validate(e, Set("x")) shouldBe Right(())
            ExpressionEvaluator.inferType(e, Map("x" -> "string"))
            ExpressionEvaluator.numericContextTextFields(e, Map("x" -> "string"))
            ExpressionEvaluator.numericFieldsInTextFunction(e, Map("x" -> "integer"), Set.empty)
            ExpressionEvaluator.wrongTypeLiterals(e)
            ExpressionEvaluator.evaluate(e, Map.empty)
          }
        } catch { case th: Throwable => failure.set(th) }
      }, "headroom-512k", 512L * 1024L)
      t.start(); t.join()
      Option(failure.get()).foreach(th => fail(s"overflowed or failed on a 512 KB stack: $th"))
    }
  }
}
