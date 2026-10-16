// HEL-1581 — window (port of `WindowStep.scala`; the rolling frames are in ./windowRolling.ts).

import {
  StepConfigError,
  asObject,
  intOpt,
  missingRequired,
  readObject,
  reqString,
  str,
  strOpt,
  stringArray,
  typedArray,
} from "../config";
import { equalsIgnoreCase } from "../javaNumbers";
import { KeyBuilder } from "../scalaGroup";
import { cell, int, put, type Row, type Value } from "../value";
import { toDouble } from "./numeric";
import { javaSort } from "../javaTimSort";
import type { StepHandler } from "./types";
import { rollingForPartition } from "./windowRolling";
import {
  ROLLING,
  compareValues,
  rowOrdering,
  type Indexed,
  type SortKey,
  type WindowConfig,
} from "./windowShared";

const SUPPORTED = ["row_number", "rank", "dense_rank", "running_sum", "lag", "lead", ...ROLLING];
const FIELD_REQUIRED = new Set(["running_sum", "lag", "lead", ...ROLLING]);
const MAX_FRAME_SIZE = 1000;
const FRAME_UNITS = ["rows", "days"];

function frameProblems(cfg: WindowConfig): string | undefined {
  if (cfg.frameSize !== undefined && (cfg.frameSize < 1 || cfg.frameSize > MAX_FRAME_SIZE)) {
    return `window function '${cfg.function}' requires 'frameSize' to be an integer in 1..${MAX_FRAME_SIZE}`;
  }
  if (cfg.frameUnit !== undefined && !FRAME_UNITS.includes(cfg.frameUnit)) {
    return `window function '${cfg.function}' has unsupported frameUnit: '${cfg.frameUnit}'`;
  }
  if (
    cfg.frameUnit === "days" &&
    cfg.orderBy.length > 0 &&
    !(cfg.orderBy.length === 1 && !equalsIgnoreCase(cfg.orderBy[0].direction, "desc"))
  ) {
    return `window function '${cfg.function}' with frameUnit 'days' requires exactly one ascending 'orderBy' key`;
  }
  return undefined;
}

function validate(cfg: WindowConfig): void {
  if (!SUPPORTED.includes(cfg.function)) {
    throw new StepConfigError(
      `Unsupported window function: '${cfg.function}'. Supported: ${SUPPORTED.join(", ")}`,
    );
  }
  if (FIELD_REQUIRED.has(cfg.function) && cfg.field === undefined) {
    throw new StepConfigError(`window function '${cfg.function}' requires 'field'`);
  }
  if (ROLLING.includes(cfg.function)) {
    if (cfg.frameSize === undefined)
      throw new StepConfigError(`window function '${cfg.function}' requires 'frameSize'`);
    if (cfg.orderBy.length === 0)
      throw new StepConfigError(`window function '${cfg.function}' requires a non-empty 'orderBy'`);
  }
  if (
    (cfg.function === "lag" || cfg.function === "lead") &&
    cfg.offset !== undefined &&
    cfg.offset <= 0
  ) {
    throw new StepConfigError(
      `window function '${cfg.function}' requires a positive 'offset', got ${cfg.offset}`,
    );
  }
  if (ROLLING.includes(cfg.function)) {
    const problem = frameProblems(cfg);
    if (problem !== undefined) throw new StepConfigError(problem);
  }
}

function orderKeysEqual(a: Row, b: Row, orderBy: readonly SortKey[]): boolean {
  return orderBy.every((key) => compareValues(cell(a, key.field), cell(b, key.field), false) === 0);
}

function computeRank(
  sorted: Indexed[],
  orderBy: readonly SortKey[],
  dense: boolean,
  out: Value[],
): void {
  let rank = 0;
  let denseRank = 0;
  let prev: Row | undefined;
  sorted.forEach(({ row, idx }, pos) => {
    if (prev === undefined || !orderKeysEqual(prev, row, orderBy)) {
      rank = pos + 1;
      denseRank += 1;
    }
    prev = row;
    out[idx] = int(dense ? denseRank : rank);
  });
}

export const windowHandler: StepHandler<WindowConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      partitionBy: stringArray(obj, "partitionBy"),
      orderBy: typedArray(obj, "orderBy", "an array of {field, direction} objects", (item) => {
        const o = readObject(item);
        return { field: reqString(o, "field"), direction: reqString(o, "direction") };
      }),
      function: str(obj, "function", ""),
      field: strOpt(obj, "field"),
      outputColumn: str(obj, "outputColumn", ""),
      offset: intOpt(obj, "offset"),
      frameSize: intOpt(obj, "frameSize"),
      frameUnit: strOpt(obj, "frameUnit"),
    };
  },
  problems: (c) => missingRequired("window", [["outputColumn", c.outputColumn]]),
  apply(rows, cfg) {
    validate(cfg);
    const field = FIELD_REQUIRED.has(cfg.function) ? cfg.field! : "";
    const offset = cfg.function === "lag" || cfg.function === "lead" ? (cfg.offset ?? 1) : 0;
    const keys = new KeyBuilder();
    const partitions = new Map<string, Indexed[]>();
    rows.forEach((row, idx) => {
      const key = keys.tuple(cfg.partitionBy.map((c) => cell(row, c)));
      const list = partitions.get(key);
      if (list) list.push({ row, idx });
      else partitions.set(key, [{ row, idx }]);
    });
    const computed: Value[] = new Array(rows.length).fill(null);
    for (const group of partitions.values()) {
      if (ROLLING.includes(cfg.function)) {
        rollingForPartition(group, cfg, field, computed);
        continue;
      }
      const sorted = javaSort(group, rowOrdering(cfg.orderBy));
      switch (cfg.function) {
        case "row_number":
          sorted.forEach(({ idx }, pos) => {
            computed[idx] = int(pos + 1);
          });
          break;
        case "rank":
        case "dense_rank":
          computeRank(sorted, cfg.orderBy, cfg.function === "dense_rank", computed);
          break;
        case "running_sum": {
          let cumulative = 0;
          for (const { row, idx } of sorted) {
            cumulative += toDouble(cell(row, field)) ?? 0;
            computed[idx] = cumulative;
          }
          break;
        }
        default:
          sorted.forEach(({ idx }, pos) => {
            const target = cfg.function === "lag" ? pos - offset : pos + offset;
            computed[idx] =
              target >= 0 && target < sorted.length ? cell(sorted[target].row, field) : null;
          });
      }
    }
    return rows.map((row, idx) => {
      const out: Record<string, Value> = { ...row };
      put(out, cfg.outputColumn, computed[idx]);
      return out;
    });
  },
};
