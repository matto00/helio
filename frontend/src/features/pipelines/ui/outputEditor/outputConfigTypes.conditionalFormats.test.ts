import { readCollectionConfig, readMetricConfig, readTableConfig } from "./outputConfigTypes";

// HEL-1307 task 3.2: the three config readers surface `conditionalFormats` tolerantly.
const good = { op: "lt", value: 50, tone: "error", label: "Low" };

describe("conditionalFormats on the config readers", () => {
  it("reads a valid list on metric, collection and table (table needs a column)", () => {
    expect(readMetricConfig({ conditionalFormats: [good] }).conditionalFormats).toEqual([good]);
    expect(readCollectionConfig({ conditionalFormats: [good] }).conditionalFormats).toEqual([good]);
    const tableRule = { ...good, column: "pass_rate" };
    expect(readTableConfig({ conditionalFormats: [tableRule] }).conditionalFormats).toEqual([
      tableRule,
    ]);
  });

  it("drops an invalid rule but keeps the rest, in order, and never throws", () => {
    const rules = [good, { op: "nope", value: 1, tone: "error" }, null, 7, { ...good, value: 80 }];
    expect(readMetricConfig({ conditionalFormats: rules }).conditionalFormats).toEqual([
      good,
      { ...good, value: 80 },
    ]);
    // a table rule without a column is invalid for a table
    expect(readTableConfig({ conditionalFormats: [good] }).conditionalFormats).toEqual([]);
  });

  it("is undefined (no key) when absent, null or not an array", () => {
    for (const config of [{}, { conditionalFormats: null }, { conditionalFormats: "x" }]) {
      expect(readMetricConfig(config).conditionalFormats).toBeUndefined();
      expect(readCollectionConfig(config).conditionalFormats).toBeUndefined();
      expect(readTableConfig(config).conditionalFormats).toBeUndefined();
    }
  });

  it("an empty list reads as an empty list (the clear state)", () => {
    expect(readMetricConfig({ conditionalFormats: [] }).conditionalFormats).toEqual([]);
  });
});
