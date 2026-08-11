/**
 * HEL-541 tasks.md 4.2 — unit tests for `buildUpdateMetricBody`, the
 * `update_metric` tool's absent-vs-null PATCH body builder (design.md
 * Decision 2). Pins the exact contract `UpdateMetricRequest` requires: a key
 * is present in the built body only when the caller actually supplied that
 * argument (`!== undefined`); an explicit `null` on `description`/`format`
 * is forwarded as `null`, not dropped.
 *
 * Imports from `./metricSchemas.js` (NOT `./write.js`) deliberately —
 * `write.ts`'s full ~20-tool Zod-schema surface is pathologically expensive
 * to type-check under this repo's root `tsconfig.json`/ts-jest combination
 * (reproduced against `write.ts` unmodified on `main` too — a pre-existing
 * repo issue, not something this change introduced; flagged as a spinoff
 * candidate rather than fixed here, out of scope for this ticket). Testing
 * the narrow `metricSchemas.ts` module directly avoids pulling that in.
 */

import { buildUpdateMetricBody } from "./metricSchemas.js";

describe("buildUpdateMetricBody", () => {
  it("omits every key when no arguments are supplied (fully empty patch)", () => {
    expect(buildUpdateMetricBody({})).toEqual({});
  });

  it("includes only the supplied key for a single-field partial update", () => {
    const body = buildUpdateMetricBody({ name: "Total Revenue" });

    expect(body).toEqual({ name: "Total Revenue" });
    expect("description" in body).toBe(false);
    expect("format" in body).toBe(false);
  });

  it("omits `description` when not supplied (leaves it unchanged server-side)", () => {
    const body = buildUpdateMetricBody({ measureField: "amount" });

    expect("description" in body).toBe(false);
  });

  it("forwards an explicit `description: null` to clear the field, distinct from omitting it", () => {
    const body = buildUpdateMetricBody({ description: null });

    expect(body).toEqual({ description: null });
    expect(body.description).toBeNull();
  });

  it("includes a non-null `description` string as a plain replace", () => {
    const body = buildUpdateMetricBody({ description: "Sum of order totals" });

    expect(body).toEqual({ description: "Sum of order totals" });
  });

  it("forwards an explicit `format: null` to clear the whole format object", () => {
    const body = buildUpdateMetricBody({ format: null });

    expect(body).toEqual({ format: null });
    expect(body.format).toBeNull();
  });

  it("includes a supplied `format` object as a whole-object replace (no deep merge)", () => {
    const body = buildUpdateMetricBody({ format: { unit: "USD", decimals: 2 } });

    expect(body).toEqual({ format: { unit: "USD", decimals: 2 } });
  });

  it("includes every supplied field simultaneously, in one body", () => {
    const body = buildUpdateMetricBody({
      name: "Total Revenue",
      description: null,
      measureField: "amount",
      aggregation: "sum",
      allowedDimensions: ["region", "channel"],
      format: { unit: "USD" },
      deprecated: true,
    });

    expect(body).toEqual({
      name: "Total Revenue",
      description: null,
      measureField: "amount",
      aggregation: "sum",
      allowedDimensions: ["region", "channel"],
      format: { unit: "USD" },
      deprecated: true,
    });
  });

  it("round-trips cleanly through JSON.stringify: an omitted key never appears, an explicit null does", () => {
    const body = buildUpdateMetricBody({ name: "Total Revenue", description: null });
    const wire = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

    expect(wire).toEqual({ name: "Total Revenue", description: null });
    expect("format" in wire).toBe(false);
    expect("aggregation" in wire).toBe(false);
  });
});
