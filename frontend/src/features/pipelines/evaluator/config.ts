// HEL-1581 — the tolerant-but-typed step-config decoders (port of the Scala `StepCodecUtil` and the
// per-step `*Config.decode`). Absent or `null` key -> the default; a present key of the wrong JSON type
// raises `StepConfigTypeMismatch`, which the walk reports as a step error (the Scala engine cannot even
// load such a step).

import { equalsIgnoreCase, javaTrim } from "./javaNumbers";

export type JsonObject = Readonly<Record<string, unknown>>;

/** A configuration problem detected while evaluating (Scala `StepConfigError`). */
export class StepConfigError extends Error {}

/** A present config key whose JSON type cannot represent the field (Scala `StepConfigTypeMismatch`). */
export class StepConfigTypeMismatch extends StepConfigError {}

const hasOwn = Object.prototype.hasOwnProperty;

function kindName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  switch (typeof v) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    default:
      return "an object";
  }
}

export function mismatch(key: string, expected: string, got: unknown): StepConfigTypeMismatch {
  return new StepConfigTypeMismatch(`'${key}' must be ${expected}, got ${kindName(got)}.`);
}

/** The top-level config object; anything else is a type mismatch. */
export function asObject(raw: unknown): JsonObject {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw mismatch("<config>", "a JSON object", raw);
  }
  return raw as JsonObject;
}

/** A present, non-null value; `null` at a key position is absence. */
function present(obj: JsonObject, key: string): unknown {
  if (!hasOwn.call(obj, key)) return undefined;
  const v = obj[key];
  return v === null || v === undefined ? undefined : v;
}

export function str(obj: JsonObject, key: string, fallback: string): string {
  const v = present(obj, key);
  if (v === undefined) return fallback;
  if (typeof v !== "string") throw mismatch(key, "a string", v);
  return v;
}

export function strOpt(obj: JsonObject, key: string): string | undefined {
  const v = present(obj, key);
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw mismatch(key, "a string", v);
  return v;
}

const isInt32 = (n: number): boolean => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

/** An Int key: a number that is not exactly an Int keeps the default (a value problem, not a type problem). */
export function int(obj: JsonObject, key: string, fallback: number): number {
  const v = present(obj, key);
  if (v === undefined) return fallback;
  if (typeof v !== "number") throw mismatch(key, "a number", v);
  return isInt32(v) ? v : fallback;
}

export function intOpt(obj: JsonObject, key: string): number | undefined {
  const v = present(obj, key);
  if (v === undefined) return undefined;
  if (typeof v !== "number") throw mismatch(key, "a number", v);
  return isInt32(v) ? v : undefined;
}

export function stringArray(obj: JsonObject, key: string): string[] {
  const v = present(obj, key);
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw mismatch(key, "an array of strings", v);
  return v.map((item) => {
    if (typeof item !== "string") {
      throw new StepConfigTypeMismatch(
        `'${key}' must be an array of strings, but one element is ${kindName(item)}.`,
      );
    }
    return item;
  });
}

/** An array of objects read through `reader` (which throws on a bad element). */
export function typedArray<T>(
  obj: JsonObject,
  key: string,
  elementShape: string,
  reader: (item: unknown) => T,
): T[] {
  const v = present(obj, key);
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw mismatch(key, elementShape, v);
  return v.map((item) => {
    try {
      return reader(item);
    } catch {
      throw mismatch(key, elementShape, item);
    }
  });
}

export function objectOpt(obj: JsonObject, key: string): JsonObject | undefined {
  const v = present(obj, key);
  if (v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw mismatch(key, "an object", v);
  return v as JsonObject;
}

export function stringMap(obj: JsonObject, key: string, shape: string): Record<string, string> {
  const v = present(obj, key);
  if (v === undefined) return {};
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new StepConfigTypeMismatch(
      `'${key}' must be an object mapping ${shape}, got ${kindName(v)}.`,
    );
  }
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v as JsonObject)) {
    if (typeof value !== "string") {
      throw new StepConfigTypeMismatch(
        `'${key}' must be an object mapping ${shape}, but '${k}' holds ${kindName(value)}.`,
      );
    }
    Object.defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// --- readers for the spray `jsonFormatN` case classes (a missing non-Option field throws) --------------

export function readObject(item: unknown): JsonObject {
  if (item === null || typeof item !== "object" || Array.isArray(item))
    throw new Error("not an object");
  return item as JsonObject;
}

export function reqString(o: JsonObject, key: string): string {
  const v = hasOwn.call(o, key) ? o[key] : undefined;
  if (typeof v !== "string") throw new Error(`'${key}' must be a string`);
  return v;
}

/** `Option[String]`: absent or `null` is none; any other non-string throws. */
export function optString(o: JsonObject, key: string): string | undefined {
  const v = hasOwn.call(o, key) ? o[key] : undefined;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`'${key}' must be a string`);
  return v;
}

/** `Option[Double]`. */
export function optNumber(o: JsonObject, key: string): number | undefined {
  const v = hasOwn.call(o, key) ? o[key] : undefined;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number") throw new Error(`'${key}' must be a number`);
  return v;
}

// --- shared requiredConfigProblems helpers (HEL-814 D3) --------------------------------------------------

/** One problem per blank (null / empty after Java trim) required value. */
export function missingRequired(
  kind: string,
  fields: ReadonlyArray<readonly [string, string | undefined]>,
): string[] {
  return fields
    .filter(([, value]) => value === undefined || javaTrim(value) === "")
    .map(([key]) => `${kind} step is missing required config value '${key}'.`);
}

/** The supported members, compared case-insensitively (`equalsIgnoreCase`). */
export function unsupportedEnum(
  kind: string,
  key: string,
  value: string,
  supported: readonly string[],
): string[] {
  return supported.some((member) => equalsIgnoreCase(value, member))
    ? []
    : [`Unsupported ${kind} ${key}: '${value}'. Supported: ${supported.join(", ")}`];
}

/** Canonical spelling of `value` when it matches a member case-insensitively, else `value` unchanged. */
export function normalizeEnum(value: string, supported: readonly string[]): string {
  return supported.find((member) => equalsIgnoreCase(value, member)) ?? value;
}
