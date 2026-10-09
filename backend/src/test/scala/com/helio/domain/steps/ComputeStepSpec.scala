package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-888 design.md Decisions 1/3/4: the `compute` step's write-path
 *  (`validateRawConfig`) and run-path (`requiredConfigProblems`) static
 *  parse-problem gates, at the companion-object level. End-to-end write and
 *  run-surface coverage lives in `PipelineStepRoutesSpec` and
 *  `PipelineStepRequiredConfigSpec` respectively. */
class ComputeStepSpec extends AnyWordSpec with Matchers {

  private def config(column: String, expression: String): String =
    s"""{"column":"$column","expression":"$expression"}"""

  "ComputeStep.companion.validateRawConfig" should {

    // PROOF (task 2.1). Run on unmodified `main` (before Decision 3's
    // override existed): returned `None` — the production defect, measured
    // directly against the companion rather than the route.
    "reject the production expression 'stats.adp_ppr - stats.pts_ppr', carrying the parser's message" in {
      val problem = ComputeStep.companion.validateRawConfig(
        config("value_vs_adp", "stats.adp_ppr - stats.pts_ppr")
      )
      problem shouldBe defined
      problem.get should include("Invalid number literal")
    }

    // GUARD (task 2.4). Red comes from mutation (dropping the
    // `expression.trim.isEmpty` short-circuit in `validateRawConfig`), not
    // from un-fixed `main` — an empty expression is already accepted today.
    // Production holds a `compute` step with both `column` and `expression`
    // empty (`NFL Player Season Projections`); this must keep saving.
    "GUARD: accept an empty expression as a savable draft" in {
      ComputeStep.companion.validateRawConfig(config("", "")) shouldBe None
    }

    "GUARD: accept a whitespace-only expression as a savable draft, not a parse error about blank input" in {
      ComputeStep.companion.validateRawConfig(config("total", "   ")) shouldBe None
    }

    // GUARD (task 2.5). The single most valuable guard in the change: red
    // comes from mutation (gating on `validate` instead of `parseProblem`
    // in `validateRawConfig`), demonstrated below. It protects exactly the
    // regression design.md Decision 1 exists to prevent — a bare-identifier
    // expression that still evaluates correctly at run time must remain
    // acceptable at create/update.
    "GUARD: accept a legacy bare-identifier expression that fails strict validate but parses under parseLegacy" in {
      ComputeStep.companion.validateRawConfig(config("revenue", "price * qty")) shouldBe None
    }

    "still reject a non-object top-level config, naming the kind (shared shape check, D3's super call)" in {
      val problem = ComputeStep.companion.validateRawConfig(""""not-an-object"""")
      problem shouldBe defined
      problem.get should include("compute")
    }
  }

  // ── HEL-888 design.md Decision 5: nothing on the read path ──────────────

  "ComputeStep.companion.decodeConfig (the read path)" should {

    // GUARD (task 4.3). Failable by mutation: adding a `parseProblem` check
    // to `ComputeConfig.decode`/`decodeConfig` would make this raise, and
    // `PipelineStepRepository.rowToDomain` turns any decode failure into an
    // `IllegalStateException` backing every read — 500ing the pipeline editor
    // for exactly the steps a user needs to open in order to repair them.
    "GUARD: decode an unparseable stored expression without raising, returning a usable config" in {
      val decoded = ComputeStep.companion
        .decodeConfig("""{"column":"value_vs_adp","expression":"stats.adp_ppr - stats.pts_ppr"}""")
        .asInstanceOf[ComputeConfig]
      decoded.expression shouldBe "stats.adp_ppr - stats.pts_ppr"
      decoded.column shouldBe "value_vs_adp"
    }
  }

  // ── HEL-1315: numeric functions through the compute step ─────────────────

  "ComputeStep.apply with numeric functions" should {

    "produce rounded and bucketed column values, null for bad rows" in {
      val rows = Seq(
        Map[String, Any]("pct" -> 87.345, "n" -> -7.0),
        Map[String, Any]("pct" -> null, "n" -> 7.0),
        Map[String, Any]("pct" -> "x", "n" -> 0.0)
      )
      val rounded = ComputeStep.apply(rows, ComputeConfig("r", "round($pct, 1)", None)).map(_("r"))
      rounded shouldBe Seq(87.3, null, null)
      val bucket = ComputeStep.apply(rows, ComputeConfig("b", "mod($n, 3)", None)).map(_("b"))
      bucket shouldBe Seq(2.0, 1.0, 0.0)
      val byZero = ComputeStep.apply(rows, ComputeConfig("z", "mod($n, 0)", None)).map(_("z"))
      byZero shouldBe Seq(null, null, null)
    }

    "write path rejects an unknown function with the supported-function listing" in {
      val problem = ComputeStep.companion.validateRawConfig(config("v", "reverse($a)"))
      problem shouldBe defined
      problem.get should include("supported functions: abs, ceil, coalesce, concat, floor, length, lower, mod, round, substring, upper")
    }

    "write path accepts round/mod and rejects wrong arity" in {
      ComputeStep.companion.validateRawConfig(config("v", "round($a, 2)")) shouldBe None
      ComputeStep.companion.validateRawConfig(config("v", "mod($a)")).get should include("mod requires 2 arguments")
    }
  }
}
