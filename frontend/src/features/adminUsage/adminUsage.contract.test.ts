import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { usage } from "./adminUsage.fixture";
import type { AdminUsage } from "./types/adminUsage";

// `format` keywords ("date") are not asserted here; the backend spec asserts the real serialised body.
const schema = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../../schemas/admin/admin-usage-response.schema.json"),
    "utf8",
  ),
);
const validate = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);

function errors(value: unknown): string[] {
  validate(value);
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

describe("AdminUsage response contract (schemas/admin/admin-usage-response.schema.json)", () => {
  it("accepts the typed fixture, totals included", () => {
    expect(errors(usage)).toEqual([]);
  });

  it("accepts explicit nulls for unavailable active counts and asOf", () => {
    const unrolled: AdminUsage = {
      ...usage,
      rolledThrough: null,
      totals: { totalUsers: 8, activeLast7Days: null, activeLast30Days: null, asOf: null },
    };
    expect(errors(unrolled)).toEqual([]);
  });

  it("rejects a response without totals, an omitted null, or a window over 365", () => {
    const { totals: _totals, ...withoutTotals } = usage;
    expect(errors(withoutTotals)).not.toEqual([]);
    const { asOf: _asOf, ...partialTotals } = usage.totals;
    expect(errors({ ...usage, totals: partialTotals })).not.toEqual([]);
    expect(errors({ ...usage, days: 366 })).not.toEqual([]);
  });

  it("rejects any extra field on totals (the response stays identifier-free)", () => {
    expect(errors({ ...usage, totals: { ...usage.totals, userIds: ["x"] } })).not.toEqual([]);
  });
});
