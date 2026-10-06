import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { resetProvenanceCache } from "./provenanceCache";
import * as service from "./provenanceService";
import { ProvenanceTrigger } from "./ProvenanceTrigger";
import {
  publishComparison,
  resetComparisonStore,
  unpublishComparison,
} from "../history/metricComparisonStore";

jest.mock("./provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));
jest.mock("./provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const chain: service.Provenance = {
  pipeline: { id: "pipe-1", name: "Weekly sales" },
  sources: [{ name: "Orders CSV", kind: "csv" }],
  nodePath: [],
  lastRun: { status: "succeeded", completedAt: "2026-10-05T10:00:00Z", rowCount: 4 },
  assertions: { defined: false, passed: 0, failed: 0, warned: 0 },
};
const COMPARISON = { baselineAt: "2026-09-28T09:00:00Z", baselineText: "1,075" };

async function openFor(variant: "authenticated" | "public") {
  render(
    <MemoryRouter>
      <ProvenanceTrigger
        panelId="panel-1"
        panelTitle="Sales"
        outputId="out-1"
        variant={variant}
        dashboardId={variant === "public" ? "d1" : undefined}
        token={variant === "public" ? "tok" : undefined}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
  await screen.findByText("Weekly sales");
}

beforeEach(() => {
  resetProvenanceCache();
  resetComparisonStore();
  jest.mocked(service.fetchOutputProvenance).mockReset().mockResolvedValue(chain);
  jest.mocked(service.fetchPublicProvenance).mockReset().mockResolvedValue(chain);
});

describe("ProvenanceTrigger — Compared with (HEL-1275)", () => {
  it("shows the baseline time and value when the panel published a comparison", async () => {
    const p = Symbol("card");
    publishComparison("authenticated:panel-1", p, COMPARISON);
    await openFor("authenticated");
    expect(screen.getByRole("heading", { name: "Compared with" })).toBeInTheDocument();
    expect(screen.getByText(/1,075/)).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-09-28T09:00:00Z"]')).toBeInTheDocument();
  });

  it("shows no row when nothing is published (no delta, or hidden by a filter)", async () => {
    publishComparison("authenticated:panel-1", Symbol("card"), null);
    await openFor("authenticated");
    expect(screen.queryByText("Compared with")).toBeNull();
  });

  it("the public variant reads its own key", async () => {
    publishComparison("authenticated:panel-1", Symbol("a"), COMPARISON);
    await openFor("public");
    expect(screen.queryByText("Compared with")).toBeNull();
  });

  it("the public variant shows the row when published under the public key", async () => {
    publishComparison("public:panel-1", Symbol("p"), COMPARISON);
    await openFor("public");
    expect(screen.getByRole("heading", { name: "Compared with" })).toBeInTheDocument();
  });

  it("updates live when the panel hides its delta", async () => {
    const p = Symbol("card");
    publishComparison("authenticated:panel-1", p, COMPARISON);
    await openFor("authenticated");
    act(() => unpublishComparison("authenticated:panel-1", p));
    expect(screen.queryByText("Compared with")).toBeNull();
  });
});
