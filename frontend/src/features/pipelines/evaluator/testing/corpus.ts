// HEL-1581 — test support: reads the shared parity corpus (shared-test-fixtures/pipeline-step-parity/) and
// compares frames with the corpus's two-way class comparator. The Scala half is PipelineStepParitySpec.

import { readFileSync } from "fs";
import { resolve } from "path";

import { Integral, int, long, put, type Frame, type Row, type Value } from "../value";

const CORPUS_DIR = resolve(
  __dirname,
  "../../../../../../shared-test-fixtures/pipeline-step-parity",
);

export const readCorpusFile = <T = unknown>(name: string): T =>
  JSON.parse(readFileSync(resolve(CORPUS_DIR, name), "utf8")) as T;

export const corpusFileExists = (name: string): boolean => {
  try {
    readFileSync(resolve(CORPUS_DIR, name));
    return true;
  } catch {
    return false;
  }
};

export interface ManifestKind {
  class: "client" | "client*" | "identity" | "server";
  minVectors: number;
  features: string[];
}
export interface Manifest {
  kinds: Record<string, ManifestKind>;
  notes: string[];
}

/** `{"$int": n}`, `{"$long": "n"}`, `{"$double": "NaN" | ...}`; every other JSON number is a double. */
export function decodeValue(json: unknown): Value {
  if (
    json === null ||
    typeof json === "boolean" ||
    typeof json === "string" ||
    typeof json === "number"
  )
    return json;
  if (typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (typeof o.$int === "number") return int(o.$int);
    if (typeof o.$long === "string") return long(Number(o.$long));
    if (typeof o.$double === "string") {
      switch (o.$double) {
        case "NaN":
          return NaN;
        case "Infinity":
          return Infinity;
        case "-Infinity":
          return -Infinity;
        case "-0.0":
          return -0;
        default:
      }
    }
  }
  throw new Error(`Unsupported corpus value: ${JSON.stringify(json)}`);
}

export function decodeRow(json: unknown): Row {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) put(out, k, decodeValue(v));
  return out;
}

export const decodeRows = (json: unknown): Row[] => (json as unknown[]).map(decodeRow);

function describe(v: Value): string {
  if (v instanceof Integral) return `${v.kind}:${v.value}`;
  if (typeof v === "number") return `double:${Object.is(v, -0) ? "-0" : v}`;
  return JSON.stringify(v);
}

function valuesEqual(a: Value, b: Value): boolean {
  if (a instanceof Integral || b instanceof Integral) {
    return (
      a instanceof Integral && b instanceof Integral && a.kind === b.kind && a.value === b.value
    );
  }
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b);
  return a === b;
}

/** `undefined` when equal (row order matters, column order does not), otherwise what differs. */
export function diffFrames(actual: Frame, expected: Frame): string | undefined {
  if (actual.length !== expected.length) {
    return `row count ${actual.length} != expected ${expected.length}\n  actual:   ${show(actual)}\n  expected: ${show(expected)}`;
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    const keys = Object.keys(a);
    const sameKeys =
      keys.length === Object.keys(e).length &&
      keys.every((k) => Object.prototype.hasOwnProperty.call(e, k));
    if (!sameKeys || !keys.every((k) => valuesEqual(a[k], e[k]))) {
      return `row ${i} differs\n  actual:   ${show([a])}\n  expected: ${show([e])}`;
    }
  }
  return undefined;
}

export const show = (rows: Frame): string =>
  JSON.stringify(
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, describe(v)]))),
  );
