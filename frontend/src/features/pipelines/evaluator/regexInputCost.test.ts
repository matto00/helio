// HEL-1697 -- the data-dependent decline of accepted regex patterns over long input (design D1). Deterministic: the decision
// depends only on the pattern and the input frame, never on elapsed time. Each frame below is sized against
// REGEX_WORK_BUDGET (4.00e6 units) so that exactly one term of the cost formula decides it.

import { clientEvaluable, evaluateStep, type RunContext } from "./evaluateStep";
import { compileJavaRegex } from "./javaRegex";
import { workExceedsBudget } from "./regexInputCost";
import type { Frame } from "./value";

const none: RunContext = { lane: () => undefined, source: () => undefined };
const step = (pattern: string) => ({
  id: "s",
  kind: "stringops",
  config: { operation: "extractRegex", field: "text", outputColumn: "out", pattern },
});
const rowsOf = (rows: number, cell: (i: number) => string | null): Frame =>
  Array.from({ length: rows }, (_, i) => ({ text: cell(i) }));
const frame = (rows: number, cell: string): Frame => rowsOf(rows, () => cell);
/** The decision only (never the rows), so a failure prints a short value. */
const decide = (pattern: string, input: Frame) => {
  const outcome = evaluateStep(step(pattern), input, none);
  return outcome.status === "needsServer"
    ? { status: outcome.status, reason: outcome.reason }
    : { status: outcome.status };
};
const run = (pattern: string, rows: number, cell: string) => decide(pattern, frame(rows, cell));
const DECLINED = { status: "needsServer", reason: "regexInputCost" };
const OK = { status: "ok" };
const pts = (n: number, base = 0x100) =>
  Array.from({ length: n }, (_, k) => String.fromCharCode(base + 2 * k)).join("");

describe("regexInputCost decline", () => {
  it.each([
    ["(a*)b", 1000, 500],
    ["(a{1000})b", 1000, 2000],
    ["(a{1000,})", 1000, 2000],
  ])("declines %s over %i rows of %i characters", (pattern, rows, length) => {
    expect(run(pattern, rows, "a".repeat(length))).toEqual(DECLINED);
  });

  it("keeps the same single-quantifier pattern client-side over short cells", () => {
    expect(run("(a*)b", 100, "a".repeat(20))).toEqual(OK);
  });

  it("keeps cheap patterns client-side on long cells, exactly at the budget", () => {
    // (a+) over 1,000 x 2,000 `a` costs 2,000 + 2,000 per cell = 4.00e6; the budget is exclusive.
    expect(run("(a+)", 1000, "a".repeat(2000))).toEqual(OK);
    expect(run("(\\d+)", 1000, "1".repeat(2000))).toEqual(OK);
    expect(run("(a+)", 1000, "1".repeat(2000))).toEqual(OK);
  });

  describe("ordinary text", () => {
    const sentence = "Order 123 shipped on 2024-05-17 to ABC-77 for $129.99, ref x. ";
    const text = sentence.repeat(4).slice(0, 200);
    it.each(["(\\d+\\.\\d+)", "([A-Z]+)-(\\d+)"])(
      "keeps %s client-side over 1,000 rows of 200-character mixed text",
      (pattern) => {
        expect(run(pattern, 1000, text)).toEqual(OK);
      },
    );
  });

  describe("per-character scan and alternatives", () => {
    it("declines three alternatives over many one-character runs", () => {
      // R = 1 runs separated by a line terminator: A x len = 3,000 plus 500 x 3 per cell, 4.5e6 over 1,000 rows.
      const cell = "b\n".repeat(500);
      expect(run("(.{16})x|(.{16})y|(.{16})z", 1000, cell)).toEqual(DECLINED);
      expect(run("(.{16})x", 1000, cell)).toEqual(OK);
    });

    it("charges the scan once per alternative on characters no atom consumes", () => {
      const classes = Array.from(
        { length: 16 },
        (_, k) => `([^abcdefg]{3})${String.fromCharCode(0x68 + k)}`,
      ).join("|");
      // Every cell character is excluded from every class: U-runs are empty, so only the scan charge (16 x 2,000 per cell).
      expect(run(classes, 1000, "abcdefg".repeat(286).slice(0, 2000))).toEqual(DECLINED);
      expect(run(classes, 100, "abcdefg".repeat(286).slice(0, 2000))).toEqual(OK);
    });
  });

  describe("class width", () => {
    const wide = `([^${pts(63)}]{16})x`;
    const cell = "жĀ".repeat(1000);
    it("weights a 64-range class: the factor multiplies the whole cell cost", () => {
      // R = 1 runs: (2,000 + 1,000 x 1 x 1) per cell = 3.0e6 at factor 1; the 64-range factor makes it decline.
      expect(run(wide, 1000, cell)).toEqual(DECLINED);
      expect(run("([^Ā]{16})x", 1000, cell)).toEqual(OK);
    });

    it("declines a class of more than 64 ranges as unsafeRegex", () => {
      const tooWide = `([^${pts(64)}]{16})x`;
      expect(clientEvaluable(step(tooWide), none)).toEqual({ ok: false, reason: "unsafeRegex" });
      expect(clientEvaluable(step(wide), none)).toEqual({ ok: true });
    });
  });

  describe("unpaired surrogates", () => {
    it("charges each unpaired surrogate as two units", () => {
      // 14 x 200 per cell uncharged (2.8e6); 28 x 200 charged (5.6e6).
      expect(run("(.{12})x", 1000, "\ud800".repeat(200))).toEqual(DECLINED);
      expect(run("(.{12})x", 1000, "a".repeat(200))).toEqual(OK);
    });

    it("does not double-charge a real surrogate pair", () => {
      expect(run("(.{12})x", 1000, "😀".repeat(100))).toEqual(OK);
    });
  });

  describe("cells", () => {
    it("skips null and absent cells", () => {
      // 1,000 cells of 1,999 `a` cost 3.998e6 for (a+); a null counted as the text "null" would add 4 x 1,000.
      const rows = [
        ...rowsOf(1000, () => "a".repeat(1999)),
        ...rowsOf(500, () => null),
        ...Array.from({ length: 500 }, (): Frame[number] => ({})),
      ];
      expect(decide("(a+)", rows)).toEqual(OK);
    });

    it("measures UTF-16 units, not code points", () => {
      // 2,001 astral characters are 4,002 UTF-16 units: 4.002e6 over 1,000 rows (2.001e6 by code points).
      expect(run("(a+)", 1000, "\u{1f600}".repeat(2001))).toEqual(DECLINED);
    });
  });
});

// HEL-1807 -- a pattern whose every alternative starts with `^` is charged for the one match attempt V8 makes per cell, never
// more than the per-position charge (design D2). Calibration: openspec/changes/anchored-regex-cost-refinement/calibration.md.
describe("regexInputCost start-anchored patterns", () => {
  it("evaluates ^(.*)$ over 1,000 rows of 500-character cells on the client, with the cell as its own match", () => {
    // A = 1, W = 3, m = 2: 1,000 x (4 + 500 x 3) = 1.504e6 (it was 1,000 x (500 + 500 x 3 + 2 x 500^2) = 5.0e8).
    const cell = "a".repeat(500);
    const outcome = evaluateStep(step("^(.*)$"), frame(1000, cell), none);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.rows).toHaveLength(1000);
    expect(outcome.rows.every((r) => r.out === cell)).toBe(true);
  });

  it("charges R0 (the first run) per cell: ^(.*)x is client-side at 1,998 characters and declined at 2,000", () => {
    // A = 1, W = 2, m = 1: 3 + 2 x len per cell, so 3.999e6 and 4.003e6 over 1,000 rows.
    expect(run("^(.*)x", 1000, "a".repeat(1998))).toEqual(OK);
    expect(run("^(.*)x", 1000, "a".repeat(2000))).toEqual(DECLINED);
  });

  it("keeps a partly anchored pattern at the per-position charge", () => {
    // Only the first alternative is anchored: V8 tries `y` at every position, so the quadratic charge stands.
    expect(run("^(.*)x|y", 1000, "a".repeat(500))).toEqual(DECLINED);
    expect(run("(a)^b|(.*)x", 1000, "a".repeat(500))).toEqual(DECLINED);
  });

  it("never charges an anchored pattern more than the per-position charge", () => {
    // ^(a{1000})b: the anchored form alone is 1,001 + 10 per 10-character cell (1.01e7 over 10,000 rows); the
    // per-position charge is 10 + 10 x min(10, 1001) = 110 per cell (1.1e6), and the smaller of the two decides.
    expect(run("^(a{1000})b", 10000, "a".repeat(10))).toEqual(OK);
  });

  it("charges only the constant for a cell that starts outside the pattern's characters", () => {
    // R0 = 0: 3 per cell however long the cell is, where the per-position scan would charge 20,000 per cell.
    expect(run("^(a*)b", 1000, "c" + "a".repeat(20000))).toEqual(OK);
    expect(run("(a*)b", 1000, "c" + "a".repeat(20000))).toEqual(DECLINED);
  });

  it("still declines a lone-surrogate cell of an anchored pattern that costs too much", () => {
    // 5,000 unpaired surrogates are 10,000 units of the one run: 3 + 2 x 10,000 per cell, 2.0e7 over 1,000 rows.
    expect(run("^(.*)x", 1000, "\ud800".repeat(5000))).toEqual(DECLINED);
  });

  it("keeps multiline mode unreachable: an inline flag is unsafeRegex", () => {
    // Guard, not a red test: V8 anchors `^` per line under `(?m)`, which the model does not charge.
    expect(clientEvaluable(step("(?m)^(.*)$"), none)).toEqual({ ok: false, reason: "unsafeRegex" });
  });

  describe("decision scan", () => {
    const work = (pattern: string) => {
      const compiled = compileJavaRegex(pattern);
      if (!compiled.ok) throw new Error(`${pattern} declined`);
      return compiled.work;
    };
    const countReads = (fn: () => void): number => {
      const spy = jest.spyOn(String.prototype, "codePointAt");
      try {
        fn();
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };

    it("reads only the first run of a cell whose anchored charge is already the smaller one", () => {
      // ^(a*)b on `aaac` + 20,000 `a`: R0 = 3, charge 3 + 2 x 3 = 9 <= len, so nothing past the first character
      // outside the pattern's characters is read.
      const cells = Array.from({ length: 1000 }, () => "aaac" + "a".repeat(20000));
      const reads = countReads(() => {
        expect(workExceedsBudget(cells, work("^(a*)b"))).toBe(false);
      });
      expect(reads).toBeLessThanOrEqual(1000 * (3 + 1));
    });

    it("skips the exact scan when the tested bound already fits (no tail, the first run covers the cell)", () => {
      // ^(\\d+) on 3,998 digits: A = 1, W = 1, m = 0, so 2 + 3,998 = 4,000 per cell, exactly the budget over 1,000 rows. The
      // surrogate-free bound (2 x length) is twice that, but the tested bound equals the charge, so no cell is scanned.
      const cells = Array.from({ length: 1000 }, () => "1".repeat(3998));
      const reads = countReads(() => {
        expect(workExceedsBudget(cells, work("^(\\d+)"))).toBe(false);
      });
      expect(reads).toBe(0);
      expect(run("^(\\d+)", 1000, "1".repeat(3999))).toEqual(DECLINED);
    });

    it("doubles an unpaired surrogate in the tested bound and the exact charge", () => {
      // ^(.+): 2 + 2 units per `\\ud800`; 1,999 of them are 4,000 per cell at the budget, 2,000 are over it (a guard: the model charged this before too).
      expect(run("^(.+)", 1000, "\ud800".repeat(1999))).toEqual(OK);
      expect(run("^(.+)", 1000, "\ud800".repeat(2000))).toEqual(DECLINED);
    });

    it("reads at most one character of a cell that starts outside the pattern's characters", () => {
      const cells = Array.from({ length: 1000 }, () => "c" + "a".repeat(20000));
      const reads = countReads(() => {
        expect(workExceedsBudget(cells, work("^(a*)b"))).toBe(false);
      });
      expect(reads).toBeLessThanOrEqual(1000);
    });
  });
});
