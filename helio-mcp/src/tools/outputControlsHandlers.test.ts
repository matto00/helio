/**
 * HEL-1193 — the control tools' read-modify-write handlers against a hand-rolled `HelioApi` fake.
 * Every "no write" case asserts `updatePanel` was never called.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { OutputFilterCapabilitiesResponse } from "../types.js";
import {
  addOutputControlHandler,
  ControlToolError,
  removeOutputControlHandler,
  updateOutputControlHandler,
} from "./outputControlsHandlers.js";

const target = { dashboardId: "dash-1", panelId: "panel-1" };

const filterCapabilities: OutputFilterCapabilitiesResponse = {
  columns: [
    {
      column: "amount",
      operators: ["contains", "gte", "lte"],
      controlKinds: ["numeric-range", "text"],
    },
    {
      column: "created_at",
      operators: ["contains", "gte", "lte", "eq", "in"],
      controlKinds: ["date-range", "dropdown", "text"],
    },
    { column: "region", operators: ["contains", "eq", "in"], controlKinds: ["dropdown", "text"] },
  ],
};

function makeApi(opts: {
  panelType?: string;
  controls?: unknown[];
  panelMissing?: boolean;
  updatePanel?: jest.Mock;
}) {
  const updatePanel = opts.updatePanel ?? jest.fn(async () => ({ id: "panel-1" }));
  const getOutputFilterCapabilities = jest.fn(async () => filterCapabilities);
  const api = {
    getDashboardSnapshot: async () => ({
      panels: opts.panelMissing
        ? []
        : [
            {
              id: "panel-1",
              type: opts.panelType ?? "output",
              config: { outputId: "out-1", controls: opts.controls ?? [] },
            },
          ],
    }),
    getOutputFilterCapabilities,
    updatePanel,
  } as unknown as HelioApi;
  return { api, updatePanel, getOutputFilterCapabilities };
}

const existing = { id: "c-1", kind: "text", column: "region", label: "Region" };

describe("addOutputControlHandler", () => {
  it("auto-binds a date-range control to the first column whose controlKinds include it, minting the id", async () => {
    const { api, updatePanel } = makeApi({});

    await addOutputControlHandler(api, { ...target, kind: "date-range" }, () => "minted-id");

    expect(updatePanel).toHaveBeenCalledWith("panel-1", {
      config: {
        controls: [
          { id: "minted-id", kind: "date-range", column: "created_at", label: "created_at" },
        ],
      },
    });
  });

  it("picks the FIRST eligible column in schema order when several qualify", async () => {
    const { api, updatePanel } = makeApi({});

    await addOutputControlHandler(api, { ...target, kind: "text" }, () => "id");

    const sent = updatePanel.mock.calls[0]![1] as {
      config: { controls: Array<{ column: string }> };
    };
    expect(sent.config.controls[0]?.column).toBe("amount");
  });

  it("appends to the panel's existing controls instead of replacing them", async () => {
    const { api, updatePanel } = makeApi({ controls: [existing] });

    await addOutputControlHandler(
      api,
      { ...target, kind: "numeric-range", label: "Amt" },
      () => "new",
    );

    const sent = updatePanel.mock.calls[0]![1] as { config: { controls: unknown[] } };
    expect(sent.config.controls).toEqual([
      existing,
      { id: "new", kind: "numeric-range", column: "amount", label: "Amt" },
    ]);
  });

  it("sends an explicit column as-is without consulting the capability contract", async () => {
    const { api, updatePanel, getOutputFilterCapabilities } = makeApi({});

    await addOutputControlHandler(
      api,
      { ...target, kind: "date-range", column: "region" },
      () => "id",
    );

    expect(getOutputFilterCapabilities).not.toHaveBeenCalled();
    expect(updatePanel).toHaveBeenCalledTimes(1);
  });

  it("surfaces the backend's 400 unchanged when the explicit column is ineligible", async () => {
    const updatePanel = jest.fn(async () => {
      throw new HelioApiError(
        400,
        "/api/panels/panel-1",
        "400 Bad Request: control not eligible: column 'region', kind 'date-range'",
      );
    });
    const { api } = makeApi({ updatePanel });

    await expect(
      addOutputControlHandler(api, { ...target, kind: "date-range", column: "region" }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("control not eligible: column 'region', kind 'date-range'"),
    });
  });

  it("refuses without writing when no column is eligible for the kind, listing the kinds per column", async () => {
    const { api, updatePanel, getOutputFilterCapabilities } = makeApi({});
    getOutputFilterCapabilities.mockResolvedValueOnce({
      columns: [{ column: "region", operators: ["contains"], controlKinds: ["text"] }],
    });

    await expect(addOutputControlHandler(api, { ...target, kind: "date-range" })).rejects.toThrow(
      /No column .* eligible for a 'date-range' control.*region: \[text\]/,
    );
    expect(updatePanel).not.toHaveBeenCalled();
  });

  it("refuses a non-output panel without writing", async () => {
    const { api, updatePanel } = makeApi({ panelType: "text" });

    await expect(
      addOutputControlHandler(api, { ...target, kind: "text", column: "x" }),
    ).rejects.toThrow(ControlToolError);
    expect(updatePanel).not.toHaveBeenCalled();
  });

  it("refuses a panel that is not on the dashboard without writing", async () => {
    const { api, updatePanel } = makeApi({ panelMissing: true });

    await expect(
      addOutputControlHandler(api, { ...target, kind: "text", column: "x" }),
    ).rejects.toThrow(/not found on dashboard/);
    expect(updatePanel).not.toHaveBeenCalled();
  });

  it("strips read-time-only attributes from existing controls so the backend's strict decoder accepts the write", async () => {
    const { api, updatePanel } = makeApi({ controls: [{ ...existing, orphaned: true }] });

    await addOutputControlHandler(api, { ...target, kind: "text", column: "region" }, () => "n");

    const sent = updatePanel.mock.calls[0]![1] as {
      config: { controls: Array<Record<string, unknown>> };
    };
    expect(sent.config.controls[0]).toEqual(existing);
  });
});

describe("updateOutputControlHandler", () => {
  it("patches only the supplied fields of the matching control and leaves the others untouched", async () => {
    const other = { id: "c-2", kind: "text", column: "region", label: "Other" };
    const { api, updatePanel } = makeApi({
      controls: [{ ...existing, defaultValue: "EU" }, other],
    });

    await updateOutputControlHandler(api, { ...target, controlId: "c-1", label: "Area" });

    expect(updatePanel).toHaveBeenCalledWith("panel-1", {
      config: { controls: [{ ...existing, label: "Area", defaultValue: "EU" }, other] },
    });
  });

  it("clears the default when defaultValue is null", async () => {
    const { api, updatePanel } = makeApi({ controls: [{ ...existing, defaultValue: "EU" }] });

    await updateOutputControlHandler(api, { ...target, controlId: "c-1", defaultValue: null });

    expect(updatePanel).toHaveBeenCalledWith("panel-1", { config: { controls: [existing] } });
  });

  it("refuses an unknown control id without writing, naming the ids that exist", async () => {
    const { api, updatePanel } = makeApi({ controls: [existing] });

    await expect(
      updateOutputControlHandler(api, { ...target, controlId: "nope", label: "x" }),
    ).rejects.toThrow(/nope.*present: c-1/);
    expect(updatePanel).not.toHaveBeenCalled();
  });
});

describe("removeOutputControlHandler", () => {
  it("removes only the matching control", async () => {
    const other = { id: "c-2", kind: "text", column: "region", label: "Other" };
    const { api, updatePanel } = makeApi({ controls: [existing, other] });

    await removeOutputControlHandler(api, { ...target, controlId: "c-1" });

    expect(updatePanel).toHaveBeenCalledWith("panel-1", { config: { controls: [other] } });
  });

  it("refuses an unknown control id without writing", async () => {
    const { api, updatePanel } = makeApi({ controls: [existing] });

    await expect(removeOutputControlHandler(api, { ...target, controlId: "nope" })).rejects.toThrow(
      ControlToolError,
    );
    expect(updatePanel).not.toHaveBeenCalled();
  });
});
