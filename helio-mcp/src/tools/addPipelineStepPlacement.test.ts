/**
 * HEL-1069 -- `add_pipeline_step` placement semantics (specs/mcp-pipeline-step-placement).
 * Fakes the HTTP-level `addPipelineStep`, so these pin exactly what the tool SENDS: the guard flag,
 * the explicit sibling flag, and the pre-request refusals.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { PipelineStepResponse } from "../types.js";
import { addPipelineStepHandler } from "./assertSchemas.js";

function fakeApi(impl?: (step: unknown) => Promise<PipelineStepResponse>) {
  const calls: unknown[] = [];
  const api = {
    addPipelineStep: async (_pipelineId: string, step: unknown) => {
      calls.push(step);
      return impl
        ? impl(step)
        : ({ id: "new", type: "limit", position: 0, config: {} } as PipelineStepResponse);
    },
  } as unknown as HelioApi;
  return { api, calls };
}

const base = { pipelineId: "p1", type: "limit", config: { count: 5 } };

describe("addPipelineStepHandler placement (HEL-1069)", () => {
  it("omitted attachAsTail sends rejectIfReparents:true for a parentStepId anchor", async () => {
    const { api, calls } = fakeApi();
    await addPipelineStepHandler(api, { ...base, parentStepId: "x" });
    expect(calls[0]).toMatchObject({ parentStepId: "x", rejectIfReparents: true });
    expect(calls[0]).not.toHaveProperty("attachAsTail", true);
  });

  it("omitted attachAsTail sends rejectIfReparents:true for rootId and for no anchor", async () => {
    const { api, calls } = fakeApi();
    await addPipelineStepHandler(api, { ...base, rootId: "r1" });
    await addPipelineStepHandler(api, { ...base });
    expect(calls[0]).toMatchObject({ rootId: "r1", rejectIfReparents: true });
    expect(calls[1]).toMatchObject({ rejectIfReparents: true });
  });

  it("surfaces the backend's 422 naming the children that would move", async () => {
    const { api } = fakeApi(async () => {
      throw new HelioApiError(
        422,
        "/api/pipelines/p1/steps",
        "This insert would re-parent existing step(s): child-1.",
      );
    });
    await expect(addPipelineStepHandler(api, { ...base, parentStepId: "x" })).rejects.toThrow(
      /child-1/,
    );
  });

  it("attachAsTail:true sends the sibling flag and NOT the guard", async () => {
    const { api, calls } = fakeApi();
    await addPipelineStepHandler(api, { ...base, parentStepId: "x", attachAsTail: true });
    expect(calls[0]).toMatchObject({ parentStepId: "x", attachAsTail: true });
    expect(calls[0]).not.toHaveProperty("rejectIfReparents");
  });

  it("attachAsTail:false is a deliberate splice: no guard, no tail flag, reparentedStepIds passes through", async () => {
    const { api, calls } = fakeApi(async () => ({
      id: "new",
      type: "limit",
      position: 0,
      config: {},
      reparentedStepIds: ["old-child"],
    }));
    const result = await addPipelineStepHandler(api, {
      ...base,
      parentStepId: "x",
      attachAsTail: false,
    });
    expect(calls[0]).not.toHaveProperty("rejectIfReparents");
    expect(calls[0]).not.toHaveProperty("attachAsTail", true);
    expect(result.reparentedStepIds).toEqual(["old-child"]);
  });

  it.each([
    ["rootId", { rootId: "r1" }],
    ["no anchor", {}],
  ])("attachAsTail:true with %s errors BEFORE any request", async (_label, anchor) => {
    const { api, calls } = fakeApi();
    await expect(
      addPipelineStepHandler(api, { ...base, ...anchor, attachAsTail: true }),
    ).rejects.toThrow(/parentStepId/);
    expect(calls).toHaveLength(0);
  });

  it("an invalid anchor still fails loudly with the backend's reason", async () => {
    const { api } = fakeApi(async () => {
      throw new HelioApiError(
        422,
        "/api/pipelines/p1/steps",
        "parentStepId 'bogus' is not a step of this pipeline",
      );
    });
    await expect(addPipelineStepHandler(api, { ...base, parentStepId: "bogus" })).rejects.toThrow(
      /not a step of this pipeline/,
    );
  });
});
