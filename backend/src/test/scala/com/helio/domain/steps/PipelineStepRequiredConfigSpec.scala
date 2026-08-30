package com.helio.domain.steps

import com.helio.domain.engine.{InProcessPipelineEngine, PipelineAnalyzeService, SchemaField, StepExecutionException}
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-814 sections 4, 5 and 7 — the RUN and ANALYZE surfaces of D3/D4.
 *
 *  Every assertion here targets ONE of the two surfaces explicitly and says
 *  which, because they are independently reachable: `PipelineRunService` does
 *  not gate on analyze, so an analyze-only implementation would leave
 *  `combinator: "XOR"` silently ANDing on every scheduled run — which is the
 *  defect rather than the fix.
 *
 *  Nothing here asserts that something "did not throw". Each proof asserts the
 *  message names the step kind and the offending field; each guard asserts a
 *  concrete decoded value or a produced row set. */
class PipelineStepRequiredConfigSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/tmp")))(ec)

  private val now = Instant.now()

  private val rows: Seq[Map[String, Any]] = Seq(
    Map("id" -> "1", "amount" -> 10, "region" -> "west"),
    Map("id" -> "1", "amount" -> 20, "region" -> "west"),
    Map("id" -> "2", "amount" -> 30, "region" -> "east")
  )

  /** Run one step through the real engine and return the failure reason, or
   *  fail the test if it unexpectedly succeeded. */
  private def runFailure(step: PipelineStep): StepExecutionException =
    intercept[StepExecutionException] {
      Await.result(engine.execute(rows, Seq(step), null), 5.seconds)
    }

  private def runRows(step: PipelineStep): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, Seq(step), null), 5.seconds)

  /** The analyze surface's own validation output for one step's raw config. */
  private def analyzeError(op: String, config: String): Option[String] =
    PipelineAnalyzeService
      .analyze(
        Vector(PipelineAnalyzeService.PipelineStepInput("step-0", 0, op, config)),
        Vector(SchemaField("id", "string"), SchemaField("amount", "number"), SchemaField("region", "string"))
      )
      .head
      .validationError

  private def analyzed(op: String, config: String) =
    PipelineAnalyzeService
      .analyze(
        Vector(PipelineAnalyzeService.PipelineStepInput("step-0", 0, op, config)),
        Vector(SchemaField("id", "string"), SchemaField("amount", "number"), SchemaField("region", "string"))
      )
      .head

  // ══ 7.3 — missing/empty required values, naming step and field ═══════════

  "The RUN surface (InProcessPipelineEngine)" should {

    // PROOF (7.3). Before this change, this step ran green and appended a
    // field literally named "" to every row — into the output DataType and
    // into every downstream panel bound to it. That is HEL-888's open bug and
    // the case the production measurement found.
    "fail a compute step whose column is empty, naming the step and the field, instead of writing a field named \"\"" in {
      val step = ComputeStep(
        PipelineStepId("compute-1"), PipelineId("p"), 0,
        ComputeConfig(column = "", expression = "$amount * 2", `type` = None), now, now
      )
      val thrown = runFailure(step)
      thrown.stepId shouldBe "compute-1"
      thrown.stepKind shouldBe "compute"
      thrown.reason should include("compute")
      thrown.reason should include("column")

      // Bound to the corruption, not just to the message: the old behavior is
      // asserted absent. `ComputeStep.apply` still produces it if called
      // directly, which is what makes this a real guard on the RUN gate
      // rather than a tautology.
      ComputeStep.apply(rows, ComputeConfig("", "$amount * 2", None)).head.keySet should contain("")
    }

    "fail a compute step whose expression is empty, naming the field" in {
      val step = ComputeStep(
        PipelineStepId("compute-2"), PipelineId("p"), 0,
        ComputeConfig(column = "doubled", expression = "", `type` = None), now, now
      )
      runFailure(step).reason should include("expression")
    }

    // ── HEL-888: a stored compute step with a statically unparseable expression ──

    // PROOF (task 3.1, unit-level companion of the full-fixture proof in
    // PipelineRunServiceSpec). A step shaped exactly like one stored BEFORE
    // write-path validation existed (this spec constructs `ComputeStep`
    // directly, bypassing the new `validateRawConfig` gate). Run on
    // unmodified `main`: succeeds, producing a column of nulls — the
    // production defect.
    "fail a compute step whose expression is unparseable under either grammar, naming the step, kind, and parse error" in {
      val step = ComputeStep(
        PipelineStepId("compute-3"), PipelineId("p"), 0,
        ComputeConfig(column = "value_vs_adp", expression = "stats.adp_ppr - stats.pts_ppr", `type` = None), now, now
      )
      val thrown = runFailure(step)
      thrown.stepId shouldBe "compute-3"
      thrown.stepKind shouldBe "compute"
      thrown.reason should include("Invalid number literal")
    }

    // GUARD (task 3.4). Ordering is load-bearing: an empty expression must
    // report "missing", not a parse error about blank input. Failable by
    // mutation: swap the two branches in `requiredConfigProblems`.
    "GUARD: an empty expression is reported as missing configuration, not a parse error" in {
      // Exact "missing required config value" wording (StepCodecUtil.missingRequired),
      // not a substring check loose enough to also match the parse-error branch's
      // "invalid expression: Expression is empty" wording.
      ComputeStep.companion.requiredConfigProblems("""{"column":"x","expression":""}""") shouldBe
        Vector("compute step is missing required config value 'expression'.")
    }

    // GUARD (task 4.1), ENGINE-LEVEL — a direct `engine.execute` call, i.e. an
    // in-memory function return, NOT materialised rows. evaluation-1.md
    // Change Request 1 caught an earlier version of this comment falsely
    // claiming "on MATERIALISED ROWS, not a function return"; that claim now
    // lives correctly on `PipelineRunServiceSpec`'s
    // "GUARD: a parseable expression over divide-by-zero and null-operand
    // rows persists null for those rows only" test, which runs through the
    // real `service.submit` -> `dataTypeRowRepo.listRows` and is this test's
    // materialised-rows counterpart. This one stays as a fast, DB-free
    // engine-level check of the same behaviour. Measured against unmodified
    // `main` and found already GREEN here too — row-dependent per-row `null`
    // semantics were never broken by this change, only the static-parse case
    // above was. Relabelled from tasks.md's "proof" to guard per the
    // evidence rule: a test is proof only if it is red before the fix, and
    // this one is not. Kept because it is exactly the test that would catch
    // design.md Decision 6 (hoisting the parse out of the row loop)
    // accidentally collapsing the row-dependent case into the
    // row-independent one — failable by mutation (confirmed: evaluating
    // every row against an empty row map instead of that row's own data
    // turns every value null, not just the divide-by-zero/null-operand
    // rows).
    "GUARD: a compute step with a parseable expression over divide-by-zero and null-operand rows — those rows are null, others compute, run succeeds" in {
      val mixedRows: Seq[Map[String, Any]] = Seq(
        Map("id" -> "1", "a" -> 10, "b" -> 2),    // normal: 5.0
        Map("id" -> "2", "a" -> 10, "b" -> 0),    // divide by zero -> null
        Map("id" -> "3", "a" -> null, "b" -> 2),  // null operand -> null
        Map("id" -> "4", "a" -> 20, "b" -> 4)     // normal: 5.0
      )
      val step = ComputeStep(
        PipelineStepId("compute-4"), PipelineId("p"), 0,
        ComputeConfig(column = "ratio", expression = "$a / $b", `type` = None), now, now
      )
      val out = Await.result(engine.execute(mixedRows, Seq(step), null), 5.seconds)
      out.map(_("ratio")) shouldBe Seq(5.0, null, null, 5.0)
    }

    // PROOF (7.3). The runtime-completeness spec's other named scenario.
    "fail a join step whose joinKey is empty, naming the step and the field" in {
      val step = JoinStep(
        PipelineStepId("join-1"), PipelineId("p"), 0,
        JoinConfig(rightDataSourceId = "ds-1", joinKey = "", joinType = "inner"), now, now
      )
      val thrown = runFailure(step)
      thrown.stepKind shouldBe "join"
      thrown.reason should include("joinKey")
    }

    "fail a window step whose outputColumn is empty, rather than appending a column named \"\"" in {
      val step = WindowStep(
        PipelineStepId("window-1"), PipelineId("p"), 0,
        WindowConfig(Vector("region"), Vector(SortKey("amount", "desc")), "row_number", None, "", None), now, now
      )
      runFailure(step).reason should include("outputColumn")
    }

    "fail a stringops step whose outputColumn is empty" in {
      val step = StringOpsStep(
        PipelineStepId("so-1"), PipelineId("p"), 0,
        StringOpsConfig("upper", "region", "", None, None, None, None), now, now
      )
      runFailure(step).reason should include("outputColumn")
    }

    // GUARD for the CONDITIONAL half of the declaration (task 4.1). `concat`
    // genuinely does not read `field` — it reads `fields` — so an
    // unconditional required-field list would fail every valid concat step.
    // Failable by mutation: drop the `operation == "concat"` condition from
    // `StringOpsStep.requiredConfigProblems` and this goes red while the
    // `upper` proof above stays green.
    "GUARD: still RUN a stringops concat step with an empty field, because concat reads `fields` instead" in {
      val step = StringOpsStep(
        PipelineStepId("so-2"), PipelineId("p"), 0,
        StringOpsConfig("concat", "", "joined", None, Some("-"), None, Some(Vector("id", "region"))), now, now
      )
      val out = runRows(step)
      out should have size 3
      out.head("joined") shouldBe "1-west"
    }

    // GUARD: a fully-configured step is unaffected — the runtime-completeness
    // requirement's own "A step with complete configuration is unaffected"
    // scenario. Asserts the produced rows, not the absence of an exception.
    "GUARD: a fully-configured compute step still produces its column and value" in {
      val step = ComputeStep(
        PipelineStepId("compute-ok"), PipelineId("p"), 0,
        ComputeConfig("doubled", "$amount * 2", None), now, now
      )
      val out = runRows(step)
      out should have size 3
      out.map(_("doubled")) shouldBe Seq(20.0, 40.0, 60.0)
    }
  }

  "The ANALYZE surface (PipelineAnalyzeService)" should {

    // PROOF (7.3). The same determination, from the same declaration, on the
    // other surface — reported through the existing `validationError` field
    // with `outputSchema` falling back to `inputSchema`.
    "report a compute step whose column and expression are both empty, and fall back to the input schema" in {
      val step = analyzed("compute", """{"column":"","expression":""}""")
      step.validationError shouldBe defined
      step.validationError.get should include("column")
      step.validationError.get should include("expression")
      step.outputSchema shouldBe step.inputSchema
    }

    "report a join step whose joinKey is empty" in {
      analyzeError("join", """{"rightDataSourceId":"ds-1","joinKey":"","joinType":"inner"}""").get should include("joinKey")
    }

    // PROOF (task 3.5). Design.md Decision 4: analyze reaches an unparseable
    // compute expression through `validateRawConfig` (the write-path
    // override), which `shapeRejection` evaluates FIRST and which
    // short-circuits `requiredConfigProblems` — so this test intentionally
    // asserts by SUBSTRING against the write path's "compute: invalid
    // expression: " prefix, not the run path's "invalid expression: "
    // prefix. Also confirms `outputSchema` falls back to `inputSchema` for a
    // step with a validation error, per the runtime-completeness spec.
    "report a compute step with an unparseable expression, and fall back to the input schema" in {
      val step = analyzed("compute", """{"column":"value_vs_adp","expression":"stats.adp_ppr - stats.pts_ppr"}""")
      step.validationError shouldBe defined
      step.validationError.get should include("Invalid number literal")
      step.outputSchema shouldBe step.inputSchema
    }

    // The combining requirement: two independent failures on one step join
    // into a single message rather than one silently winning.
    "combine a required-value failure with an enum failure on the same step into one message" in {
      val msg = analyzeError("window", """{"function":"bogus_fn","outputColumn":""}""").get
      msg should include("outputColumn")
      msg should include("bogus_fn")
    }
  }

  // ══ 7.4 — enum and numeric coercion, on BOTH surfaces explicitly ═════════

  "filter.combinator" should {

    // PROOF (7.4), ANALYZE surface. The highest-severity finding in the
    // enumeration: an unrecognised combinator silently yielded AND, so an OR
    // filter became an AND filter — changing WHICH ROWS SURVIVE.
    "be reported by ANALYZE when it is XOR, naming the value and the supported set" in {
      val msg = analyzeError("filter", """{"combinator":"XOR","conditions":[{"field":"amount","operator":">","value":"15"}]}""").get
      msg should include("XOR")
      msg should include("AND")
      msg should include("OR")
    }

    // PROOF (7.4), RUN surface — named separately and deliberately, because
    // PipelineRunService does not gate on analyze. An analyze-only fix would
    // leave every scheduled run silently ANDing.
    "fail the RUN when it is XOR, rather than silently applying AND" in {
      val step = FilterStep(
        PipelineStepId("filter-1"), PipelineId("p"), 0,
        FilterConfig("XOR", Vector(FilterCondition("amount", ">", Some("15")))), now, now
      )
      val thrown = runFailure(step)
      thrown.stepKind shouldBe "filter"
      thrown.reason should include("XOR")
      thrown.reason should include("AND, OR")
    }

    // GUARD: a case-variant is honoured rather than rejected — "or" is
    // unambiguous intent on an agent-authored surface. Asserts the row set,
    // so it distinguishes OR from AND behaviourally.
    "GUARD: a lowercase 'or' is honoured as OR on the RUN surface" in {
      val step = FilterStep(
        PipelineStepId("filter-2"), PipelineId("p"), 0,
        FilterConfig("or", Vector(
          FilterCondition("region", "=", Some("east")),
          FilterCondition("amount", "=", Some("10"))
        )), now, now
      )
      // OR keeps the east row AND the amount-10 row; AND would keep neither.
      runRows(step) should have size 2
      analyzeError("filter", """{"combinator":"or","conditions":[]}""") shouldBe None
    }
  }

  "dedupe.keep" should {

    // PROOF (7.4): "LAST" is ACCEPTED, and — the load-bearing half — it
    // actually keeps the LAST row. Asserting only that analyze reports no
    // error would pass even if decode had coerced it to "first".
    "accept LAST on ANALYZE and actually keep the last matching row on RUN" in {
      analyzeError("dedupe", """{"keys":["id"],"keep":"LAST"}""") shouldBe None

      val step = DedupeStep(
        PipelineStepId("dedupe-1"), PipelineId("p"), 0,
        DedupeConfig.decode("""{"keys":["id"],"keep":"LAST"}"""), now, now
      )
      val out = runRows(step)
      out should have size 2
      out.head("amount") shouldBe 20   // the LAST of the two id=1 rows, not the first
    }

    // PROOF (7.4): an unknown value is rejected on both surfaces rather than
    // inverting which row wins.
    "be reported by ANALYZE when it is bogus, naming the value and the supported set" in {
      val msg = analyzeError("dedupe", """{"keys":["id"],"keep":"bogus"}""").get
      msg should include("bogus")
      msg should include("first, last")
    }

    "fail the RUN when it is bogus, rather than silently keeping the first row" in {
      val step = DedupeStep(
        PipelineStepId("dedupe-2"), PipelineId("p"), 0,
        DedupeConfig(Vector("id"), "bogus"), now, now
      )
      runFailure(step).reason should include("bogus")
    }
  }

  "limit.count" should {

    // PROOF (7.4). A count that cannot be represented as the field's numeric
    // type used to narrow to 0, and 0 MEANS UNLIMITED — so the narrowing
    // silently WIDENED the result set to everything.
    val nonRepresentable = """{"count":99999999999999999999}"""

    "be reported by ANALYZE when it is not representable, naming count" in {
      analyzeError("limit", nonRepresentable).get should include("count")
    }

    // The RUN surface is NOT asserted for this one value, and the reason is
    // recorded rather than left as a silent omission. This test pins the
    // boundary so it cannot be mistaken for coverage.
    //
    // `LimitConfig.count` is an `Int`, so `decode` must narrow the supplied
    // number to build the typed config. The run path evaluates the same
    // declaration against `encodeConfig(step.configValue)` — a re-encode of
    // that already-narrowed config — so by then the original number is gone
    // and the predicate sees `{"count":0}`, a shape `pipeline-limit-op:9`
    // explicitly blesses. Every OTHER value in the declaration survives the
    // round trip, which is why D4/5.1b stopped decode from coercing enums;
    // `count` cannot, because its declared type is what loses the value.
    //
    // Closing it would need decode to raise (a stored row would then 500 on
    // listing, over a population the measurement never covered — the exact
    // risk D4 refused to take for enums), a wire-shape change, or threading
    // the stored raw config through the engine. The shipped requirement asks
    // for analyze and only analyze here, so analyze is what is enforced.
    "the RUN surface is knowingly NOT covered for this one value — decode narrows it before the run path can see it" in {
      // Bound to the mechanism, so this documents a measured boundary rather
      // than an assumption: decode really does narrow it to 0, and 0 is a
      // spec-blessed no-op meaning unlimited.
      LimitConfig.decode(nonRepresentable).count shouldBe 0
      LimitStep.companion.requiredConfigProblems(nonRepresentable) should not be empty
      LimitStep.companion.requiredConfigProblems(
        LimitStep.companion.encodeConfig(LimitConfig.decode(nonRepresentable))
      ) shouldBe empty
    }

    // GUARD (D8): a missing, zero or negative count is explicitly blessed by
    // `pipeline-limit-op:9` and its named scenario as a safe no-op returning
    // all rows. Failable by mutation: mark `count` required and this goes red
    // while the non-representable proofs above stay green.
    "GUARD: a zero, negative, or absent count stays a blessed no-op on both surfaces" in {
      analyzeError("limit", """{"count":0}""") shouldBe None
      analyzeError("limit", """{"count":-1}""") shouldBe None
      analyzeError("limit", "{}") shouldBe None

      val step = LimitStep(PipelineStepId("limit-2"), PipelineId("p"), 0, LimitConfig(0), now, now)
      runRows(step) should have size 3
    }
  }

  "chunkbytokencount.encoding and splittext.mode" should {

    "be reported by ANALYZE and fail the RUN when unknown (5.3 sweep)" in {
      val chunkMsg = analyzeError("chunkbytokencount", """{"field":"region","encoding":"not-a-real-encoding"}""").get
      chunkMsg should include("not-a-real-encoding")
      chunkMsg should include("o200k_base, cl100k_base")

      val chunkStep = ChunkByTokenCountStep(
        PipelineStepId("chunk-1"), PipelineId("p"), 0,
        ChunkByTokenCountConfig.decode("""{"field":"region","encoding":"not-a-real-encoding"}"""), now, now
      )
      runFailure(chunkStep).reason should include("not-a-real-encoding")

      val splitMsg = analyzeError("splittext", """{"field":"region","mode":"sentence"}""").get
      splitMsg should include("sentence")
      splitMsg should include("paragraph, heading")

      val splitStep = SplitTextStep(
        PipelineStepId("split-1"), PipelineId("p"), 0,
        SplitTextConfig.decode("""{"field":"region","mode":"sentence"}"""), now, now
      )
      runFailure(splitStep).reason should include("sentence")
    }

    // GUARD: a case-variant is normalized to its canonical member and is not
    // reported by either surface. `splittext` is asserted through analyze;
    // `chunkbytokencount` is asserted through decode + this declaration
    // directly, because its analyze path additionally requires a string-BODY
    // input field (a pre-existing, unrelated check) that this spec's fixture
    // schema deliberately does not provide.
    "GUARD: a case-variant encoding and mode are honoured, not reported as unsupported" in {
      ChunkByTokenCountConfig.decode("""{"field":"content","encoding":"CL100K_BASE"}""").encoding shouldBe "cl100k_base"
      ChunkByTokenCountStep.companion.requiredConfigProblems(
        """{"field":"content","encoding":"CL100K_BASE"}"""
      ) shouldBe empty

      SplitTextConfig.decode("""{"field":"region","mode":"HEADING"}""").mode shouldBe "heading"
      SplitTextStep.companion.requiredConfigProblems("""{"field":"region","mode":"HEADING"}""") shouldBe empty
      // And through the analyze surface: whatever else that surface says
      // about this step (it separately requires a string-BODY input field,
      // which this fixture schema does not provide), it does NOT report the
      // case-variant mode as unsupported.
      analyzeError("splittext", """{"field":"region","mode":"HEADING"}""").getOrElse("") should not include "HEADING"
    }
  }

  // ══ 7.4b — confirm, rather than assume, the swallowing behavior ══════════

  "The analyze surface's wrong-type handling (task 7.4b)" should {

    // The pre-existing `catch { case _: Exception => Vector.empty }` in
    // `validateStepConfig` would swallow the D1 decode raise. This confirms
    // the wrong-type message is NOT lost to it, because `validateRawConfig`
    // is evaluated OUTSIDE that try and RETURNS the problem rather than
    // throwing — which is what keeps the shipped "the proposal analyze
    // surface reports a key the typed decoder would discard" guarantee true.
    "report a wrong-TYPE key rather than swallowing it into an empty problem set" in {
      val msg = analyzeError("pivot", """{"index":"region","column":"quarter","values":"revenue","agg":"sum"}""").get
      msg should include("index")
      msg should include("an array of strings")
    }
  }

  // ══ Enumeration drift guard (task 1.1's both-directions verification) ════

  "The step-kind registry" should {

    // The enumeration in `enumeration.md` is derived from exactly 23 step
    // kinds. If a 24th is added without revisiting that table, its fields get
    // no requiredness verdict and no spec citation — silently. This is the
    // mechanical half of "verified in BOTH directions".
    "hold exactly the 23 kinds the HEL-814 enumeration covers" in {
      PipelineStep.Registry should have size 23
      PipelineStep.Registry.keySet shouldBe Set(
        "aggregate", "assert", "cast", "chunkbytokencount", "compute", "datebucket", "dedupe",
        "extractheadings", "fillnull", "filter", "groupby", "join", "limit", "lookup", "pivot",
        "rename", "select", "sort", "splittext", "stringops", "union", "unpivot", "window"
      )
    }

    // Every kind now answers the write-path question — that is D2's "all 23
    // step kinds" claim, checked mechanically rather than by inspection.
    "reject a wrong-TYPE top-level config on EVERY kind, naming that kind" in {
      PipelineStep.Registry.foreach { case (kind, companion) =>
        val problem = companion.validateRawConfig(""""not-an-object"""")
        withClue(s"step kind '$kind' accepted a non-object config: ") {
          problem shouldBe defined
          problem.get should include(kind)
        }
      }
    }

    // GUARD: and every kind still accepts the empty draft config the "+ Add
    // transformation step" picker seeds. Failable by mutation: make any
    // extractor raise on an absent key and this goes red.
    "GUARD: accept the picker's empty `{}` seed config on EVERY kind" in {
      PipelineStep.Registry.foreach { case (kind, companion) =>
        withClue(s"step kind '$kind' rejected the picker's empty seed config: ") {
          companion.validateRawConfig("{}") shouldBe None
        }
      }
    }
  }
}
