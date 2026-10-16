// HEL-1581 — stringops (port of `StringOpsStep.scala`).

import {
  StepConfigError,
  asObject,
  intOpt,
  missingRequired,
  str,
  strOpt,
  stringArray,
} from "../config";
import { javaTrim } from "../javaNumbers";
import { compileJavaRegex } from "../javaRegex";
import { anyToString, cell, withCell, type Row, type Value } from "../value";
import type { ClientDeclineReason, StepHandler } from "./types";

interface StringOpsConfig {
  operation: string;
  field: string;
  outputColumn: string;
  pattern: string | undefined;
  separator: string | undefined;
  index: number | undefined;
  fields: string[] | undefined;
}

const OPERATIONS = ["trim", "upper", "lower", "split", "extractRegex", "concat"];

/** `String.split(Pattern.quote(separator), -1)`. */
function javaSplitLiteral(s: string, separator: string): string[] {
  if (separator === "") return s === "" ? [""] : [...s.split(""), ""];
  return s.split(separator);
}

function valueFn(cfg: StringOpsConfig): (row: Row) => Value {
  const single =
    (fn: (s: string) => string) =>
    (row: Row): Value => {
      const v = cell(row, cfg.field);
      return v === null ? null : fn(anyToString(v));
    };
  switch (cfg.operation) {
    case "trim":
      return single(javaTrim);
    case "upper":
      return single((s) => s.toUpperCase());
    case "lower":
      return single((s) => s.toLowerCase());
    case "split": {
      if (cfg.separator === undefined)
        throw new StepConfigError("stringops operation 'split' requires 'separator'");
      if (cfg.index === undefined)
        throw new StepConfigError("stringops operation 'split' requires 'index'");
      const { separator, index } = cfg;
      return (row) => {
        const v = cell(row, cfg.field);
        if (v === null) return null;
        const parts = javaSplitLiteral(anyToString(v), separator);
        return index >= 0 && index < parts.length ? parts[index] : null;
      };
    }
    case "extractRegex": {
      if (cfg.pattern === undefined)
        throw new StepConfigError("stringops operation 'extractRegex' requires 'pattern'");
      const compiled = compileJavaRegex(cfg.pattern);
      if (!compiled.ok)
        throw new StepConfigError("extractRegex pattern is outside the client regex allowlist");
      if (compiled.groupCount < 1) {
        throw new StepConfigError(
          `stringops operation 'extractRegex' pattern '${cfg.pattern}' requires at least one capturing group`,
        );
      }
      return (row) => {
        const v = cell(row, cfg.field);
        if (v === null) return null;
        const m = compiled.regex.exec(anyToString(v));
        return m && m[1] !== undefined ? m[1] : null;
      };
    }
    default: {
      const fields = cfg.fields ?? [];
      const separator = cfg.separator ?? "";
      return (row) =>
        fields
          .map((f) => {
            const v = cell(row, f);
            return v === null ? "" : anyToString(v);
          })
          .join(separator);
    }
  }
}

export const stringOpsHandler: StepHandler<StringOpsConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    const hasFields = obj.fields !== undefined && obj.fields !== null;
    return {
      operation: str(obj, "operation", ""),
      field: str(obj, "field", ""),
      outputColumn: str(obj, "outputColumn", ""),
      pattern: strOpt(obj, "pattern"),
      separator: strOpt(obj, "separator"),
      index: intOpt(obj, "index"),
      fields: hasFields ? stringArray(obj, "fields") : undefined,
    };
  },
  problems: (c) => [
    ...(c.operation === "concat" ? [] : missingRequired("stringops", [["field", c.field]])),
    ...missingRequired("stringops", [["outputColumn", c.outputColumn]]),
  ],
  declines(c): ClientDeclineReason | undefined {
    if (
      c.operation === "extractRegex" &&
      c.pattern !== undefined &&
      !compileJavaRegex(c.pattern).ok
    )
      return "unsafeRegex";
    return undefined;
  },
  apply(rows, cfg) {
    if (!OPERATIONS.includes(cfg.operation)) {
      throw new StepConfigError(
        `Unsupported stringops operation: '${cfg.operation}'. Supported: ${OPERATIONS.join(", ")}`,
      );
    }
    const fn = valueFn(cfg);
    return rows.map((row) => withCell(row, cfg.outputColumn, fn(row)));
  },
};
