import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { resetProvenanceCache } from "./provenanceCache";
import * as service from "./provenanceService";
import { ProvenanceTrigger } from "./ProvenanceTrigger";
import type { Provenance } from "./provenanceService";

jest.mock("./provenanceService", () => ({
  fetchOutputProvenance: jest.fn(),
  fetchPublicProvenance: jest.fn(),
}));
jest.mock("./provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const fetchAuth = jest.mocked(service.fetchOutputProvenance);

const chain: Provenance = {
  outputId: "out-1",
  pipeline: { id: "pipe-1", name: "Weekly sales" },
  sources: [{ id: "src-1", name: "Orders CSV", kind: "csv" }],
  nodePath: ["filter", "aggregate"],
  lastRun: { status: "succeeded", completedAt: "2026-09-29T10:00:00Z", rowCount: 42 },
  assertions: { defined: true, passed: 3, failed: 0, warned: 0, rootBound: false },
};

// HEL-1756: the popover measures itself once mounted and fits the viewport. jsdom has no layout, so the geometry the
// placement reads (trigger rect, panel height and width, window size) is mocked on the prototypes; the real proof is the
// HEL-1756 e2e.
const realRect = HTMLElement.prototype.getBoundingClientRect;
const originalInnerHeight = window.innerHeight;
const originalInnerWidth = window.innerWidth;

interface Layout {
  trigger: { top: number; bottom: number; left: number; right: number };
  /** Natural height by content state: `loading`, `ready` or `error`. */
  heights: { loading: number; ready: number; error: number };
  innerHeight: number;
  innerWidth: number;
}

function mockLayout(layout: Layout, onPanelRect?: (visibility: string) => void) {
  window.innerHeight = layout.innerHeight;
  window.innerWidth = layout.innerWidth;
  jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute("role") !== "dialog") return 0;
    onPanelRect?.(this.style.visibility);
    if (this.querySelector(".provenance-popover__content")) return layout.heights.ready;
    if (this.querySelector('[role="alert"]')) return layout.heights.error;
    return layout.heights.loading;
  });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute("aria-haspopup") === "dialog") {
      const { top, bottom, left, right } = layout.trigger;
      return { top, bottom, left, right, width: right - left, height: bottom - top } as DOMRect;
    }
    return realRect.call(this);
  });
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe = jest.fn();
  disconnect = jest.fn();
}

/** One natural height in every content state, for the geometry cases that do not exercise growth. */
const flat = (h: number) => ({ loading: h, ready: h, error: h });

const base: Layout = {
  trigger: { top: 150, bottom: 174, left: 250, right: 274 },
  heights: flat(326),
  innerHeight: 400,
  innerWidth: 1280,
};

function renderTrigger() {
  render(
    <MemoryRouter>
      <ProvenanceTrigger
        panelId="panel-1"
        panelTitle="Sales"
        outputId="out-1"
        variant="authenticated"
      />
    </MemoryRouter>,
  );
}

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Data provenance" }));
  return screen.findByRole("dialog", { name: "Data provenance for Sales" });
}

beforeEach(() => {
  resetProvenanceCache();
  fetchAuth.mockReset().mockResolvedValue(chain);
  FakeResizeObserver.instances = [];
});

afterEach(() => {
  jest.restoreAllMocks();
  window.innerHeight = originalInnerHeight;
  window.innerWidth = originalInnerWidth;
  // @ts-expect-error -- restoring the jsdom default (no ResizeObserver)
  delete window.ResizeObserver;
});

describe("ProvenanceTrigger viewport fit (HEL-1756)", () => {
  it("opens below the trigger when there is room for it", async () => {
    mockLayout({ ...base, trigger: { top: 20, bottom: 44, left: 250, right: 274 } });
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    expect(panel.style.top).toBe("52px");
    expect(panel.style.bottom).toBe("");
    // 326px of content, held to the 70vh design cap (280px in a 400px window): the rest scrolls inside.
    expect(panel.style.maxHeight).toBe("280px");
  });

  it("flips above the trigger when it does not fit below and above has more room", async () => {
    mockLayout({ ...base, trigger: { top: 331, bottom: 355, left: 250, right: 274 } });
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    // above room 331 - 16 = 315 beats below room 400 - 363 - 8 = 29; height capped to min(326, 0.7 * 400 = 280).
    expect(panel.style.bottom).toBe("77px");
    expect(panel.style.top).toBe("");
    expect(panel.style.maxHeight).toBe("280px");
  });

  it("caps its height to the roomier side when neither side holds it", async () => {
    mockLayout({
      ...base,
      innerHeight: 200,
      trigger: { top: 60, bottom: 84, left: 250, right: 274 },
    });
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    // below room 200 - 92 - 8 = 100 beats above room 60 - 16 = 44: stays below, capped.
    expect(panel.style.top).toBe("92px");
    expect(panel.style.maxHeight).toBe("100px");
  });

  it("never exceeds the 480px design cap in a tall window", async () => {
    mockLayout({
      ...base,
      innerHeight: 1400,
      heights: flat(700),
      trigger: { top: 20, bottom: 44, left: 250, right: 274 },
    });
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    expect(panel.style.maxHeight).toBe("480px");
  });

  it("keeps an 8px margin on both horizontal edges of a 390px viewport", async () => {
    mockLayout({
      ...base,
      innerWidth: 390,
      innerHeight: 900,
      trigger: { top: 20, bottom: 44, left: 4, right: 28 },
    });
    renderTrigger();
    const panel = await open();
    expect(panel.style.left).toBe("8px");
    expect(panel.style.width).toBe("350px");
  });

  it("clamps the right edge: a trigger near the right keeps the panel 8px inside", async () => {
    mockLayout({
      ...base,
      innerWidth: 390,
      innerHeight: 900,
      trigger: { top: 20, bottom: 44, left: 380, right: 388 },
    });
    renderTrigger();
    const panel = await open();
    // width 350, left = min(380, 390 - 350 - 8 = 32)
    expect(panel.style.left).toBe("32px");
  });

  it("without layout (jsdom) keeps the preferred side, uncapped", async () => {
    renderTrigger();
    const panel = await open();
    expect(panel.style.top).not.toBe("");
    expect(panel.style.bottom).toBe("");
    expect(panel.style.maxHeight).toBe("");
  });

  it("is visibility: hidden when first measured, and visible once placed", async () => {
    const seen: string[] = [];
    mockLayout(base, (v) => seen.push(v));
    renderTrigger();
    const panel = await open();
    expect(seen[0]).toBe("hidden");
    expect(panel.style.visibility).toBe("");
  });

  it("moves focus into the panel only once it is placed (a hidden element cannot take focus)", async () => {
    mockLayout(base);
    const seen: string[] = [];
    const realFocus = HTMLElement.prototype.focus;
    jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "dialog") seen.push(this.style.visibility);
      realFocus.call(this);
    });
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v !== "hidden")).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("stays open while focus moves between its own controls", async () => {
    mockLayout(base);
    renderTrigger();
    const panel = await open();
    await screen.findByText("Weekly sales");
    const close = screen.getByRole("button", { name: "Close provenance" });
    const link = screen.getByRole("link", { name: "Open pipeline" });
    act(() => close.focus());
    act(() => link.focus());
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes when focus leaves the trigger and the panel together", async () => {
    mockLayout(base);
    renderTrigger();
    await open();
    await screen.findByText("Weekly sales");
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    outside.remove();
  });

  describe("re-fit when its content grows", () => {
    beforeEach(() => {
      window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    });

    it("loading to ready: re-fits to the loaded height (observed inner wrapper, no window resize)", async () => {
      let resolve!: (p: Provenance) => void;
      fetchAuth.mockReset().mockReturnValue(new Promise<Provenance>((r) => (resolve = r)));
      mockLayout({
        ...base,
        heights: { loading: 60, ready: 326, error: 90 },
        trigger: { top: 20, bottom: 44, left: 250, right: 274 },
      });
      const resizeSpy = jest.fn();
      window.addEventListener("resize", resizeSpy);
      renderTrigger();
      const panel = await open();
      expect(panel.style.maxHeight).toBe("60px");
      const observed = FakeResizeObserver.instances.at(-1);
      expect(observed?.observe).toHaveBeenCalledWith(
        panel.querySelector(".provenance-popover__inner"),
      );

      await act(async () => {
        resolve(chain);
      });
      await screen.findByText("Weekly sales");
      act(() => observed?.callback());
      expect(panel.style.maxHeight).toBe("280px");
      expect(resizeSpy).not.toHaveBeenCalled();
      window.removeEventListener("resize", resizeSpy);
    });

    it("loading to error: re-fits to the error height", async () => {
      let reject!: (e: Error) => void;
      fetchAuth.mockReset().mockReturnValue(new Promise<Provenance>((_, r) => (reject = r)));
      mockLayout({
        ...base,
        heights: { loading: 60, ready: 326, error: 90 },
        trigger: { top: 20, bottom: 44, left: 250, right: 274 },
      });
      renderTrigger();
      const panel = await open();
      expect(panel.style.maxHeight).toBe("60px");
      const observed = FakeResizeObserver.instances.at(-1);
      await act(async () => {
        reject(new Error("boom"));
      });
      await screen.findByText("Provenance could not be loaded.");
      act(() => observed?.callback());
      expect(panel.style.maxHeight).toBe("90px");
    });
  });
});
