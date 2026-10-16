// HEL-1581 — assert and upsertsource: identity kinds. Rows pass through; `assert` records no verdicts
// and `upsertsource` writes nothing (it is flagged `writesOnSave`).
//
// Deliberate gap: Scala's `UpsertSourceStep.checkTarget` can fail an `ExistingSource` target at run time
// (owner unknown, target missing or not writable); the client skips that check, so such a step can
// still fail at Save & run.

import { StepConfigTypeMismatch, asObject, mismatch, objectOpt, str, strOpt } from "../config";
import { javaTrim } from "../javaNumbers";
import type { StepHandler } from "./types";

const hasOwn = Object.prototype.hasOwnProperty;

interface AssertConfig {
  rules: unknown[];
}

export const assertHandler: StepHandler<AssertConfig> = {
  stepClass: "identity",
  decode(raw) {
    const obj = asObject(raw);
    const rules = hasOwn.call(obj, "rules") ? obj.rules : undefined;
    if (rules === undefined || rules === null) return { rules: [] };
    if (!Array.isArray(rules)) {
      throw new StepConfigTypeMismatch(
        "'rules' must be an array of {kind, field, params, severity} objects.",
      );
    }
    for (const item of rules) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new StepConfigTypeMismatch(
          "'rules' must be an array of {kind, field, params, severity} objects.",
        );
      }
      const rule = item as Record<string, unknown>;
      str(rule, "kind", "");
      strOpt(rule, "field");
      objectOpt(rule, "params");
      str(rule, "severity", "warn");
    }
    return { rules };
  },
  problems: () => [],
  apply: (rows) => rows,
};

interface UpsertSourceConfig {
  target: { kind: "newSource"; name: string } | { kind: "existingSource"; dataSourceId: string };
  mode: string;
}

function decodeTarget(v: unknown): UpsertSourceConfig["target"] {
  if (v === undefined || v === null) return { kind: "existingSource", dataSourceId: "" };
  if (typeof v !== "object" || Array.isArray(v)) throw mismatch("target", "an object", v);
  const o = v as Record<string, unknown>;
  if (o.kind === "newSource")
    return { kind: "newSource", name: typeof o.name === "string" ? o.name : "" };
  if (o.kind === "existingSource") {
    if (typeof o.dataSourceId !== "string")
      throw new StepConfigTypeMismatch("'target' needs a string 'dataSourceId'.");
    return { kind: "existingSource", dataSourceId: o.dataSourceId };
  }
  throw new StepConfigTypeMismatch("'target.kind' must be 'newSource' or 'existingSource'.");
}

export const upsertSourceHandler: StepHandler<UpsertSourceConfig> = {
  stepClass: "identity",
  writesOnSave: true,
  decode(raw) {
    const obj = asObject(raw);
    return {
      target: decodeTarget(hasOwn.call(obj, "target") ? obj.target : undefined),
      mode: str(obj, "mode", "append"),
    };
  },
  problems(c) {
    if (c.target.kind === "existingSource" && javaTrim(c.target.dataSourceId) === "") {
      return [
        "'upsertsource' step requires a 'target' (an existing data source or a new source name)",
      ];
    }
    if (c.target.kind === "newSource" && javaTrim(c.target.name) === "") {
      return ["'upsertsource' step requires a non-empty 'target.name' for a new source"];
    }
    return [];
  },
  apply: (rows) => rows,
};
