package com.helio.domain.engine

import com.helio.domain.engine.AnalyzeSchemaWarnings.Warning
import com.helio.domain.engine.PipelineAnalyzeService.{AnalyzedStep, NodeStepInput}
import com.helio.domain.steps.ComputeConfig

import scala.util.Try

/** The three non-blocking `compute` operand-type warnings (HEL-1403, HEL-1455), split out of
 *  [[AnalyzeSchemaWarnings]]. Every one is schema-only and fires only for a valid, enabled compute step. */
private[engine] object ComputeTypeWarnings {

  val NumericOpOnTextField: String       = "numeric-op-on-text-field"
  val TextFunctionOnNumericField: String = "text-function-on-numeric-field"
  val LiteralTypeMismatch: String        = "literal-type-mismatch"

  /** @param typesTrusted whether the step's input types equal the run-time value classes at all
   *  @param untrusted    columns of a trusted input that are nonetheless not (written by an earlier compute) */
  def apply(step: NodeStepInput, a: AnalyzedStep, typesTrusted: Boolean, untrusted: Set[String]): Vector[Warning] =
    Try(ComputeConfig.decode(step.config)).toOption.fold(Vector.empty[Warning]) { cfg =>
      val types = a.inputSchema.map(sf => sf.name -> sf.`type`).toMap
      val fromTypes =
        if (!typesTrusted) Vector.empty[Warning]
        else numericOps(step, cfg, types, untrusted) ++ textFunctions(step, cfg, types, untrusted)
      fromTypes ++ literals(step, cfg)
    }

  private def numericOps(step: NodeStepInput, cfg: ComputeConfig, types: Map[String, String], untrusted: Set[String]): Vector[Warning] =
    ExpressionEvaluator.numericContextTextFields(cfg.expression, types).filterNot { case (field, _) => untrusted.contains(field) }.map {
      case (field, contexts) =>
        // A cast cannot help a timestamp: its string does not cast to a number, so point at the date functions.
        val fix =
          if (types(field) == "timestamp") "use seconds_between(end, start) for a time difference or add_days(ts, n) for an offset"
          else "add a cast step before this step to convert it to a number"
        Warning(
          step.id,
          NumericOpOnTextField,
          s"compute: field '$field' is ${types(field)} in this step's inferred input schema but is used with ${contexts.mkString(", ")}; " +
            s"every non-null row will compute null at run time -- $fix"
        )
    }

  private def textFunctions(step: NodeStepInput, cfg: ComputeConfig, types: Map[String, String], untrusted: Set[String]): Vector[Warning] =
    ExpressionEvaluator.numericFieldsInTextFunction(cfg.expression, types, untrusted).filterNot { case (field, _) => untrusted.contains(field) }.map {
      case (field, functions) =>
        Warning(
          step.id,
          TextFunctionOnNumericField,
          s"compute: field '$field' is ${types(field)} in this step's inferred input schema but is passed to ${functions.mkString(", ")}, " +
            "which needs text; every non-null row will compute null at run time -- wrap it in concat(...) or add a cast step to convert it to text"
        )
    }

  private def literals(step: NodeStepInput, cfg: ComputeConfig): Vector[Warning] =
    ExpressionEvaluator.wrongTypeLiterals(cfg.expression).map { case (literal, context) =>
      val kind = if (literal.startsWith("\"")) "string literal" else "number literal"
      val need = if (literal.startsWith("\"")) "a number" else "text"
      Warning(
        step.id,
        LiteralTypeMismatch,
        s"compute: the $kind $literal is used with $context, which needs $need; every row will compute null at run time"
      )
    }
}
