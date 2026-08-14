/**
 * HEL-411 tasks.md 6.3 — call-routing tests for `proposePatchSetHandler`/`applyPatchSetHandler`.
 *
 * Imports from `./refinementHandlers.js` (NOT `./refinement.js`) deliberately, per
 * `combinedProposalHandlers.test.ts`'s own precedent — that module holds no zod/`registerTool`
 * surface, so it never risks the TS2589 combination `refinement.ts` (zod schemas) has.
 *
 * Uses a minimal hand-rolled `HelioApi`-shaped mock, mirroring
 * `combinedProposalHandlers.test.ts`'s `makeFakeApi`.
 */

import { HelioApiError } from "../httpClient.js";
import type { PatchSet, PatchSetApplyResponse, RefinementResult } from "../types.js";
import type { HelioApi } from "../helioApi.js";
import { applyPatchSetHandler, proposePatchSetHandler } from "./refinementHandlers.js";

const patchSet: PatchSet = {
  summary: "Rename the panel",
  edits: [
    {
      target: { kind: "panel", id: "panel-1" },
      op: "update",
      patch: { title: "New title" },
    },
  ],
};

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    proposePatchSet: async () => {
      throw new Error("proposePatchSet not stubbed");
    },
    applyPatchSet: async () => {
      throw new Error("applyPatchSet not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

describe("proposePatchSetHandler", () => {
  it("calls api.proposePatchSet with the given input and returns its result verbatim", async () => {
    const result: RefinementResult = { patchSet, conversationId: "conv-1" };
    let calledWith: unknown;
    const api = makeFakeApi({
      proposePatchSet: async (input: unknown) => {
        calledWith = input;
        return result;
      },
    });

    const input = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "make it a bar chart",
    };
    const returned = await proposePatchSetHandler(api, input);

    expect(calledWith).toEqual(input);
    expect(returned).toBe(result);
  });

  it("never calls api.applyPatchSet — a propose call writes nothing", async () => {
    let applyCalled = false;
    const api = makeFakeApi({
      proposePatchSet: async () => ({ patchSet, conversationId: "conv-1" }) as RefinementResult,
      applyPatchSet: async () => {
        applyCalled = true;
        return { edits: [] } as PatchSetApplyResponse;
      },
    });

    await proposePatchSetHandler(api, {
      target: { kind: "dashboard", id: "dash-1" },
      message: "drop the last panel",
    });

    expect(applyCalled).toBe(false);
  });

  it("propagates a rejected api.proposePatchSet call (e.g. a missing/inaccessible target) as a rejected promise, verbatim", async () => {
    const api = makeFakeApi({
      proposePatchSet: async () => {
        throw new HelioApiError(404, "/api/refinements", "Dashboard not found");
      },
    });

    await expect(
      proposePatchSetHandler(api, { target: { kind: "dashboard", id: "missing" }, message: "hi" }),
    ).rejects.toThrow("Dashboard not found");
  });
});

describe("applyPatchSetHandler", () => {
  it("calls api.applyPatchSet with the exact patch set and returns its result verbatim", async () => {
    const response: PatchSetApplyResponse = {
      edits: [
        { index: 0, status: "applied", resultingState: { id: "panel-1", title: "New title" } },
      ],
    };
    let calledWith: PatchSet | undefined;
    const api = makeFakeApi({
      applyPatchSet: async (p: PatchSet) => {
        calledWith = p;
        return response;
      },
    });

    const result = await applyPatchSetHandler(api, patchSet);

    expect(calledWith).toEqual(patchSet);
    expect(result).toBe(response);
  });

  it("propagates a rejected api.applyPatchSet call as a rejected promise, verbatim", async () => {
    const api = makeFakeApi({
      applyPatchSet: async () => {
        throw new HelioApiError(422, "/api/patch-sets/apply", "edit 0: panel not found");
      },
    });

    await expect(applyPatchSetHandler(api, patchSet)).rejects.toThrow("panel not found");
  });
});
