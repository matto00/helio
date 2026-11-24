// HEL-1836 -- the unanchored decision scan of the regex input-cost decision (design D1-D4). Deterministic: no timing assertion.
//
// (a) and (b) are red on main: they count how often the exact scan reads code points through `String.prototype.codePointAt`
// (main reads every one; the shipped scan reads code units through a membership table) and how often stage 1 runs its
// per-cell surrogate test. (c) and (d) are GUARDS, not red-first tests: (c) compares the shipped charge and decision with a
// reference copy of main's code (trivially green on main), (d) pins a frame stage 1 admits (green on main). Each is shown
// failable by its mutations in `mutations.txt` of this change.

import { compileJavaRegex } from "./javaRegex";
import { cellWork, cellWorkBound, REGEX_WORK_BUDGET, workExceedsBudget } from "./regexInputCost";
import type { RegexWork } from "./javaRegexCost";

type Hit = { codePointAt: number; charCodeAt: number; isWellFormed: number; test: number };

const workOf = (pattern: string): RegexWork => {
  const compiled = compileJavaRegex(pattern);
  if (!compiled.ok) throw new Error(`${pattern} declined`);
  return compiled.work;
};
const cp = (n: number) => String.fromCodePoint(n);
const exactSum = (texts: readonly string[], work: RegexWork) =>
  texts.reduce((sum, t) => sum + cellWork(t, work), 0);

/**
 * Run `fn` with counting wrappers around the String/RegExp methods the decision scans with; restored in `finally`. A plain
 * wrapper, not `jest.spyOn` (which records each of ~4e6 calls).
 */
function counting<T>(fn: () => T): { value: T; hit: Hit } {
  const hit: Hit = { codePointAt: 0, charCodeAt: 0, isWellFormed: 0, test: 0 };
  const sp = String.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const rp = RegExp.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const saved = {
    codePointAt: sp.codePointAt,
    charCodeAt: sp.charCodeAt,
    isWellFormed: sp.isWellFormed,
    test: rp.test,
  };
  sp.codePointAt = function (this: string, ...a: unknown[]) {
    hit.codePointAt++;
    return saved.codePointAt.apply(this, a);
  };
  sp.charCodeAt = function (this: string, ...a: unknown[]) {
    hit.charCodeAt++;
    return saved.charCodeAt.apply(this, a);
  };
  if (saved.isWellFormed)
    sp.isWellFormed = function (this: string, ...a: unknown[]) {
      hit.isWellFormed++;
      return saved.isWellFormed.apply(this, a);
    };
  rp.test = function (this: RegExp, ...a: unknown[]) {
    hit.test++;
    return saved.test.apply(this, a);
  };
  try {
    return { value: fn(), hit };
  } finally {
    sp.codePointAt = saved.codePointAt;
    sp.charCodeAt = saved.charCodeAt;
    if (saved.isWellFormed) sp.isWellFormed = saved.isWellFormed;
    rp.test = saved.test;
  }
}

const ROWS = 1000;
/** `ROWS` cells of `body` repeated to the cell length that makes the exact charge exactly the budget (asserted below). */
const frameAtBudget = (pattern: string, cell: (n: number) => string, n: number) => {
  const work = workOf(pattern);
  const texts = Array.from({ length: ROWS }, () => cell(n));
  return { work, texts };
};

describe("unanchored exact scan reads code units, not code points (red on main)", () => {
  const shapes: Array<[string, string, (n: number) => string, number]> = [
    [
      "(x) on cyr + one trailing lone high surrogate (group H)",
      "(x)",
      (n) => "ж".repeat(n) + "\ud800",
      3998,
    ],
    ["(x) on surrogate-free cyr", "(x)", (n) => "ж".repeat(n), 4000],
    ["([^a]+) on its own non-members + one CJK tag", "([^a]+)", (n) => "a".repeat(n) + "数", 3998],
  ];
  it.each(shapes)(
    "%s: admitted at exactly the budget with zero codePointAt",
    (_n, pattern, cell, n) => {
      const { work, texts } = frameAtBudget(pattern, cell, n);
      expect(exactSum(texts, work)).toBe(REGEX_WORK_BUDGET);
      const { value, hit } = counting(() => workExceedsBudget(texts, work));
      expect(value).toBe(false);
      expect(hit.codePointAt).toBe(0);
    },
  );

  it.each(shapes)("%s: one more unit is declined", (_n, pattern, cell, n) => {
    const { work, texts } = frameAtBudget(pattern, cell, n);
    const over = [...texts.slice(1), cell(n) + "a"];
    expect(exactSum(over, work)).toBe(REGEX_WORK_BUDGET + 1);
    expect(workExceedsBudget(over, work)).toBe(true);
  });
});

describe("stage 1 skips its per-cell surrogate test when the scan is certain (red on main)", () => {
  type Mod = typeof import("./regexInputCost");
  /** Load a fresh module with the counting `isWellFormed` installed, so its load-time capture counts (design D4 (b)). */
  function load(): { mod: Mod; counted: () => number; restore: () => void } {
    const sp = String.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const native = sp.isWellFormed;
    let n = 0;
    let on = false;
    if (native)
      sp.isWellFormed = function (this: string, ...a: unknown[]) {
        if (on) n++;
        return native.apply(this, a);
      };
    let mod!: Mod;
    jest.isolateModules(() => {
      mod = require("./regexInputCost");
    });
    return {
      mod: new Proxy(mod, {
        get: (t, k) =>
          k === "workExceedsBudget"
            ? (...a: Parameters<Mod["workExceedsBudget"]>) => {
                on = true;
                try {
                  return t.workExceedsBudget(...a);
                } finally {
                  on = false;
                }
              }
            : t[k as keyof Mod],
      }),
      counted: () => n,
      restore: () => {
        if (native) sp.isWellFormed = native;
      },
    };
  }

  it("runs no stage-1 test on a frame whose length-only sum is already over the budget", () => {
    const l = load();
    try {
      const { work, texts } = frameAtBudget("([^a]+)", (n) => "a".repeat(n) + "数", 3998);
      const { value, hit } = counting(() => l.mod.workExceedsBudget(texts, work));
      expect(value).toBe(false);
      expect(hit.test).toBe(0);
      expect(l.counted()).toBe(0);
    } finally {
      l.restore();
    }
  });

  it("seam is live: a frame stage 1 does run on counts one surrogate test per cell", () => {
    const l = load();
    try {
      // (x) on 2,000 cyr characters x 1,000 rows: exact 2.0e6, length-only sum exactly the budget (not over), so stage 1 runs.
      const { work, texts } = frameAtBudget("(x)", (n) => "ж".repeat(n), 2000);
      const { value, hit } = counting(() => l.mod.workExceedsBudget(texts, work));
      expect(value).toBe(false);
      expect(hit.test + l.counted()).toBe(ROWS);
    } finally {
      l.restore();
    }
  });
});

describe("(d) a frame stage 1 admits is never scanned (guard)", () => {
  it("decides (x) on cyr at exact 2.0e6 false with zero code-unit reads", () => {
    const { work, texts } = frameAtBudget("(x)", (n) => "ж".repeat(n), 2000);
    expect(exactSum(texts, work)).toBe(2_000_000);
    const { value, hit } = counting(() => workExceedsBudget(texts, work));
    expect(value).toBe(false);
    expect(hit.charCodeAt).toBe(0);
    expect(hit.codePointAt).toBe(0);
  });
});

// ---- (c) equivalence with a reference copy of main's code (guard) ----------------------------------------------------------

type Ranges = ReadonlyArray<readonly [number, number]>;
function refInRanges(ranges: Ranges, c: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c < ranges[mid][0]) hi = mid - 1;
    else if (c > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}
/** Main's unanchored `perPositionWork`, copied verbatim (codePointAt + binary search). */
function refPerPositionWork(text: string, work: RegexWork): number {
  const { A, W, m, f, chars } = work;
  let len = 0;
  let run = 0;
  let total = 0;
  const endRun = () => {
    total += run * A * Math.min(run, W) + m * run * run;
    run = 0;
  };
  for (let i = 0; i < text.length; ) {
    const c = text.codePointAt(i)!;
    const pair = c > 0xffff;
    const lone = !pair && c >= 0xd800 && c <= 0xdfff;
    const units = pair ? 2 : lone ? 2 : 1;
    len += units;
    if (refInRanges(chars, c)) run += units;
    else endRun();
    i += pair ? 2 : 1;
  }
  endRun();
  return f * (A * len + total);
}
const LONE = /[\ud800-\udfff]/u;
function refBound(text: string, work: RegexWork): number {
  const L = LONE.test(text) ? 2 * text.length : text.length;
  return work.f * (work.A * L + L * work.A * Math.min(L, work.W) + work.m * L * L);
}
/** Main's two-stage unanchored decision. */
function refDecision(texts: readonly string[], work: RegexWork): boolean {
  let bound = 0;
  let over = false;
  for (const t of texts) {
    bound += refBound(t, work);
    if (bound > REGEX_WORK_BUDGET) {
      over = true;
      break;
    }
  }
  if (!over) return false;
  let total = 0;
  for (const t of texts) {
    total += refPerPositionWork(t, work);
    if (total > REGEX_WORK_BUDGET) return true;
  }
  return false;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const patterns: Array<[string, string]> = [
  ["(x)", "(x)"],
  ["(\\d+)", "(\\d+)"],
  ["a*b", "a*b"],
  ["(.+)", "(.+)"],
  ["([^a]+)", "([^a]+)"],
  ["(\\S{16})x", "(\\S{16})x"],
  ["([^acegikm]+)", "([^acegikm]+)"],
  ["astral class", `([${cp(0x1f600)}-${cp(0x1f64f)}]+)`],
  ["negated astral", `([^${cp(0x1f600)}]+)`],
  ["class straddling U+FFFF", `([${cp(0xfff0)}-${cp(0x10010)}]+)`],
  ["surrogate-range class", `([${cp(0xd7ff)}-${cp(0xe000)}]+)`],
];
const alphabet = [
  "a",
  "b",
  "x",
  "1",
  "-",
  " ",
  "\n",
  "ж",
  "数",
  cp(0x1f600),
  cp(0x1f680),
  "\ud800",
  "\udc00",
  "\udc00\ud800",
  "\ud83d",
  "\ude00",
  cp(0xffff),
  cp(0x10000),
];

describe("(c) shipped cellWork and workExceedsBudget equal main's for every cell and frame (guard)", () => {
  it.each(patterns)(
    "%s: equal charge per cell, bound at least the charge, equal decision",
    (_n, pattern) => {
      const work = workOf(pattern);
      const seeds = [...alphabet];
      for (const [lo, hi] of work.chars) {
        for (const v of [lo - 1, lo, hi, hi + 1, 0xffff, 0x10000]) {
          if (v >= 0 && v <= 0x10ffff) seeds.push(cp(v));
        }
      }
      const rand = rng(1836);
      const cell = (): string => {
        const len = Math.floor(rand() * 40);
        let s = "";
        for (let i = 0; i < len; i++) s += seeds[Math.floor(rand() * seeds.length)];
        return s;
      };
      const cells = [
        "",
        ...seeds,
        ...seeds.map((s) => s + s),
        ...Array.from({ length: 1500 }, cell),
        "\ud800",
        "\ud800\ud800",
        "a\ud800",
        "\ud800a",
        "\udc00\ud800",
        "𐀀",
      ];
      for (const c of cells) {
        const exact = refPerPositionWork(c, work);
        expect(cellWork(c, work)).toBe(exact);
        expect(cellWorkBound(c, work)).toBeGreaterThanOrEqual(exact);
      }
      // frames sized so the exact charge crosses the budget inside the frame (prefix at/under, prefix + one cell over)
      const big = Array.from({ length: 4000 }, () => {
        let s = "";
        for (let i = 0; i < 200; i++) s += seeds[Math.floor(rand() * seeds.length)];
        return s;
      });
      let sum = 0;
      let k = 0;
      while (k < big.length && sum + refPerPositionWork(big[k], work) <= REGEX_WORK_BUDGET) {
        sum += refPerPositionWork(big[k], work);
        k++;
      }
      const atBudget = big.slice(0, k);
      const over = big.slice(0, k + 1);
      for (const frame of [atBudget, over, big.slice(0, Math.max(1, k >> 1)), []]) {
        expect(workExceedsBudget(frame, work)).toBe(refDecision(frame, work));
      }
      expect(refDecision(atBudget, work)).toBe(false);
      expect(workExceedsBudget(atBudget, work)).toBe(false);
      if (k < big.length) expect(workExceedsBudget(over, work)).toBe(true);
    },
  );
});
