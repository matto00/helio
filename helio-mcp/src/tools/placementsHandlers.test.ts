/**
 * HEL-907 task 3.6 — call-routing tests for `placeOutputsHandler`/
 * `createContentPanelHandler`. Mirrors `pipelineProposalHandlers.test.ts`'s
 * fixture convention.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { PanelResponse } from "../types.js";
import { createContentPanelHandler, placeOutputsHandler } from "./placementsHandlers.js";

function panel(id: string, title: string): PanelResponse {
  return {
    id,
    dashboardId: "dash-1",
    title,
    type: "output",
    meta: { createdBy: "user-1", createdAt: "", lastUpdated: "" },
    appearance: {},
    ownerId: "user-1",
    config: { outputId: "output-1" },
    dataAsOf: null,
  };
}

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    placeOutputs: async () => {
      throw new Error("placeOutputs not stubbed");
    },
    autoLayoutDashboard: async () => {
      throw new Error("autoLayoutDashboard not stubbed");
    },
    createContentPanel: async () => {
      throw new Error("createContentPanel not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

describe("placeOutputsHandler", () => {
  it("calls api.placeOutputs with outputId/title only (w/h stripped) and returns its result", async () => {
    let calledWith: unknown;
    const p1 = panel("panel-1", "Revenue");
    const api = makeFakeApi({
      placeOutputs: async (dashboardId: string, items: unknown) => {
        calledWith = [dashboardId, items];
        return { panels: [p1] };
      },
      autoLayoutDashboard: async () => ({ dashboard: {}, panels: [] }),
    });

    const result = await placeOutputsHandler(api, {
      dashboardId: "dash-1",
      items: [{ outputId: "output-1", title: "Revenue" }],
    });

    expect(calledWith).toEqual(["dash-1", [{ outputId: "output-1", title: "Revenue" }]]);
    expect(result).toEqual({ panels: [p1] });
  });

  it("does NOT call auto_layout_dashboard when no item carries a w/h size hint", async () => {
    let autoLayoutCalled = false;
    const p1 = panel("panel-1", "Revenue");
    const api = makeFakeApi({
      placeOutputs: async () => ({ panels: [p1] }),
      autoLayoutDashboard: async () => {
        autoLayoutCalled = true;
        return { dashboard: {}, panels: [] };
      },
    });

    await placeOutputsHandler(api, { dashboardId: "dash-1", items: [{ outputId: "output-1" }] });

    expect(autoLayoutCalled).toBe(false);
  });

  it("follows up with auto_layout_dashboard ONLY for items that carried a w/h hint, using the newly-created panel ids", async () => {
    const p1 = panel("panel-1", "Sized");
    const p2 = panel("panel-2", "Unsized");
    let autoLayoutCalledWith: unknown;
    const api = makeFakeApi({
      placeOutputs: async () => ({ panels: [p1, p2] }),
      autoLayoutDashboard: async (dashboardId: string, items: unknown) => {
        autoLayoutCalledWith = [dashboardId, items];
        return { dashboard: {}, panels: [] };
      },
    });

    await placeOutputsHandler(api, {
      dashboardId: "dash-1",
      items: [{ outputId: "output-1", w: 6, h: 3 }, { outputId: "output-2" }],
    });

    expect(autoLayoutCalledWith).toEqual(["dash-1", [{ panelId: "panel-1", w: 6, h: 3 }]]);
  });

  it("defaults the missing dimension to 4 when only one of w/h is given", async () => {
    const p1 = panel("panel-1", "Sized");
    let autoLayoutCalledWith: unknown;
    const api = makeFakeApi({
      placeOutputs: async () => ({ panels: [p1] }),
      autoLayoutDashboard: async (dashboardId: string, items: unknown) => {
        autoLayoutCalledWith = items;
        return { dashboard: {}, panels: [] };
      },
    });

    await placeOutputsHandler(api, {
      dashboardId: "dash-1",
      items: [{ outputId: "output-1", w: 8 }],
    });

    expect(autoLayoutCalledWith).toEqual([{ panelId: "panel-1", w: 8, h: 4 }]);
  });

  it("propagates a rejected api.placeOutputs call (e.g. an unknown outputId) as a rejected promise, never calling auto_layout_dashboard", async () => {
    let autoLayoutCalled = false;
    const api = makeFakeApi({
      placeOutputs: async () => {
        throw new HelioApiError(404, "/api/panels/batch", "Output not found");
      },
      autoLayoutDashboard: async () => {
        autoLayoutCalled = true;
        return { dashboard: {}, panels: [] };
      },
    });

    await expect(
      placeOutputsHandler(api, { dashboardId: "dash-1", items: [{ outputId: "bogus" }] }),
    ).rejects.toThrow(HelioApiError);
    expect(autoLayoutCalled).toBe(false);
  });
});

describe("createContentPanelHandler", () => {
  it("calls api.createContentPanel with the given input and returns its result", async () => {
    const p1 = panel("panel-1", "A note");
    let calledWith: unknown;
    const api = makeFakeApi({
      createContentPanel: async (input: unknown) => {
        calledWith = input;
        return p1;
      },
    });

    const result = await createContentPanelHandler(api, {
      dashboardId: "dash-1",
      title: "A note",
      type: "markdown",
      config: { content: "hello" },
    });

    expect(calledWith).toEqual({
      dashboardId: "dash-1",
      title: "A note",
      type: "markdown",
      config: { content: "hello" },
    });
    expect(result).toBe(p1);
  });

  it("propagates a rejected api.createContentPanel call as a rejected promise", async () => {
    const api = makeFakeApi({
      createContentPanel: async () => {
        throw new HelioApiError(400, "/api/panels", "invalid config");
      },
    });

    await expect(
      createContentPanelHandler(api, { dashboardId: "dash-1", type: "text" }),
    ).rejects.toThrow(HelioApiError);
  });
});
