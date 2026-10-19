// OutputSchemaDisclosure.test.tsx — HEL-1022. This component is only
// mounted by `PipelineDetailFooter` above the small-schema threshold, so
// every fixture here is deliberately large (well past 12 fields) to match
// the real repro (a ~200-field REST source ballooning the footer).

import { act, fireEvent, render, screen } from "@testing-library/react";

import { OutputSchemaDisclosure } from "./OutputSchemaDisclosure";
import type { SchemaField } from "../types/pipelineStep";

function fields(n: number): SchemaField[] {
  return Array.from({ length: n }, (_, i) => ({ name: `field_${i}`, type: "string" }));
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: /fields/ }));
}

// The panel's CSS is not loaded under jest; the custom properties its placement reads are declared here, with the
// same values as OutputSchemaDisclosure.css (the rendering e2e proves the real stylesheet).
const PANEL_CSS = `.output-schema-disclosure__panel {
  --schema-panel-max-width: 28rem;
  --schema-panel-max-height: 24rem;
  --schema-panel-edge-margin: 0.5rem;
}`;

/** Mocks the layout jsdom does not do: the trigger's rect, the mounted panel's width, and its content height. */
function mockLayout(opts: { triggerTop: number; panelWidth?: number; contentHeight?: number }) {
  const triggerRect = {
    left: 20,
    right: 92,
    top: opts.triggerTop,
    bottom: opts.triggerTop + 17,
    width: 72,
    height: 17,
    x: 20,
    y: opts.triggerTop,
    toJSON: () => ({}),
  };
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("output-schema-disclosure__panel")) {
      const w = opts.panelWidth ?? 448;
      return {
        ...triggerRect,
        left: 0,
        right: w,
        width: w,
        top: 0,
        bottom: 0,
        height: 0,
      } as DOMRect;
    }
    return triggerRect as DOMRect;
  });
  jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("output-schema-disclosure__panel")
      ? (opts.contentHeight ?? 300)
      : 0;
  });
}

let panelStyle: HTMLStyleElement;
beforeEach(() => {
  panelStyle = document.createElement("style");
  panelStyle.textContent = PANEL_CSS;
  document.head.appendChild(panelStyle);
});
afterEach(() => panelStyle.remove());

const panelEl = () => screen.getByRole("dialog", { name: "Output schema" });

describe("OutputSchemaDisclosure panel placement (HEL-1582, HEL-1668)", () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  afterEach(() => {
    jest.restoreAllMocks();
    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
  });

  it("keeps the panel inside the viewport when the trigger sits near the right edge", () => {
    window.innerWidth = 390;
    window.innerHeight = 844;
    mockLayout({ triggerTop: 424, panelWidth: 350 });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const left = parseFloat(panelEl().style.left);
    // 390 wide: the measured panel is 350 wide, so it must start at or before 390 - 350 - 8.
    expect(left).toBeLessThanOrEqual(32);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it("stays hidden until it is placed, then shows", () => {
    window.innerHeight = 844;
    mockLayout({ triggerTop: 424 });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    // A layout effect places it before the first paint: by the time the open click returns it is visible.
    expect(panelEl().style.visibility).not.toBe("hidden");
  });

  it("opens ABOVE for a short panel even though its full 24rem cap would not fit above", () => {
    window.innerHeight = 800;
    // Room above = 250 - 8 - 8 = 234 < 384 cap, but the content (200) fits.
    mockLayout({ triggerTop: 250, contentHeight: 200 });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = panelEl().style;
    expect(style.bottom).not.toBe("");
    expect(style.top).toBe("");
  });

  it("opens on the roomier side, height capped to that room, when the content is taller than the room above", () => {
    window.innerHeight = 800;
    // Room above 104; content 500 (cap 384) does not fit; room below is much larger.
    mockLayout({ triggerTop: 120, contentHeight: 500 });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = panelEl().style;
    expect(style.top).not.toBe("");
    expect(style.bottom).toBe("");
    expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(384);
  });

  it("caps the height to the room above when above is the roomier side", () => {
    window.innerHeight = 800;
    mockLayout({ triggerTop: 700, contentHeight: 600 });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = panelEl().style;
    expect(style.bottom).not.toBe("");
    expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(384);
  });

  it("ends the room below at the rendered bottom nav's top edge outside a dialog", () => {
    window.innerHeight = 800;
    mockLayout({ triggerTop: 100, contentHeight: 600 });
    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    document.body.appendChild(nav);
    const realRect = HTMLElement.prototype.getBoundingClientRect as jest.Mock;
    const impl = realRect.getMockImplementation() as (this: HTMLElement) => DOMRect;
    realRect.mockImplementation(function (this: HTMLElement) {
      if (this === nav)
        return { top: 400, bottom: 800, left: 0, right: 400, width: 400, height: 400 } as DOMRect;
      return impl.call(this);
    });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = panelEl().style;
    // Opens below (room above is 76); trigger bottom 117 + gap 8; the panel must end above 400.
    const bottomEdge = parseFloat(style.top) + parseFloat(style.maxHeight);
    expect(bottomEdge).toBeLessThanOrEqual(400);
    nav.remove();
  });
});

describe("OutputSchemaDisclosure portal target (HEL-1582)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("portals the panel into the open <dialog> its trigger sits in (or it renders behind the modal)", () => {
    render(
      <dialog open data-testid="host">
        <OutputSchemaDisclosure fields={fields(50)} />
      </dialog>,
    );
    openPopover();
    expect(screen.getByTestId("host")).toContainElement(panelEl());
  });

  it("portals the panel to the body when the trigger is not inside an open dialog", () => {
    const { container } = render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const panel = panelEl();
    expect(container).not.toContainElement(panel);
    expect(panel.closest("dialog")).toBeNull();
  });
});

describe("OutputSchemaDisclosure", () => {
  it("renders a compact 'N fields' trigger rather than one chip per field", () => {
    render(<OutputSchemaDisclosure fields={fields(203)} />);
    expect(screen.getByRole("button", { name: "203 fields" })).toBeInTheDocument();
    // The whole point of the fix: none of the 203 field chips exist until
    // the trigger is activated.
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
  });

  it("the trigger advertises a popup and its open state", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    const trigger = screen.getByRole("button", { name: "50 fields" });
    expect(trigger).toHaveAttribute("aria-haspopup");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    openPopover();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opening the popover reveals the field list via the shared SchemaFieldViewer", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    // SchemaFieldViewer's own chrome (filter box) confirms it's the real
    // shared viewer doing the work, not a re-implementation.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("Escape closes the popover and returns focus to the trigger", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    const trigger = screen.getByRole("button", { name: "50 fields" });
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("Escape prevents the default (so an enclosing dialog's cancel does not fire) without stopping propagation (HEL-1668)", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const windowListener = jest.fn();
    window.addEventListener("keydown", windowListener);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });
    window.removeEventListener("keydown", windowListener);
    expect(event.defaultPrevented).toBe(true);
    expect(windowListener).toHaveBeenCalled();
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
  });

  it("an outside click (the scrim) closes the popover", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    const scrim = document.querySelector(".popover__scrim");
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
  });
});
