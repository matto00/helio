import { sample } from "../test/sampleFixtures";
import { SAMPLE_CAVEAT, describeSampleLabel } from "./describeSampleLabel";

const NOW = Date.parse("2026-10-16T12:03:00Z");

describe("describeSampleLabel (docs/live-draft-preview.md §4)", () => {
  it("non-static exact sample: row count and capture age, no caveat", () => {
    const label = describeSampleLabel(
      sample({ live: true, sourceRowCount: 412, rows: new Array(412).fill({}) }),
      NOW,
    );
    expect(label).toEqual({ text: "sample · 412 rows · fetched 3 minutes ago" });
  });

  it("non-static prefix sample: first 1,000 of N, capture age and the caveat", () => {
    const label = describeSampleLabel(
      sample({ live: true, truncated: true, sourceRowCount: 12431 }),
      NOW,
    );
    expect(label).toEqual({
      text: "sample · first 1,000 of 12,431 rows · fetched 3 minutes ago",
      caveat: SAMPLE_CAVEAT,
    });
  });

  it("non-static prefix sample with an unknown total reads 1,000+", () => {
    const label = describeSampleLabel(
      sample({ live: true, truncated: true, sourceRowCount: null }),
      NOW,
    );
    expect(label.text).toBe("sample · first 1,000 of 1,000+ rows · fetched 3 minutes ago");
    expect(label.caveat).toBe(SAMPLE_CAVEAT);
  });

  it("static source over the cap: first 1,000 of N with the caveat and no capture age", () => {
    const label = describeSampleLabel(sample({ truncated: true, sourceRowCount: 12431 }), NOW);
    expect(label).toEqual({ text: "first 1,000 of 12,431 rows", caveat: SAMPLE_CAVEAT });
  });

  it("static exact sample keeps Static · N rows", () => {
    expect(describeSampleLabel(sample({ sourceRowCount: 30 }), NOW)).toEqual({
      text: "Static · 30 rows",
    });
  });

  it("uses the singular for one row", () => {
    expect(describeSampleLabel(sample({ sourceRowCount: 1 }), NOW).text).toBe("Static · 1 row");
  });
});
