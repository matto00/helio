// HEL-1744 D6 -- a citation chip is a button that opens the cited provenance popover anchored at itself.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { resetProvenanceCache } from "../provenance/provenanceCache";
import * as service from "../provenance/provenanceService";
import { CitationChip } from "./CitationChip";
import type { InsightCitation } from "./insightService";

jest.mock("../provenance/provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));
jest.mock("../provenance/provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const fetchAuth = jest.mocked(service.fetchOutputProvenance);
const fetchPublic = jest.mocked(service.fetchPublicProvenance);

const CHAIN: service.Provenance = {
  outputId: "cited-1",
  pipeline: { id: "pipe-1", name: "Weekly sales" },
  sources: [{ id: "src-1", name: "Orders CSV", kind: "csv" }],
  nodePath: ["filter"],
  lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 42 },
  assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: false },
};

const CITATION: InsightCitation = {
  id: "c1",
  outputId: "cited-1",
  field: "revenue",
  number: 12.5,
  isPct: false,
};

beforeEach(() => {
  resetProvenanceCache();
  fetchAuth.mockReset().mockResolvedValue(CHAIN);
  fetchPublic.mockReset().mockResolvedValue(CHAIN);
});

function renderChip(
  citation: InsightCitation,
  source: Parameters<typeof CitationChip>[0]["source"] = { variant: "authenticated" },
  parentClick = jest.fn(),
) {
  render(
    <MemoryRouter>
      <div onClick={parentClick} onKeyDown={parentClick}>
        <CitationChip citation={citation} ordinal={1} insightPanelId="ins-panel" source={source} />
      </div>
    </MemoryRouter>,
  );
  return parentClick;
}

const chip = () => screen.getByRole("button", { name: /^Source: revenue/ });

describe("CitationChip", () => {
  it("is a button naming the cited field and value, with dialog semantics", () => {
    renderChip(CITATION);
    expect(chip()).toHaveAccessibleName("Source: revenue 12.5, open provenance");
    expect(chip()).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip()).toHaveAttribute("aria-expanded", "false");
    expect(chip().tagName).toBe("BUTTON");
  });

  it("opens the cited Output's provenance, moves focus in, and returns it on Escape", async () => {
    const parentClick = renderChip(CITATION);
    fireEvent.click(chip());
    const dialog = await screen.findByRole("dialog", { name: "Source: revenue" });
    expect(fetchAuth).toHaveBeenCalledWith("cited-1");
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(chip()).toHaveAttribute("aria-expanded", "true");
    expect(parentClick).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(chip());
  });

  it("opens from the keyboard (Enter on the button)", async () => {
    renderChip(CITATION);
    chip().focus();
    fireEvent.click(chip()); // a button's Enter/Space activation is a click
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("public: opens the placed panel's provenance when the citation names one", async () => {
    renderChip(
      { id: "c1", field: "revenue", number: 1, isPct: false, panelId: "pan-7" },
      {
        variant: "public",
        dashboardId: "dash-1",
        token: "tok",
      },
    );
    fireEvent.click(chip());
    await screen.findByRole("dialog");
    expect(fetchPublic).toHaveBeenCalledWith("dash-1", "pan-7", "tok");
    expect(fetchAuth).not.toHaveBeenCalled();
  });

  it("public: falls back to the insight panel's own provenance when no panel is named", async () => {
    renderChip(
      { id: "c1", field: "revenue", number: 1, isPct: false },
      {
        variant: "public",
        dashboardId: "dash-1",
        token: "tok",
      },
    );
    fireEvent.click(chip());
    await screen.findByRole("dialog");
    expect(fetchPublic).toHaveBeenCalledWith("dash-1", "ins-panel", "tok");
  });
});
