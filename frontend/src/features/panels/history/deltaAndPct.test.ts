import { readFileSync } from "fs";
import { resolve } from "path";

import { deltaAndPct } from "./deltaAndPct";

interface Case {
  name: string;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  pct: number | null;
}

// HEL-1705 D4: the same cases `DeltaAndPctFixtureSpec` asserts on the Scala function.
const cases: Case[] = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../../shared-test-fixtures/delta-and-pct.json"),
    "utf8",
  ),
).cases;

describe("deltaAndPct", () => {
  it("has the fixture's cases", () => {
    expect(cases.length).toBeGreaterThan(8);
  });

  it.each(cases)("agrees with the shared fixture: $name", (c) => {
    expect(deltaAndPct(c.current, c.baseline)).toEqual({ delta: c.delta, pct: c.pct });
  });
});
