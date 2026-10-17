// HEL-1581 — cast and datebucket (ports of `CastStep.scala` and `DateBucketStep.scala`).

import { asObject, missingRequired, str, strOpt, stringMap } from "../config";
import {
  epochDayFromCivil,
  epochDayOf,
  epochInstantOfNumber,
  civilFromEpochDay,
  formatDate,
  formatInstant,
  mondayIndex,
  parseInstantString,
  type InstantParts,
} from "../instants";
import {
  doubleToInt,
  doubleToLong,
  javaTrim,
  parseDouble,
  parseJavaBoolean,
  parseJavaInt,
  parseJavaLong,
} from "../javaNumbers";
import { StepConfigError } from "../config";
import {
  anyToString,
  cell,
  int,
  long,
  numericOf,
  put,
  withCell,
  type Row,
  type Value,
} from "../value";
import type { StepHandler } from "./types";

// --- cast --------------------------------------------------------------------------------------------

function castTimestamp(raw: Exclude<Value, null>, text: string): Value {
  if (typeof raw === "string") return parseInstantString(text) ? text : null;
  const n = numericOf(raw);
  const epoch = n === undefined ? undefined : epochInstantOfNumber(n);
  return epoch ? formatInstant(epoch) : null;
}

function castValue(v: Value, dataType: string): Value {
  if (v === null) return null;
  const text = anyToString(v);
  switch (dataType) {
    case "string":
      return text;
    case "integer": {
      const direct = parseJavaInt(text);
      if (direct !== undefined) return int(direct);
      const viaDouble = parseDouble(text);
      return viaDouble === undefined ? null : int(doubleToInt(viaDouble));
    }
    case "long": {
      const direct = parseJavaLong(text);
      if (direct !== undefined) return long(direct);
      const viaDouble = parseDouble(text);
      return viaDouble === undefined ? null : long(doubleToLong(viaDouble));
    }
    case "double":
    case "float":
    case "number": {
      const d = parseDouble(text);
      return d === undefined ? null : d;
    }
    case "boolean": {
      const b = parseJavaBoolean(text);
      return b === undefined ? null : b;
    }
    case "date":
    case "timestamp":
      return castTimestamp(v, text);
    default:
      return v;
  }
}

export const castHandler: StepHandler<{ casts: Record<string, string> }> = {
  stepClass: "client*",
  decode: (raw) => ({ casts: stringMap(asObject(raw), "casts", "field name to type name") }),
  problems: () => [],
  apply(rows, { casts }) {
    const entries = Object.entries(casts);
    return rows.map((row) => {
      const out: Record<string, Value> = { ...row };
      for (const [field, target] of entries) put(out, field, castValue(cell(row, field), target));
      return out;
    });
  },
};

// --- datebucket --------------------------------------------------------------------------------------

interface DateBucketConfig {
  field: string;
  granularity: string;
  outputColumn: string | undefined;
}

const GRANULARITIES = ["day", "week", "month", "quarter", "year"];

function floorFor(granularity: string): (epochDay: bigint) => bigint {
  switch (granularity) {
    case "day":
      return (d) => d;
    case "week":
      return (d) => d - BigInt(mondayIndex(d));
    case "month":
      return (d) => {
        const { year, month } = civilFromEpochDay(d);
        return epochDayFromCivil(year, month, 1);
      };
    case "quarter":
      return (d) => {
        const { year, month } = civilFromEpochDay(d);
        return epochDayFromCivil(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
      };
    case "year":
      return (d) => epochDayFromCivil(civilFromEpochDay(d).year, 1, 1);
    default:
      throw new StepConfigError(
        `Unsupported granularity: '${granularity}'. Valid values: ${GRANULARITIES.join(", ")}.`,
      );
  }
}

/** `TimestampParsing.parseInstant` of any cell: a numeric epoch, or a timestamp string. */
export function parseInstantCell(v: Value): InstantParts | undefined {
  if (v === null) return undefined;
  if (typeof v === "string") return parseInstantString(v);
  const n = numericOf(v);
  return n === undefined ? undefined : epochInstantOfNumber(n);
}

export const dateBucketHandler: StepHandler<DateBucketConfig> = {
  stepClass: "client*",
  decode(raw) {
    const obj = asObject(raw);
    return {
      field: str(obj, "field", ""),
      granularity: str(obj, "granularity", ""),
      outputColumn: strOpt(obj, "outputColumn"),
    };
  },
  problems: (c) => missingRequired("datebucket", [["field", c.field]]),
  apply(rows, config) {
    const floor = floorFor(config.granularity);
    const outputCol =
      config.outputColumn !== undefined && config.outputColumn !== ""
        ? config.outputColumn
        : config.field;
    let nonBlankInputs = 0;
    let nonNullOutputs = 0;
    const result = rows.map((row): Row => {
      const input = cell(row, config.field);
      if (input !== null && javaTrim(anyToString(input)) !== "") nonBlankInputs++;
      const instant = parseInstantCell(input);
      const bucketed = instant ? formatDate(floor(epochDayOf(instant.seconds))) : null;
      if (bucketed !== null) nonNullOutputs++;
      return withCell(row, outputCol, bucketed);
    });
    if (nonBlankInputs > 0 && nonNullOutputs === 0) {
      throw new StepConfigError(
        `datebucket: none of ${nonBlankInputs} row(s) with a value at field '${config.field}' could be parsed as a timestamp/date.`,
      );
    }
    return result;
  },
};
