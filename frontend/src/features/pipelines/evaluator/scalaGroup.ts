// HEL-1581 — Scala's `Seq.groupBy` as the engine runs it. Three behaviours are reproduced:
//
//   1. Key equality is Scala's universal `==`: an `Int` 1, a `Long` 1 and the `Double` 1.0 are one key
//      (cooperative numeric equality); a string never equals a number; `-0.0 == 0.0`; a NaN equals
//      nothing but itself, so every NaN cell is its own key.
//   2. The result is an `immutable.HashMap` (scala-library 2.13.15 `IterableOps.groupBy`), so groups come
//      out in CHAMP trie order of `key.##`, NOT first-seen order. `aggregate`, `groupby` and `pivot` emit
//      one row per group in that order, so the row order is part of the output.
//   3. Within a group, rows keep input order.
//
// Hash collisions of the full 32-bit improved hash keep first-seen order (Scala keeps the temporary
// mutable map's order there; a known, vanishingly rare gap).

import { Integral, type Value } from "./value";

const imul = Math.imul;
const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));

/** `String.hashCode`. */
export function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

const f64 = new Float64Array(1);
const f32 = new Float32Array(1);
const u32of64 = new Uint32Array(f64.buffer);
const i32of32 = new Int32Array(f32.buffer);

const longHashOf = (lv: bigint): number =>
  Number(BigInt.asIntN(32, lv ^ (BigInt.asUintN(64, lv) >> 32n)));

/** `Statics.longHash` for a Long that is exactly representable as a JS number. */
function longHash(n: number): number {
  if (n >= -2147483648 && n <= 2147483647) return n | 0;
  return longHashOf(BigInt(n));
}

/** `Statics.doubleHash`: a double that equals an Int, Long or Float hashes as that type. */
function doubleHash(d: number): number {
  if (Number.isInteger(d) && d >= -2147483648 && d <= 2147483647) return d | 0;
  if (Number.isInteger(d) && Math.abs(d) < 2 ** 63) return longHashOf(BigInt(d));
  if (d === 2 ** 63) return longHashOf(2n ** 63n - 1n);
  if (d === -(2 ** 63)) return longHashOf(-(2n ** 63n));
  if (Math.fround(d) === d) {
    f32[0] = d;
    return i32of32[0];
  }
  f64[0] = Number.isNaN(d) ? NaN : d;
  return (u32of64[0] ^ u32of64[1]) | 0;
}

/** Scala `##` of a cell (`null` is 0). */
export function scalaHash(v: Value): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1231 : 1237;
  if (typeof v === "string") return javaStringHash(v);
  if (typeof v === "number") return doubleHash(v);
  return v.kind === "long" ? longHash(v.value) : v.value | 0;
}

function mixLast(hash: number, data: number): number {
  let k = imul(data, 0xcc9e2d51 | 0);
  k = rotl(k, 15);
  k = imul(k, 0x1b873593);
  return hash ^ k;
}

function mix(hash: number, data: number): number {
  const h = rotl(mixLast(hash, data), 13);
  return (imul(h, 5) + (0xe6546b64 | 0)) | 0;
}

function avalanche(hash: number): number {
  let h = hash;
  h ^= h >>> 16;
  h = imul(h, 0x85ebca6b | 0);
  h ^= h >>> 13;
  h = imul(h, 0xc2b2ae35 | 0);
  h ^= h >>> 16;
  return h;
}

const SEQ_SEED = javaStringHash("Seq");

/** `MurmurHash3.indexedSeqHash` of a Vector's element hashes (what `Vector.hashCode` is). */
export function seqHash(values: readonly Value[]): number {
  const n = values.length;
  let h = SEQ_SEED;
  if (n === 0) return avalanche(h ^ 0);
  if (n === 1) return avalanche(mix(h, scalaHash(values[0])) ^ 1);
  const initial = scalaHash(values[0]);
  h = mix(h, initial);
  const h0 = h;
  let prev = scalaHash(values[1]);
  const rangeDiff = (prev - initial) | 0;
  let i = 2;
  while (i < n) {
    h = mix(h, prev);
    const hash = scalaHash(values[i]);
    if (rangeDiff !== ((hash - prev) | 0)) {
      h = mix(h, hash);
      i++;
      while (i < n) {
        h = mix(h, scalaHash(values[i]));
        i++;
      }
      return avalanche(h ^ n);
    }
    prev = hash;
    i++;
  }
  return avalanche(mix(mix(h0, rangeDiff), prev));
}

/** `scala.collection.Hashing.improve`. */
function improve(hcode: number): number {
  let h = (hcode + ~(hcode << 9)) | 0;
  h ^= h >>> 14;
  h = (h + (h << 4)) | 0;
  return h ^ (h >>> 10);
}

/** Builds equality keys with Scala `==` semantics. NaN is unique per occurrence. */
export class KeyBuilder {
  private nan = 0;

  scalar(v: Value): string {
    if (v === null) return "n";
    if (typeof v === "boolean") return v ? "t" : "f";
    if (typeof v === "string") return `s${v.length}:${v}`;
    const n = v instanceof Integral ? v.value : v;
    if (Number.isNaN(n)) return `N${this.nan++}`;
    return `d${n === 0 ? 0 : n}`;
  }

  tuple(values: readonly Value[]): string {
    return values.map((v) => this.scalar(v)).join("|");
  }
}

export interface Group<T> {
  keyValues: Value[];
  items: T[];
  hash: number;
}

/** Entries in CHAMP iteration order: a node's inline entries by ascending 5-bit mask, then each child node. */
function champOrder<T>(
  entries: Array<{ improved: number; item: T }>,
  shift: number,
  out: T[],
): void {
  if (entries.length <= 1 || shift >= 32) {
    for (const e of entries) out.push(e.item);
    return;
  }
  const buckets: Array<Array<{ improved: number; item: T }> | undefined> = new Array(32);
  for (const e of entries) {
    const mask = (e.improved >>> shift) & 31;
    (buckets[mask] ??= []).push(e);
  }
  for (let mask = 0; mask < 32; mask++) {
    const b = buckets[mask];
    if (b && b.length === 1) out.push(b[0].item);
  }
  for (let mask = 0; mask < 32; mask++) {
    const b = buckets[mask];
    if (b && b.length > 1) champOrder(b, shift + 5, out);
  }
}

/** The iteration order of a Scala `Map[String, _]` read from JSON: spray-json parses every object into a sorted
 *  `TreeMap`, so up to four entries (`Map1`..`Map4`) come out in `String.compareTo` (UTF-16 code unit) order, and
 *  from five entries in `immutable.HashMap` (CHAMP hash) order. */
export function scalaMapKeyOrder(keys: readonly string[]): string[] {
  if (keys.length <= 4) return [...keys].sort();
  const out: string[] = [];
  champOrder(
    keys.map((item) => ({ improved: improve(javaStringHash(item)), item })),
    0,
    out,
  );
  return out;
}

/** `items.groupBy(keyValuesOf)` where the key is a Vector of cells; groups in Scala's iteration order. */
export function scalaGroupBy<T>(
  items: readonly T[],
  keyValuesOf: (item: T) => Value[],
): Group<T>[] {
  const keys = new KeyBuilder();
  const byKey = new Map<string, Group<T>>();
  const first: Group<T>[] = [];
  for (const item of items) {
    const keyValues = keyValuesOf(item);
    const key = keys.tuple(keyValues);
    let group = byKey.get(key);
    if (!group) {
      group = { keyValues, items: [], hash: seqHash(keyValues) };
      byKey.set(key, group);
      first.push(group);
    }
    group.items.push(item);
  }
  const out: Group<T>[] = [];
  champOrder(
    first.map((item) => ({ improved: improve(item.hash), item })),
    0,
    out,
  );
  return out;
}

/** `items.groupBy(cell)` where the key is a single cell (pivot's second level). */
export function scalaGroupByValue<T>(items: readonly T[], valueOf: (item: T) => Value): Group<T>[] {
  const keys = new KeyBuilder();
  const byKey = new Map<string, Group<T>>();
  const first: Group<T>[] = [];
  for (const item of items) {
    const value = valueOf(item);
    const key = keys.scalar(value);
    let group = byKey.get(key);
    if (!group) {
      group = { keyValues: [value], items: [], hash: scalaHash(value) };
      byKey.set(key, group);
      first.push(group);
    }
    group.items.push(item);
  }
  const out: Group<T>[] = [];
  champOrder(
    first.map((item) => ({ improved: improve(item.hash), item })),
    0,
    out,
  );
  return out;
}
