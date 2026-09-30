import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { resetProvenanceCache } from "./provenanceCache";
import * as fanout from "../services/pipelineRunFanout";
import * as service from "./provenanceService";
import * as telemetry from "./provenanceTelemetry";
import { ProvenanceTrigger, type ProvenanceTriggerProps } from "./ProvenanceTrigger";
import type { Provenance } from "./provenanceService";

jest.mock("./provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));
jest.mock("./provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));

jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));
const subscribeTerminal = jest.mocked(fanout.subscribeToPipelineTerminal);

const fetchAuth = jest.mocked(service.fetchOutputProvenance);
const fetchPublic = jest.mocked(service.fetchPublicProvenance);
const opened = jest.mocked(telemetry.onProvenanceOpened);

function chain(overrides: Partial<Provenance> = {}): Provenance {
  return {
    outputId: "out-1",
    pipeline: { id: "pipe-1", name: "Weekly sales" },
    sources: [{ id: "src-1", name: "Orders CSV", kind: "csv" }],
    nodePath: ["filter", "aggregate"],
    lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 42 },
    assertions: { defined: true, passed: 3, failed: 0, warned: 0, rootBound: false },
    ...overrides,
  };
}

const baseProps: ProvenanceTriggerProps = {
  panelId: "panel-1",
  panelTitle: "Sales",
  outputId: "out-1",
  variant: "authenticated",
};

function renderTrigger(props: Partial<ProvenanceTriggerProps> = {}, onParentClick = jest.fn()) {
  render(
    <MemoryRouter>
      <div onClick={onParentClick} onKeyDown={onParentClick}>
        <ProvenanceTrigger {...baseProps} {...props} />
      </div>
    </MemoryRouter>,
  );
  return onParentClick;
}

const trigger = () => screen.getByRole("button", { name: "Data provenance" });
async function openPopover() {
  fireEvent.click(trigger());
  return screen.findByRole("dialog", { name: "Data provenance for Sales" });
}

beforeEach(() => {
  resetProvenanceCache();
  fetchAuth.mockReset().mockResolvedValue(chain());
  fetchPublic.mockReset();
  opened.mockClear();
  subscribeTerminal.mockClear();
});

describe("ProvenanceTrigger (HEL-1207)", () => {
  it("makes no request until opened and exactly one across two opens", async () => {
    renderTrigger();
    expect(fetchAuth).not.toHaveBeenCalled();
    await openPopover();
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openPopover();
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    expect(fetchAuth).toHaveBeenCalledTimes(1);
  });

  it("shows source, pipeline, human step labels, run, row count, checks and the pipeline link", async () => {
    renderTrigger();
    await openPopover();
    expect(await screen.findByText("Orders CSV")).toBeInTheDocument();
    expect(screen.getByText("Filter rows")).toBeInTheDocument();
    expect(screen.getByText("Group & aggregate")).toBeInTheDocument();
    expect(screen.queryByText("aggregate")).toBeNull();
    expect(screen.getByText("42 rows")).toBeInTheDocument();
    expect(screen.getByText("3 passed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open pipeline" })).toHaveAttribute(
      "href",
      "/pipelines/pipe-1?outputId=out-1",
    );
    const time = document.querySelector("time");
    expect(time?.getAttribute("title")).toBeTruthy();
    expect(time?.getAttribute("tabindex")).toBe("0");
  });

  it("falls back to a humanised label for a join kind in the node path", async () => {
    fetchAuth.mockResolvedValue(chain({ nodePath: ["join"] }));
    renderTrigger();
    await openPopover();
    expect(await screen.findByText("Join")).toBeInTheDocument();
  });

  it("renders a root-bound output as Direct from source, no path list", async () => {
    fetchAuth.mockResolvedValue(chain({ nodePath: [] }));
    renderTrigger();
    await openPopover();
    expect(await screen.findByText("Direct from source")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Steps, in order" })).toBeNull();
  });

  it("distinguishes never run, running, failed, no rows and n rows", async () => {
    fetchAuth.mockResolvedValue(chain({ lastRun: null }));
    renderTrigger();
    await openPopover();
    expect(await screen.findByText("Never run")).toBeInTheDocument();
    expect(screen.queryByText(/no rows/)).toBeNull();
  });

  it.each([
    [{ status: "running", completedAt: null, rowCount: null }, "A run is in progress"],
    [{ status: "failed", completedAt: "2026-09-29T10:00:00Z", rowCount: null }, /Last run failed/],
    [
      { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: null },
      "No rows recorded for this output",
    ],
  ])("degraded last run %j", async (lastRun, expected) => {
    fetchAuth.mockResolvedValue(chain({ lastRun }));
    renderTrigger();
    await openPopover();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText("Never run")).toBeNull();
    expect(screen.queryByText("0 rows")).toBeNull();
  });

  it("shows no checks defined, and multi-source", async () => {
    fetchAuth.mockResolvedValue(
      chain({
        assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: true },
        sources: [
          { id: "a", name: "Orders", kind: "csv" },
          { id: "b", name: "Customers", kind: "sql" },
        ],
      }),
    );
    renderTrigger();
    await openPopover();
    expect(await screen.findByText("No checks defined")).toBeInTheDocument();
    expect(screen.getByText("Sources (2)")).toBeInTheDocument();
    expect(screen.getByText("Customers")).toBeInTheDocument();
  });

  it("calls the telemetry hook point once per open with panel id and variant", async () => {
    renderTrigger();
    await openPopover();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ panelId: "panel-1", variant: "authenticated" });
  });

  it("public variant sends the token, renders no link or ids", async () => {
    fetchPublic.mockResolvedValue({
      pipeline: { name: "Weekly sales" },
      sources: [{ name: "Orders CSV", kind: "csv" }],
      nodePath: [],
      lastRun: null,
      assertions: { defined: false, passed: 0, failed: 0, warned: 0 },
    });
    renderTrigger({ variant: "public", dashboardId: "dash-1", token: "tok-9" });
    await openPopover();
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    expect(fetchPublic).toHaveBeenCalledWith("dash-1", "panel-1", "tok-9");
    expect(fetchAuth).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/pipe-1|out-1|src-1/);
  });

  it("Escape closes and returns focus to the trigger", async () => {
    renderTrigger();
    await openPopover();
    await screen.findByText("Weekly sales");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger()).toHaveFocus();
  });

  it("moves focus in and wraps Tab / Shift+Tab inside the popover", async () => {
    renderTrigger();
    const dialog = await openPopover();
    await screen.findByText("Weekly sales");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const close = screen.getByRole("button", { name: "Close provenance" });
    const link = screen.getByRole("link", { name: "Open pipeline" });
    link.focus();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(link).toHaveFocus();
  });

  it("does not leak click or key events to the host", async () => {
    const onParent = renderTrigger();
    const dialog = await openPopover();
    const callsAfterOpen = onParent.mock.calls.length;
    await screen.findByText("Weekly sales");
    fireEvent.click(screen.getByText("Weekly sales"));
    fireEvent.keyDown(dialog, { key: "a" });
    fireEvent.click(trigger());
    expect(onParent.mock.calls.length).toBe(callsAfterOpen);
  });

  it("the Invalid data badge opens the same popover, focused on Checks, one request", async () => {
    fetchAuth.mockResolvedValue(
      chain({ assertions: { defined: true, passed: 1, failed: 2, warned: 0, rootBound: false } }),
    );
    renderTrigger({ invalidBadge: true });
    const badge = screen.getByRole("button", { name: "Data checks failed - view provenance" });
    expect(badge.tagName).toBe("BUTTON");
    fireEvent.click(badge);
    const checks = await screen.findByRole("heading", { name: "Checks" });
    await waitFor(() => expect(checks).toHaveFocus());
    expect(screen.getByText("2 failed")).toBeInTheDocument();
    expect(fetchAuth).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(badge).toHaveFocus());
  });

  it("shows a retry on failure and evicts so retry refetches", async () => {
    fetchAuth.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(chain());
    renderTrigger();
    await openPopover();
    const retry = await screen.findByRole("button", { name: "Retry" });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByText("Weekly sales")).toBeInTheDocument();
    expect(fetchAuth).toHaveBeenCalledTimes(2);
  });

  it("a pipeline run event evicts the cache so the next open refetches (no run: still one request)", async () => {
    renderTrigger();
    await openPopover();
    await screen.findByText("Weekly sales");
    expect(subscribeTerminal).toHaveBeenCalledWith("pipe-1", expect.any(Function));
    const onRun = subscribeTerminal.mock.calls[0][1];
    const unsubscribe = subscribeTerminal.mock.results[0].value as jest.Mock;

    // Control: close and reopen with no run in between -> still exactly one request.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openPopover();
    await screen.findByText("Weekly sales");
    expect(fetchAuth).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The subscription outlives the popover: staleness happens while it is closed.
    expect(unsubscribe).not.toHaveBeenCalled();

    // A run lands, the chain now reports a newer run; the next open must refetch and show it.
    fetchAuth.mockResolvedValueOnce(
      chain({ lastRun: { status: "failed", completedAt: "2026-09-30T10:00:00Z", rowCount: null } }),
    );
    act(() => onRun());
    await openPopover();
    expect(await screen.findByText(/Last run failed/)).toBeInTheDocument();
    expect(fetchAuth).toHaveBeenCalledTimes(2);
  });

  it("a run event while a load is in flight cannot repopulate the cache with the older chain", async () => {
    let resolveFirst: (p: Provenance) => void = () => undefined;
    fetchAuth
      .mockImplementationOnce(() => new Promise<Provenance>((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(chain({ pipeline: { id: "pipe-1", name: "Fresh name" } }));
    renderTrigger();
    await openPopover();
    // The subscription needs a loaded chain; load, then evict, then a stale in-flight is impossible
    // here -- so assert via the cache API directly.
    const cache = await import("./provenanceCache");
    const key = cache.outputProvenanceKey("out-1");
    cache.invalidateProvenance(key);
    await act(async () => resolveFirst(chain()));
    expect(cache.getCachedProvenance(key)).toBeUndefined();
  });

  it("returns focus to the icon trigger when the badge that opened the popover unmounted", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <ProvenanceTrigger {...baseProps} invalidBadge />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Data checks failed - view provenance" }));
    await screen.findByText("Weekly sales");
    rerender(
      <MemoryRouter>
        <ProvenanceTrigger {...baseProps} invalidBadge={false} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger()).toHaveFocus();
  });
});
