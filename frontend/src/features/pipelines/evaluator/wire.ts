// HEL-1581 / HEL-1628 — the lossless wire decoding of the evaluator's value model, shared by the parity corpus
// and the source sample endpoint (schemas/sources/source-sample-response.schema.json, `$defs/cell`).

import { int, long, put, type Row, type Value } from "./value";

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

/** The inverse of [[decodeValue]] (HEL-1630): the lossless request encoding, so a frame the client holds reaches the
 *  draft-preview endpoint with every Int, Long and non-finite or negative-zero double intact. */
export function encodeValue(v: Value): unknown {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { $double: "NaN" };
    if (v === Infinity) return { $double: "Infinity" };
    if (v === -Infinity) return { $double: "-Infinity" };
    if (Object.is(v, -0)) return { $double: "-0.0" };
    return v;
  }
  return v.kind === "int" ? { $int: v.value } : { $long: String(v.value) };
}

export function encodeRow(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row))
    put(out as Record<string, Value>, k, encodeValue(row[k]) as Value);
  return out;
}
