// HEL-1581 — the client evaluator's value model. A frame cell reproduces the JVM classes whose
// differences show up in a pipeline's output: null, Boolean, String, Double, and an integral
// (Scala Int / Long). A double is a plain JS number (the fast path: every JSON number entering the
// engine is a Double, PipelineRowJson.jsValueToAny); an integral is an `Integral` instance, so
// `cast integer` 1 and the JSON number 1 stay different classes, as they are on the JVM.

/** An `Int` or `Long` cell. Long precision beyond 2^53 is a known gap (manifest notes). */
export class Integral {
  constructor(
    readonly value: number,
    readonly kind: "int" | "long",
  ) {}
}

export type Value = null | boolean | string | number | Integral;
export type Row = Readonly<Record<string, Value>>;
export type Frame = ReadonlyArray<Row>;

export const int = (n: number): Integral => new Integral(n, "int");
export const long = (n: number): Integral => new Integral(n, "long");
export const isIntegral = (v: Value): v is Integral => v instanceof Integral;

const hasOwn = Object.prototype.hasOwnProperty;

/** `row.getOrElse(key, null)`: an own key only, so a column named `constructor` is not inherited. */
export function cell(row: Row, key: string): Value {
  if (!hasOwn.call(row, key)) return null;
  const v = row[key];
  return v === undefined ? null : v;
}

export const hasKey = (row: Row, key: string): boolean => hasOwn.call(row, key);

/** A copy of `row` with `key` set; `__proto__` is defined as an own key rather than invoking the setter. */
export function put(row: Record<string, Value>, key: string, value: Value): void {
  if (key === "__proto__") {
    Object.defineProperty(row, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    row[key] = value;
  }
}

export function withCell(row: Row, key: string, value: Value): Row {
  const out: Record<string, Value> = { ...row };
  put(out, key, value);
  return out;
}

/** The numeric view of a numeric cell (double or integral). */
export function numericOf(v: Value): number | undefined {
  if (typeof v === "number") return v;
  if (v instanceof Integral) return v.value;
  return undefined;
}

// --- Java Double.toString (JDK 19+: shortest round-tripping digits, formatted the Java way) -------

/** `Double.toString`: `1.0`, `0.001`, `1.0E-4`, `1.0E7`, `-0.0`, `NaN`, `Infinity`. */
export function javaDoubleToString(d: number): string {
  if (Number.isNaN(d)) return "NaN";
  if (d === Infinity) return "Infinity";
  if (d === -Infinity) return "-Infinity";
  if (d === 0) return Object.is(d, -0) ? "-0.0" : "0.0";
  const negative = d < 0;
  const abs = Math.abs(d);
  let [mantissa, exponentText] = abs.toExponential().split("e");
  // Java never prints a single digit: when the shortest form has one, it prints the closest two-digit decimal.
  if (!mantissa.includes(".")) {
    const two = abs.toExponential(1);
    if (Number(two) === abs) [mantissa, exponentText] = two.split("e");
  }
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  let text: string;
  if (abs >= 1e-3 && abs < 1e7) {
    if (exponent >= 0) {
      const whole =
        digits.length > exponent + 1
          ? digits.slice(0, exponent + 1)
          : digits.padEnd(exponent + 1, "0");
      const fraction = digits.length > exponent + 1 ? digits.slice(exponent + 1) : "0";
      text = `${whole}.${fraction.replace(/0+$/, "") || "0"}`;
    } else {
      text = `0.${"0".repeat(-exponent - 1)}${digits.replace(/0+$/, "") || "0"}`;
    }
  } else {
    const rest = digits.slice(1).replace(/0+$/, "");
    text = `${digits[0]}.${rest || "0"}E${exponent}`;
  }
  return negative ? `-${text}` : text;
}

/** `Any.toString` for a non-null cell. */
export function anyToString(v: Exclude<Value, null>): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return javaDoubleToString(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v.value);
}

/** JSON output per `anyToJsValue`: an integral or double is a JSON number; a non-finite double is `null`
 *  (spray's `JsNumber(Double)`); a double -0 prints as 0 (BigDecimal has no negative zero). */
export function toJsonValue(v: Value): null | boolean | string | number {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return v === 0 ? 0 : v;
  }
  return v.value;
}

export function toJsonRows(rows: Frame): Array<Record<string, null | boolean | string | number>> {
  return rows.map((row) => {
    const out: Record<string, null | boolean | string | number> = {};
    for (const key of Object.keys(row))
      put(out as Record<string, Value>, key, toJsonValue(row[key]));
    return out;
  });
}
