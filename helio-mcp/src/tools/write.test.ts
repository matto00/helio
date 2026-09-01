/**
 * HEL-581 tasks.md 4.1 — call-routing tests for `addPipelineStepHandler`
 * (`add_pipeline_step`'s full validate-then-call logic, design.md Decision 1).
 *
 * Imports from `./assertSchemas.js` (NOT `./write.js`) deliberately —
 * `write.ts`'s full ~20-tool Zod-schema surface is pathologically expensive
 * to type-check under this repo's root `tsconfig.json`/ts-jest combination
 * (reproduced against `write.ts` unmodified on `main` too — a pre-existing
 * repo issue, not something this change introduced; flagged as a spinoff
 * candidate rather than fixed here, out of scope for this ticket). Testing
 * the narrow `assertSchemas.ts` module directly avoids pulling that in.
 *
 * HEL-907 task 3.9 removes this file's `buildUpdateMetricBody` coverage
 * outright, along with `metricSchemas.ts` itself and the retired
 * `create_metric`/`update_metric`/`delete_metric`/`list_metrics`/`get_metric`
 * tools (the Metric model was retired by HEL-904; these tools have had no
 * backend route to call since).
 */

import type { HelioApi } from "../helioApi.js";
import type { PipelineStepResponse } from "../types.js";
import { addPipelineStepHandler } from "./assertSchemas.js";

/**
 * HEL-581 tasks.md 4.1 — `addPipelineStepHandler` (`add_pipeline_step`'s
 * validate-then-call logic, design.md Decision 1). A well-formed `assert`
 * config for each of the six v1 rule kinds calls through to
 * `api.addPipelineStep` unchanged; a malformed one (unknown kind, invalid
 * severity, a field-requiring kind missing `field`) is rejected BEFORE any
 * API call — pinned here by asserting the mocked `addPipelineStep` was never
 * invoked.
 */
describe("addPipelineStepHandler (assert config validation, HEL-581)", () => {
  function makeFakeApi(): { api: HelioApi; calls: Array<{ pipelineId: string; step: unknown }> } {
    const calls: Array<{ pipelineId: string; step: unknown }> = [];
    const fake = {
      addPipelineStep: async (
        pipelineId: string,
        step: { type: string; config: Record<string, unknown> },
      ): Promise<PipelineStepResponse> => {
        calls.push({ pipelineId, step });
        return { id: "step-1", type: step.type, position: 0, config: step.config };
      },
    };
    return { api: fake as unknown as HelioApi, calls };
  }

  // ── Well-formed configs: one per v1 rule kind, calling through to the API ──

  it("adds a well-formed notNull rule and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "notNull", field: "email", params: {}, severity: "error" }] };

    const result = await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toEqual([{ pipelineId: "p1", step: { type: "assert", config } }]);
    expect(result).toEqual({ id: "step-1", type: "assert", position: 0, config });
  });

  it("adds a well-formed unique rule and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "unique", field: "orderId", params: {}, severity: "warn" }] };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("adds a well-formed range rule (min/max) and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = {
      rules: [{ kind: "range", field: "amount", params: { min: 0, max: 100 }, severity: "error" }],
    };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("adds a well-formed rowCountMin rule with NO field and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "rowCountMin", params: { count: 1 }, severity: "warn" }] };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("adds a well-formed rowCountMax rule with NO field and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "rowCountMax", params: { count: 1000 }, severity: "error" }] };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("adds a well-formed regex rule and calls the API unchanged", async () => {
    const { api, calls } = makeFakeApi();
    const config = {
      rules: [
        { kind: "regex", field: "sku", params: { pattern: "^[A-Z]{3}-\\d+$" }, severity: "error" },
      ],
    };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("accepts multiple rules of mixed kinds/severities in one config", async () => {
    const { api, calls } = makeFakeApi();
    const config = {
      rules: [
        { kind: "notNull", field: "email", params: {}, severity: "error" },
        { kind: "rowCountMin", params: { count: 1 }, severity: "warn" },
      ],
    };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("rejects an invalid rule kind before any API call", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "bogus", field: "email", params: {}, severity: "error" }] };

    await expect(
      addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config }),
    ).rejects.toThrow(/Invalid assert step config/);
    expect(calls).toEqual([]);
  });

  it("rejects an invalid severity before any API call", async () => {
    const { api, calls } = makeFakeApi();
    const config = {
      rules: [{ kind: "notNull", field: "email", params: {}, severity: "critical" }],
    };

    await expect(
      addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config }),
    ).rejects.toThrow(/Invalid assert step config/);
    expect(calls).toEqual([]);
  });

  it.each(["notNull", "unique", "range", "regex"])(
    "rejects a %s rule missing its required field before any API call",
    async (kind) => {
      const { api, calls } = makeFakeApi();
      const params =
        kind === "range" ? { min: 1 } : kind === "regex" ? { pattern: "x" } : ({} as const);
      const config = { rules: [{ kind, params, severity: "error" }] };

      await expect(
        addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config }),
      ).rejects.toThrow(/Invalid assert step config/);
      expect(calls).toEqual([]);
    },
  );

  it("rejects a notNull rule whose params carries an unexpected extra key (strict rejection)", async () => {
    const { api, calls } = makeFakeApi();
    const config = {
      rules: [{ kind: "notNull", field: "email", params: { extra: true }, severity: "error" }],
    };

    await expect(
      addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config }),
    ).rejects.toThrow(/Invalid assert step config/);
    expect(calls).toEqual([]);
  });

  it("accepts a range rule with neither min nor max set (client-side Zod does not enforce that; the backend's own execute-time check does — design.md Decision 6's 'no shape validation of params' scope line)", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [{ kind: "range", field: "amount", params: {}, severity: "error" }] };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("accepts a config with an empty rules array", async () => {
    const { api, calls } = makeFakeApi();
    const config = { rules: [] };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "assert", config });

    expect(calls).toHaveLength(1);
  });

  it("passes a non-assert type's config through unchanged, performing no assert validation at all", async () => {
    const { api, calls } = makeFakeApi();
    // This would be an invalid assert config, but type is "limit" — must pass through untouched.
    const config = { count: 10 };

    await addPipelineStepHandler(api, { pipelineId: "p1", type: "limit", config });

    expect(calls).toEqual([{ pipelineId: "p1", step: { type: "limit", config } }]);
  });
});
