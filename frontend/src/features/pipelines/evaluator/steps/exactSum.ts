// HEL-1581 — an exact running sum of doubles, as Java's `BigDecimal` provides it (`new BigDecimal(double)`
// is the double's exact binary expansion; `add`/`subtract` are exact; `doubleValue` rounds once, to
// nearest-even). Every finite double is `m * 2^-1074` for an integer `m`, so a BigInt of that scaled
// value keeps the sum exact.

const f64 = new Float64Array(1);
const bits = new BigUint64Array(f64.buffer);

/** The exact value of a finite double as an integer multiple of 2^-1074. */
export function toScaled(v: number): bigint {
  f64[0] = v;
  const raw = bits[0];
  const negative = raw >> 63n === 1n;
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & 0xfffffffffffffn;
  const magnitude = exponent === 0 ? fraction : (fraction | (1n << 52n)) << BigInt(exponent - 1);
  return negative ? -magnitude : magnitude;
}

/** Rounds a multiple of 2^-1074 to the nearest double (ties to even), as `BigDecimal.doubleValue`. */
export function fromScaled(n: bigint): number {
  if (n === 0n) return 0;
  const negative = n < 0n;
  const a = negative ? -n : n;
  const bitLength = a.toString(2).length;
  let value: number;
  if (bitLength <= 53) {
    value = Number(a) * 2 ** -537 * 2 ** -537;
  } else {
    const shift = BigInt(bitLength - 53);
    let q = a >> shift;
    const remainder = a & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    if (remainder > half || (remainder === half && (q & 1n) === 1n)) q += 1n;
    const exponent = Number(shift) - 1074;
    value =
      exponent > 970 ? Number(q) * 2 ** 970 * 2 ** (exponent - 970) : Number(q) * 2 ** exponent;
  }
  return negative ? -value : value;
}
