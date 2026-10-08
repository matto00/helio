import type { HistoryPayloadLimits } from "../../types/output";
import { formatByteCap, formatHistoryPayloadLimits } from "./formatHistoryPayloadLimits";

const DEFAULTS: HistoryPayloadLimits = {
  maxRows: 1000,
  maxBytes: 1048576,
  tiers: {
    free: { maxRuns: 0, maxAgeDays: 0 },
    beta: { maxRuns: 10, maxAgeDays: 7 },
    owner: { maxRuns: 30, maxAgeDays: 30 },
  },
};

describe("formatHistoryPayloadLimits (HEL-1372)", () => {
  it("renders the default figures", () => {
    expect(formatHistoryPayloadLimits(DEFAULTS)).toBe(
      "A run over 1,000 rows or 1 MiB keeps only its summary. Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days.",
    );
  });

  it("renders overridden figures with singular units", () => {
    const text = formatHistoryPayloadLimits({
      maxRows: 500,
      maxBytes: 2097152,
      tiers: { ...DEFAULTS.tiers, beta: { maxRuns: 1, maxAgeDays: 1 } },
    });
    expect(text).toContain("A run over 500 rows or 2 MiB");
    expect(text).toContain("Beta keeps the last 1 run for 1 day;");
    expect(text).not.toContain("1,000");
    expect(text).not.toContain("10 runs");
  });

  it("reads 'keeps no rows' for a tier with zero runs or zero age", () => {
    const text = formatHistoryPayloadLimits({
      ...DEFAULTS,
      tiers: {
        ...DEFAULTS.tiers,
        beta: { maxRuns: 0, maxAgeDays: 7 },
        owner: { maxRuns: 5, maxAgeDays: 0 },
      },
    });
    expect(text).toContain("Beta keeps no rows; Owner keeps no rows.");
  });

  it("falls back to KiB, then grouped bytes, for non-MiB values", () => {
    expect(formatByteCap(512 * 1024)).toBe("512 KiB");
    expect(formatByteCap(1500000)).toBe("1,500,000 bytes");
    expect(formatByteCap(1)).toBe("1 byte");
  });

  it("returns null when the server reported no limits", () => {
    expect(formatHistoryPayloadLimits(undefined)).toBeNull();
  });
});
