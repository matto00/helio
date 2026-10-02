/**
 * HEL-1071 — `update_dashboard_layout` sets only the breakpoint(s) it names (no more copy-to-all),
 * and the backend's 400 (breakpoint + panel ids) reaches the caller verbatim. Imports the
 * zod-free `layoutHandlers.ts` (not `write.ts`, which is pathologically expensive to type-check
 * under the root jest config — see `write.test.ts`'s header).
 */

import type { HelioApi } from "../helioApi.js";
import { updateDashboardLayoutHandler } from "./layoutHandlers.js";

const xsItems = [
  { panelId: "a", x: 0, y: 0, w: 1, h: 2 },
  { panelId: "b", x: 1, y: 0, w: 1, h: 2 },
];

function fakeApi() {
  const calls: { dashboardId: string; layout: unknown }[] = [];
  const api = {
    updateDashboardLayout: async (dashboardId: string, layout: unknown) => {
      calls.push({ dashboardId, layout });
      return { id: dashboardId };
    },
  } as unknown as HelioApi;
  return { api, calls };
}

describe("updateDashboardLayoutHandler", () => {
  it("sets only the named breakpoint: items + breakpoint xs sends xs alone", async () => {
    const { api, calls } = fakeApi();
    await updateDashboardLayoutHandler(api, { dashboardId: "d", items: xsItems, breakpoint: "xs" });
    expect(calls).toEqual([{ dashboardId: "d", layout: { xs: xsItems } }]);
    expect(Object.keys(calls[0]?.layout as object)).toEqual(["xs"]);
  });

  it("defaults the breakpoint to lg and never copies the items to the other breakpoints", async () => {
    const { api, calls } = fakeApi();
    await updateDashboardLayoutHandler(api, { dashboardId: "d", items: xsItems });
    expect(Object.keys(calls[0]?.layout as object)).toEqual(["lg"]);
  });

  it("forwards a per-breakpoint `layouts` map as given, naming only what was supplied", async () => {
    const { api, calls } = fakeApi();
    const layouts = { sm: xsItems, xs: xsItems };
    await updateDashboardLayoutHandler(api, { dashboardId: "d", layouts });
    expect(calls[0]?.layout).toEqual(layouts);
    expect(Object.keys(calls[0]?.layout as object)).toEqual(["sm", "xs"]);
  });

  it("rejects both `items` and `layouts`, or neither, before any API call", async () => {
    const { api, calls } = fakeApi();
    await expect(
      updateDashboardLayoutHandler(api, {
        dashboardId: "d",
        items: xsItems,
        layouts: { xs: xsItems },
      }),
    ).rejects.toThrow(/exactly one/);
    await expect(updateDashboardLayoutHandler(api, { dashboardId: "d" })).rejects.toThrow(
      /exactly one/,
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects `breakpoint` combined with `layouts`, and an empty `layouts`, before any API call", async () => {
    const { api, calls } = fakeApi();
    await expect(
      updateDashboardLayoutHandler(api, {
        dashboardId: "d",
        layouts: { xs: xsItems },
        breakpoint: "xs",
      }),
    ).rejects.toThrow(/breakpoint/);
    await expect(
      updateDashboardLayoutHandler(api, { dashboardId: "d", layouts: {} }),
    ).rejects.toThrow(/at least one/);
    expect(calls).toHaveLength(0);
  });

  it("propagates the backend's 400 (breakpoint + panel ids) unchanged", async () => {
    const message = "Layout rejected: breakpoint 'xs': panels 'a' and 'b' overlap";
    const api = {
      updateDashboardLayout: async () => {
        throw new Error(message);
      },
    } as unknown as HelioApi;
    await expect(
      updateDashboardLayoutHandler(api, { dashboardId: "d", items: xsItems, breakpoint: "xs" }),
    ).rejects.toThrow(message);
  });
});
