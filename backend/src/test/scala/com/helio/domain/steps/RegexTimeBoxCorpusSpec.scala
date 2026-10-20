package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.regex.Pattern

/** HEL-1676 D5: matching through the deadline-checking CharSequence gives exactly the results plain `String` matching gives. */
class RegexTimeBoxCorpusSpec extends AnyWordSpec with Matchers {

  private val patterns = Vector(
    "(a)$", "^(a)", "(?m)(a)$", "(a.b)", "(a\\sb)", "(a\\s*)b", "(?<=x)(a)", "(a)(?=b)", "(?<!x)(a)", "(\\w)\\1",
    "(é+)", "(\\p{L}+)", "(?i)(straße)", "([^\\n]+)", "(.)$", "(\\d+)", "((?:ab)+)", "(a|b)+?c", "()", "(x*)"
  )
  private val inputs = Vector(
    "", "a", "ab", "a\n", "a\nb", "a\rb", "a\u0085b", "a b", "a\u000Bb", "a b", "xa", "xab", "aab", "11 22", "éé e", "日本語 text",
    "STRASSE straße", "😀a😀", "abababc", "line1\nline2\n"
  )

  "wrapped matching" should {
    "return the same find result and group text as plain matching across the corpus" in {
      val deadline = RegexTimeBox.deadline()
      for (p <- patterns; in <- inputs) {
        val compiled = Pattern.compile(p)
        val plain    = compiled.matcher(in)
        val boxed    = compiled.matcher(deadline.input(in, "corpus"))
        val found    = plain.find()
        withClue(s"pattern=$p input=${in.map(c => f"\\u${c.toInt}%04x").mkString}: ") {
          boxed.find() shouldBe found
          if (found) {
            boxed.start() shouldBe plain.start()
            boxed.end() shouldBe plain.end()
            (1 to plain.groupCount()).foreach(g => boxed.group(g) shouldBe plain.group(g))
          }
        }
      }
    }

    "expire on a short budget once enough characters are read, with the step's description" in {
      val deadline = RegexTimeBox.deadline(1L)
      val e = intercept[RegexTimeBudgetExceeded](Pattern.compile("^(.*a){12}$").matcher(deadline.input("a" * 40 + "b", "probe")).find())
      e.getMessage should include("probe")
      e.getMessage should include("regex time budget")
    }
  }
}
