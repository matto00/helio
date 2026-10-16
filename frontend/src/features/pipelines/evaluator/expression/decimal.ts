// HEL-1581 — exact decimal helpers over a double's shortest decimal representation (what Scala's
// `BigDecimal(double)` / `BigDecimal.decimal(double)` start from), used by `round` and `add_days`.

export interface DecimalParts {
  negative: boolean;
  /** The significant digits as an integer (no trailing zeros). */
  digits: bigint;
  /** The decimal exponent of the last digit: value = digits * 10^exponent. */
  exponent: number;
}

export function decimalOf(x: number): DecimalParts {
  const negative = x < 0 || Object.is(x, -0);
  if (x === 0) return { negative: false, digits: 0n, exponent: 0 };
  const [mantissa, exp] = Math.abs(x).toExponential().split("e");
  const digitText = mantissa.replace(".", "");
  const fractionDigits = digitText.length - 1;
  return { negative, digits: BigInt(digitText), exponent: Number(exp) - fractionDigits };
}

/** `BigDecimal.decimal(x).setScale(places, HALF_UP).toDouble`; a non-finite value is returned unchanged. */
export function roundHalfUp(x: number, places: number): number {
  if (!Number.isFinite(x)) return x;
  const { negative, digits, exponent } = decimalOf(x);
  const shift = exponent + places;
  if (shift >= 0) return x === 0 ? 0 : x;
  const divisor = 10n ** BigInt(-shift);
  const q = digits / divisor;
  const rounded = (digits % divisor) * 2n >= divisor ? q + 1n : q;
  if (rounded === 0n) return 0;
  const value = Number(`${rounded}e${-places}`);
  return negative ? -value : value;
}
