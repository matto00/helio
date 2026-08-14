/**
 * HEL-328 tasks.md 5.1/5.2 — unit tests for `buildUpdateDataTypeBody`/
 * `buildUpdatePipelineStepBody`, the `update_data_type`/`update_pipeline_step`
 * tools' absent-vs-omitted PATCH body builders (design.md D3, mirroring
 * `buildUpdateMetricBody`'s coverage style — see `write.test.ts`). HEL-627
 * tasks.md 2.1 adds `buildUpdatePanelBody` coverage in the same style.
 *
 * Imports from `./updateSchemas.js` (NOT `./write.js`) deliberately, for the
 * exact same reason `write.test.ts` imports `buildUpdateMetricBody` from
 * `./metricSchemas.js`: `write.ts`'s full ~20-tool Zod-schema surface is
 * pathologically expensive to type-check under this repo's root
 * `tsconfig.json`/ts-jest combination. Testing the narrow `updateSchemas.ts`
 * module directly avoids pulling that in.
 */

import {
  buildUpdateDataTypeBody,
  buildUpdatePanelBody,
  buildUpdatePipelineStepBody,
} from "./updateSchemas.js";

describe("buildUpdateDataTypeBody", () => {
  it("omits every key when no arguments are supplied (fully empty patch)", () => {
    expect(buildUpdateDataTypeBody({})).toEqual({});
  });

  it("includes only the supplied key for a single-field partial update (rename only)", () => {
    const body = buildUpdateDataTypeBody({ name: "Orders v2" });

    expect(body).toEqual({ name: "Orders v2" });
    expect("fields" in body).toBe(false);
    expect("computedFields" in body).toBe(false);
  });

  it("omits `name` when not supplied (leaves it unchanged server-side)", () => {
    const body = buildUpdateDataTypeBody({
      fields: [{ name: "amount", displayName: "Amount", dataType: "number", nullable: false }],
    });

    expect("name" in body).toBe(false);
  });

  it("includes a supplied `fields` array as a whole-array replace (no per-item merge)", () => {
    const fields = [
      { name: "amount", displayName: "Amount", dataType: "number", nullable: false },
      { name: "region", displayName: "Region", dataType: "string", nullable: true },
    ];
    const body = buildUpdateDataTypeBody({ fields });

    expect(body).toEqual({ fields });
    expect("computedFields" in body).toBe(false);
  });

  it("includes a supplied `computedFields` array as a whole-array replace", () => {
    const computedFields = [
      { name: "total", displayName: "Total", expression: "amount * 2", dataType: "number" },
    ];
    const body = buildUpdateDataTypeBody({ computedFields });

    expect(body).toEqual({ computedFields });
    expect("fields" in body).toBe(false);
  });

  it("includes every supplied field simultaneously, in one body", () => {
    const fields = [{ name: "amount", displayName: "Amount", dataType: "number", nullable: false }];
    const computedFields = [
      { name: "total", displayName: "Total", expression: "amount * 2", dataType: "number" },
    ];
    const body = buildUpdateDataTypeBody({ name: "Orders v2", fields, computedFields });

    expect(body).toEqual({ name: "Orders v2", fields, computedFields });
  });
});

describe("buildUpdatePipelineStepBody", () => {
  it("omits every key when no arguments are supplied (fully empty patch)", () => {
    expect(buildUpdatePipelineStepBody({})).toEqual({});
  });

  it("includes only `config` when only `config` is supplied", () => {
    const body = buildUpdatePipelineStepBody({ config: { count: 10 } });

    expect(body).toEqual({ config: { count: 10 } });
    expect("position" in body).toBe(false);
  });

  it("includes only `position` when only `position` is supplied", () => {
    const body = buildUpdatePipelineStepBody({ position: 2 });

    expect(body).toEqual({ position: 2 });
    expect("config" in body).toBe(false);
  });

  it("includes both `config` and `position` when both are supplied", () => {
    const body = buildUpdatePipelineStepBody({ config: { count: 10 }, position: 2 });

    expect(body).toEqual({ config: { count: 10 }, position: 2 });
  });

  it("never constructs a `type` key — the builder's own parameter shape has no `type` field", () => {
    const body = buildUpdatePipelineStepBody({ config: { count: 10 }, position: 2 });

    expect("type" in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["config", "position"]);
  });
});

describe("buildUpdatePanelBody", () => {
  it("omits every key when no arguments are supplied (fully empty patch)", () => {
    expect(buildUpdatePanelBody({})).toEqual({});
  });

  it("includes only `title` when only `title` is supplied", () => {
    const body = buildUpdatePanelBody({ title: "Renamed panel" });

    expect(body).toEqual({ title: "Renamed panel" });
    expect("type" in body).toBe(false);
    expect("config" in body).toBe(false);
    expect("appearance" in body).toBe(false);
  });

  it("includes only `type` when only `type` is supplied", () => {
    const body = buildUpdatePanelBody({ type: "metric" });

    expect(body).toEqual({ type: "metric" });
    expect("title" in body).toBe(false);
  });

  it("includes only `config` when only `config` is supplied", () => {
    const body = buildUpdatePanelBody({ config: { unit: "USD" } });

    expect(body).toEqual({ config: { unit: "USD" } });
    expect("appearance" in body).toBe(false);
  });

  it("includes only `appearance` when only `appearance` is supplied", () => {
    const body = buildUpdatePanelBody({ appearance: { background: "#fff" } });

    expect(body).toEqual({ appearance: { background: "#fff" } });
    expect("config" in body).toBe(false);
  });

  it("includes every supplied field simultaneously, in one body", () => {
    const body = buildUpdatePanelBody({
      title: "Renamed panel",
      type: "chart",
      config: { annotation: "Q3 actuals" },
      appearance: { background: "#fff" },
    });

    expect(body).toEqual({
      title: "Renamed panel",
      type: "chart",
      config: { annotation: "Q3 actuals" },
      appearance: { background: "#fff" },
    });
  });

  it("never drops an argument the caller supplied as an omitted key", () => {
    const body = buildUpdatePanelBody({ config: { content: "# Updated" } });

    expect(Object.keys(body)).toEqual(["config"]);
  });
});
