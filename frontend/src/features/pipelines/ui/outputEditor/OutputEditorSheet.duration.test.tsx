import { screen } from "@testing-library/react";

import {
  choose,
  outputOf,
  renderSheet,
  save,
  setupEditorMocks,
} from "../../../../test/conditionalFormatsEditorHarness";

// HEL-1308 task 4.4 -- the REAL Output editor sheet.
beforeEach(setupEditorMocks);

const METRIC = { fieldMapping: { value: "amount" } };

describe("metric / collection Format select", () => {
  it("selects Duration, saves format: duration, and reopens showing Duration", async () => {
    renderSheet(outputOf("metric", METRIC));
    await choose("Format", "Duration");
    expect((await save()).format).toBe("duration");
  });

  it("reopens a stored durationMs metric showing Duration (ms)", async () => {
    renderSheet(outputOf("metric", { ...METRIC, format: "durationMs" }));
    expect(await screen.findByRole("combobox", { name: "Format" })).toHaveTextContent(
      "Duration (ms)",
    );
  });

  it("reopens a stored duration metric showing Duration", async () => {
    renderSheet(outputOf("metric", { ...METRIC, format: "duration" }));
    const select = await screen.findByRole("combobox", { name: "Format" });
    expect(select).toHaveTextContent(/^Duration$/);
  });

  it("collection: selects Duration (ms) and saves format: durationMs", async () => {
    renderSheet(outputOf("collection", { fieldMapping: { value: "amount", label: "status" } }));
    await choose("Format", "Duration (ms)");
    expect((await save()).format).toBe("durationMs");
  });
});

describe("table column Format select", () => {
  const TABLE = { fieldMapping: {} };

  async function saved(stored: Record<string, unknown>, steps: string[]) {
    renderSheet(outputOf("table", { ...TABLE, columnFormats: { duration_s: stored } }));
    for (const label of steps) await choose("Format duration_s", label);
    return ((await save()).columnFormats as Record<string, unknown>).duration_s;
  }

  it("Duration (s) on a fresh column saves { type: duration } with no unit", async () => {
    renderSheet(outputOf("table", TABLE));
    await choose("Format duration_s", "Duration (s)");
    expect(((await save()).columnFormats as Record<string, unknown>).duration_s).toEqual({
      type: "duration",
    });
  });

  it("Duration (ms) saves { type: duration, unit: ms }", async () => {
    renderSheet(outputOf("table", TABLE));
    await choose("Format duration_s", "Duration (ms)");
    expect(((await save()).columnFormats as Record<string, unknown>).duration_s).toEqual({
      type: "duration",
      unit: "ms",
    });
  });

  it("reopens a stored ms column as Duration (ms) and a stored seconds column as Duration (s)", async () => {
    renderSheet(
      outputOf("table", {
        ...TABLE,
        columnFormats: {
          duration_s: { type: "duration", unit: "ms" },
          amount: { type: "duration" },
        },
      }),
    );
    expect(await screen.findByRole("combobox", { name: "Format duration_s" })).toHaveTextContent(
      "Duration (ms)",
    );
    expect(screen.getByRole("combobox", { name: "Format amount" })).toHaveTextContent(
      "Duration (s)",
    );
  });

  it("ms -> Duration (s) saves no unit", async () => {
    expect(await saved({ type: "duration", unit: "ms" }, ["Duration (s)"])).toEqual({
      type: "duration",
    });
  });

  it("ms -> Number -> Duration (s) saves no unit", async () => {
    expect(await saved({ type: "duration", unit: "ms" }, ["Number", "Duration (s)"])).toEqual({
      type: "duration",
    });
  });

  // GUARD (the old reader dropped the unknown `duration` type, so it passed on base). Mutation that turns it red:
  // keep `unit` in useOutputColumnFormats.setFormat (`const rest = prev[key] ?? { type }`); red-guard-editor-unit.log.
  it("ms -> Number drops the unit", async () => {
    expect(await saved({ type: "duration", unit: "ms" }, ["Number"])).toEqual({ type: "number" });
  });
});
