// HEL-1581 — a faithful port of java.util.TimSort as reached by `Arrays.sort(T[], Comparator)` (JDK 21), which is
// what Scala's `Seq.sorted` / `sortWith` / `sortBy` call. The result is identical to Java's for ANY comparator,
// including a non-transitive one (the window `orderBy` over a mixed numeric/text column): the same binary
// insertion run below 32 elements, the same run detection, merge stack invariants and galloping above, and the
// same "Comparison method violates its general contract!" failure, which Scala surfaces as a step error.

import { StepConfigError } from "./config";

const MIN_MERGE = 32;
const MIN_GALLOP = 7;

export type Comparator<T> = (a: T, b: T) => number;

const violation = (): never => {
  throw new StepConfigError("Comparison method violates its general contract!");
};

/** Sorts `input` into a new array, like `java.util.Arrays.sort(copy, c)`. */
export function javaSort<T>(input: readonly T[], c: Comparator<T>): T[] {
  const a = [...input];
  sortRange(a, c);
  return a;
}

function minRunLength(length: number): number {
  let n = length;
  let r = 0;
  while (n >= MIN_MERGE) {
    r |= n & 1;
    n >>= 1;
  }
  return n + r;
}

function reverseRange<T>(a: T[], lo: number, hi: number): void {
  for (let i = lo, j = hi - 1; i < j; i++, j--) [a[i], a[j]] = [a[j], a[i]];
}

function countRunAndMakeAscending<T>(a: T[], lo: number, hi: number, c: Comparator<T>): number {
  let runHi = lo + 1;
  if (runHi === hi) return 1;
  if (c(a[runHi++], a[lo]) < 0) {
    while (runHi < hi && c(a[runHi], a[runHi - 1]) < 0) runHi++;
    reverseRange(a, lo, runHi);
  } else {
    while (runHi < hi && c(a[runHi], a[runHi - 1]) >= 0) runHi++;
  }
  return runHi - lo;
}

function binarySort<T>(a: T[], lo: number, hi: number, startIn: number, c: Comparator<T>): void {
  let start = startIn === lo ? startIn + 1 : startIn;
  for (; start < hi; start++) {
    const pivot = a[start];
    let left = lo;
    let right = start;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (c(pivot, a[mid]) < 0) right = mid;
      else left = mid + 1;
    }
    for (let p = start; p > left; p--) a[p] = a[p - 1];
    a[left] = pivot;
  }
}

function sortRange<T>(a: T[], c: Comparator<T>): void {
  let lo = 0;
  const hi = a.length;
  let remaining = hi - lo;
  if (remaining < 2) return;
  if (remaining < MIN_MERGE) {
    const initRunLen = countRunAndMakeAscending(a, lo, hi, c);
    binarySort(a, lo, hi, lo + initRunLen, c);
    return;
  }
  const ts = new TimSort(a, c);
  const minRun = minRunLength(remaining);
  do {
    let runLen = countRunAndMakeAscending(a, lo, hi, c);
    if (runLen < minRun) {
      const force = remaining <= minRun ? remaining : minRun;
      binarySort(a, lo, lo + force, lo + runLen, c);
      runLen = force;
    }
    ts.pushRun(lo, runLen);
    ts.mergeCollapse();
    lo += runLen;
    remaining -= runLen;
  } while (remaining !== 0);
  ts.mergeForceCollapse();
}

function gallopLeft<T>(
  key: T,
  a: T[],
  base: number,
  len: number,
  hint: number,
  c: Comparator<T>,
): number {
  let lastOfs = 0;
  let ofs = 1;
  if (c(key, a[base + hint]) > 0) {
    const maxOfs = len - hint;
    while (ofs < maxOfs && c(key, a[base + hint + ofs]) > 0) {
      lastOfs = ofs;
      ofs = (ofs << 1) + 1;
      if (ofs <= 0) ofs = maxOfs;
    }
    if (ofs > maxOfs) ofs = maxOfs;
    lastOfs += hint;
    ofs += hint;
  } else {
    const maxOfs = hint + 1;
    while (ofs < maxOfs && c(key, a[base + hint - ofs]) <= 0) {
      lastOfs = ofs;
      ofs = (ofs << 1) + 1;
      if (ofs <= 0) ofs = maxOfs;
    }
    if (ofs > maxOfs) ofs = maxOfs;
    const tmp = lastOfs;
    lastOfs = hint - ofs;
    ofs = hint - tmp;
  }
  lastOfs++;
  while (lastOfs < ofs) {
    const m = lastOfs + ((ofs - lastOfs) >>> 1);
    if (c(key, a[base + m]) > 0) lastOfs = m + 1;
    else ofs = m;
  }
  return ofs;
}

function gallopRight<T>(
  key: T,
  a: T[],
  base: number,
  len: number,
  hint: number,
  c: Comparator<T>,
): number {
  let ofs = 1;
  let lastOfs = 0;
  if (c(key, a[base + hint]) < 0) {
    const maxOfs = hint + 1;
    while (ofs < maxOfs && c(key, a[base + hint - ofs]) < 0) {
      lastOfs = ofs;
      ofs = (ofs << 1) + 1;
      if (ofs <= 0) ofs = maxOfs;
    }
    if (ofs > maxOfs) ofs = maxOfs;
    const tmp = lastOfs;
    lastOfs = hint - ofs;
    ofs = hint - tmp;
  } else {
    const maxOfs = len - hint;
    while (ofs < maxOfs && c(key, a[base + hint + ofs]) >= 0) {
      lastOfs = ofs;
      ofs = (ofs << 1) + 1;
      if (ofs <= 0) ofs = maxOfs;
    }
    if (ofs > maxOfs) ofs = maxOfs;
    lastOfs += hint;
    ofs += hint;
  }
  lastOfs++;
  while (lastOfs < ofs) {
    const m = lastOfs + ((ofs - lastOfs) >>> 1);
    if (c(key, a[base + m]) < 0) ofs = m;
    else lastOfs = m + 1;
  }
  return ofs;
}

function copyWithin<T>(src: T[], srcPos: number, dst: T[], dstPos: number, n: number): void {
  if (src === dst && srcPos < dstPos)
    for (let i = n - 1; i >= 0; i--) dst[dstPos + i] = src[srcPos + i];
  else for (let i = 0; i < n; i++) dst[dstPos + i] = src[srcPos + i];
}

class TimSort<T> {
  private minGallop = MIN_GALLOP;
  private readonly runBase: number[] = [];
  private readonly runLen: number[] = [];
  private stackSize = 0;

  constructor(
    private readonly a: T[],
    private readonly c: Comparator<T>,
  ) {}

  pushRun(base: number, len: number): void {
    this.runBase[this.stackSize] = base;
    this.runLen[this.stackSize] = len;
    this.stackSize++;
  }

  mergeCollapse(): void {
    const runLen = this.runLen;
    while (this.stackSize > 1) {
      let n = this.stackSize - 2;
      if (
        (n > 0 && runLen[n - 1] <= runLen[n] + runLen[n + 1]) ||
        (n > 1 && runLen[n - 2] <= runLen[n] + runLen[n - 1])
      ) {
        if (runLen[n - 1] < runLen[n + 1]) n--;
      } else if (n < 0 || runLen[n] > runLen[n + 1]) {
        break;
      }
      this.mergeAt(n);
    }
  }

  mergeForceCollapse(): void {
    while (this.stackSize > 1) {
      let n = this.stackSize - 2;
      if (n > 0 && this.runLen[n - 1] < this.runLen[n + 1]) n--;
      this.mergeAt(n);
    }
  }

  private mergeAt(i: number): void {
    const { a, c, runBase, runLen } = this;
    let base1 = runBase[i];
    let len1 = runLen[i];
    const base2 = runBase[i + 1];
    let len2 = runLen[i + 1];
    runLen[i] = len1 + len2;
    if (i === this.stackSize - 3) {
      runBase[i + 1] = runBase[i + 2];
      runLen[i + 1] = runLen[i + 2];
    }
    this.stackSize--;
    const k = gallopRight(a[base2], a, base1, len1, 0, c);
    base1 += k;
    len1 -= k;
    if (len1 === 0) return;
    len2 = gallopLeft(a[base1 + len1 - 1], a, base2, len2, len2 - 1, c);
    if (len2 === 0) return;
    if (len1 <= len2) this.mergeLo(base1, len1, base2, len2);
    else this.mergeHi(base1, len1, base2, len2);
  }

  private mergeLo(base1: number, len1In: number, base2: number, len2In: number): void {
    const { a, c } = this;
    let len1 = len1In;
    let len2 = len2In;
    const tmp = a.slice(base1, base1 + len1);
    let cursor1 = 0;
    let cursor2 = base2;
    let dest = base1;
    a[dest++] = a[cursor2++];
    if (--len2 === 0) {
      copyWithin(tmp, cursor1, a, dest, len1);
      return;
    }
    if (len1 === 1) {
      copyWithin(a, cursor2, a, dest, len2);
      a[dest + len2] = tmp[cursor1];
      return;
    }
    let minGallop = this.minGallop;
    outer: for (;;) {
      let count1 = 0;
      let count2 = 0;
      do {
        if (c(a[cursor2], tmp[cursor1]) < 0) {
          a[dest++] = a[cursor2++];
          count2++;
          count1 = 0;
          if (--len2 === 0) break outer;
        } else {
          a[dest++] = tmp[cursor1++];
          count1++;
          count2 = 0;
          if (--len1 === 1) break outer;
        }
      } while ((count1 | count2) < minGallop);
      do {
        count1 = gallopRight(a[cursor2], tmp, cursor1, len1, 0, c);
        if (count1 !== 0) {
          copyWithin(tmp, cursor1, a, dest, count1);
          dest += count1;
          cursor1 += count1;
          len1 -= count1;
          if (len1 <= 1) break outer;
        }
        a[dest++] = a[cursor2++];
        if (--len2 === 0) break outer;
        count2 = gallopLeft(tmp[cursor1], a, cursor2, len2, 0, c);
        if (count2 !== 0) {
          copyWithin(a, cursor2, a, dest, count2);
          dest += count2;
          cursor2 += count2;
          len2 -= count2;
          if (len2 === 0) break outer;
        }
        a[dest++] = tmp[cursor1++];
        if (--len1 === 1) break outer;
        minGallop--;
      } while (count1 >= MIN_GALLOP || count2 >= MIN_GALLOP);
      if (minGallop < 0) minGallop = 0;
      minGallop += 2;
    }
    this.minGallop = minGallop < 1 ? 1 : minGallop;
    if (len1 === 1) {
      copyWithin(a, cursor2, a, dest, len2);
      a[dest + len2] = tmp[cursor1];
    } else if (len1 === 0) {
      violation();
    } else {
      copyWithin(tmp, cursor1, a, dest, len1);
    }
  }

  private mergeHi(base1: number, len1In: number, base2: number, len2In: number): void {
    const { a, c } = this;
    let len1 = len1In;
    let len2 = len2In;
    const tmp = a.slice(base2, base2 + len2);
    let cursor1 = base1 + len1 - 1;
    let cursor2 = len2 - 1;
    let dest = base2 + len2 - 1;
    a[dest--] = a[cursor1--];
    if (--len1 === 0) {
      copyWithin(tmp, 0, a, dest - (len2 - 1), len2);
      return;
    }
    if (len2 === 1) {
      dest -= len1;
      cursor1 -= len1;
      copyWithin(a, cursor1 + 1, a, dest + 1, len1);
      a[dest] = tmp[cursor2];
      return;
    }
    let minGallop = this.minGallop;
    outer: for (;;) {
      let count1 = 0;
      let count2 = 0;
      do {
        if (c(tmp[cursor2], a[cursor1]) < 0) {
          a[dest--] = a[cursor1--];
          count1++;
          count2 = 0;
          if (--len1 === 0) break outer;
        } else {
          a[dest--] = tmp[cursor2--];
          count2++;
          count1 = 0;
          if (--len2 === 1) break outer;
        }
      } while ((count1 | count2) < minGallop);
      do {
        count1 = len1 - gallopRight(tmp[cursor2], a, base1, len1, len1 - 1, c);
        if (count1 !== 0) {
          dest -= count1;
          cursor1 -= count1;
          len1 -= count1;
          copyWithin(a, cursor1 + 1, a, dest + 1, count1);
          if (len1 === 0) break outer;
        }
        a[dest--] = tmp[cursor2--];
        if (--len2 === 1) break outer;
        count2 = len2 - gallopLeft(a[cursor1], tmp, 0, len2, len2 - 1, c);
        if (count2 !== 0) {
          dest -= count2;
          cursor2 -= count2;
          len2 -= count2;
          copyWithin(tmp, cursor2 + 1, a, dest + 1, count2);
          if (len2 <= 1) break outer;
        }
        a[dest--] = a[cursor1--];
        if (--len1 === 0) break outer;
        minGallop--;
      } while (count1 >= MIN_GALLOP || count2 >= MIN_GALLOP);
      if (minGallop < 0) minGallop = 0;
      minGallop += 2;
    }
    this.minGallop = minGallop < 1 ? 1 : minGallop;
    if (len2 === 1) {
      dest -= len1;
      cursor1 -= len1;
      copyWithin(a, cursor1 + 1, a, dest + 1, len1);
      a[dest] = tmp[cursor2];
    } else if (len2 === 0) {
      violation();
    } else {
      copyWithin(tmp, 0, a, dest - (len2 - 1), len2);
    }
  }
}
