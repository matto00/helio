/**
 * HEL-328 tasks.md 5.1/5.2 — unit tests for `buildUpdatePipelineStepBody`/
 * `buildUpdatePanelBody`, the `update_pipeline_step`/`update_panel` tools'
 * absent-vs-omitted PATCH body builders (design.md D3). HEL-907 task 3.9
 * removes `buildUpdateDataTypeBody`'s coverage outright along with the
 * retired `update_data_type` tool and `buildUpdateDataTypeBody` itself (the
 * DataType model was retired by HEL-904; the tool has had no backend route
 * to call since).
 *
 * Imports from `./updateSchemas.js` (NOT `./write.js`) deliberately:
 * `write.ts`'s full ~20-tool Zod-schema surface is pathologically expensive
 * to type-check under this repo's root `tsconfig.json`/ts-jest combination.
 * Testing the narrow `updateSchemas.ts` module directly avoids pulling that in.
 */

import { buildUpdatePanelBody, buildUpdatePipelineStepBody } from "./updateSchemas.js";

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
