// HEL-1581 — compute (port of `ComputeStep.scala`; the expression language is in ../expression/).

import { StepConfigError, asObject, missingRequired, str, strOpt } from "../config";
import { compileExpression } from "../expression/compile";
import { javaTrim } from "../javaNumbers";
import { withCell } from "../value";
import type { ClientDeclineReason, StepHandler } from "./types";

interface ComputeConfig {
  column: string;
  expression: string;
}

export const computeHandler: StepHandler<ComputeConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    strOpt(obj, "type");
    return { column: str(obj, "column", ""), expression: str(obj, "expression", "") };
  },
  problems(c) {
    const base = missingRequired("compute", [
      ["column", c.column],
      ["expression", c.expression],
    ]);
    if (base.length > 0) return base;
    const compiled = compileExpression(c.expression);
    return compiled.kind === "parseError" ? [`invalid expression: ${compiled.message}`] : [];
  },
  declines(c): ClientDeclineReason | undefined {
    if (javaTrim(c.expression) === "") return undefined;
    const compiled = compileExpression(c.expression);
    if (compiled.kind === "legacy") return "legacyExpression";
    return compiled.kind === "unknownFunction" ? "unknownFunction" : undefined;
  },
  apply(rows, { column, expression }) {
    const compiled = compileExpression(expression);
    if (compiled.kind !== "ok") throw new StepConfigError("compute expression did not compile");
    return rows.map((row) => withCell(row, column, compiled.run(row)));
  },
};
