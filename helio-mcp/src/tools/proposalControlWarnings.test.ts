/** HEL-1193 — propose-time control warnings read the backend's own `controlKinds` contract. */

import type { HelioApi } from "../helioApi.js";
import type { OutputFilterCapabilitiesResponse, ProposalPanel } from "../types.js";
import { computeControlWarnings } from "./proposalValidation.js";

const contract: OutputFilterCapabilitiesResponse = {
  columns: [
    {
      column: "created_at",
      operators: ["contains", "gte", "lte"],
      controlKinds: ["date-range", "text"],
    },
    { column: "region", operators: ["contains", "eq", "in"], controlKinds: ["dropdown", "text"] },
  ],
};

const api = (fn: jest.Mock) =>
  ({ getOutputFilterCapabilities: fn }) as unknown as Pick<HelioApi, "getOutputFilterCapabilities">;

const outputPanel = (extra: Partial<ProposalPanel>): ProposalPanel => ({
  title: "Orders",
  type: "output",
  outputId: "out-1",
  ...extra,
});

describe("computeControlWarnings", () => {
  it("is silent for an eligible control", async () => {
    const fn = jest.fn(async () => contract);

    const warnings = await computeControlWarnings(
      [outputPanel({ controls: [{ kind: "date-range", column: "created_at" }] })],
      api(fn),
    );

    expect(warnings).toEqual([]);
  });

  it("reports an ineligible kind with the backend's message wording", async () => {
    const fn = jest.fn(async () => contract);

    const warnings = await computeControlWarnings(
      [outputPanel({ controls: [{ kind: "date-range", column: "region" }] })],
      api(fn),
    );

    expect(warnings).toEqual([
      "panel 1 ('Orders'): control not eligible: column 'region', kind 'date-range'",
    ]);
  });

  it("reports an unknown column the same way", async () => {
    const warnings = await computeControlWarnings(
      [outputPanel({ controls: [{ kind: "text", column: "nope" }] })],
      api(jest.fn(async () => contract)),
    );

    expect(warnings[0]).toContain("column 'nope', kind 'text'");
  });

  it("also checks controls smuggled through config.controls", async () => {
    const warnings = await computeControlWarnings(
      [
        outputPanel({
          config: { controls: [{ id: "c", kind: "date-range", column: "region", label: "R" }] },
        }),
      ],
      api(jest.fn(async () => contract)),
    );

    expect(warnings).toHaveLength(1);
  });

  it("fetches each Output's contract once even with several panels", async () => {
    const fn = jest.fn(async () => contract);

    await computeControlWarnings(
      [
        outputPanel({ controls: [{ kind: "text", column: "region" }] }),
        outputPanel({ controls: [{ kind: "text", column: "created_at" }] }),
      ],
      api(fn),
    );

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("skips a panel whose Output contract cannot be fetched (the missing-Output warning covers it)", async () => {
    const warnings = await computeControlWarnings(
      [outputPanel({ controls: [{ kind: "text", column: "x" }] })],
      api(jest.fn(async () => Promise.reject(new Error("404")))),
    );

    expect(warnings).toEqual([]);
  });
});
