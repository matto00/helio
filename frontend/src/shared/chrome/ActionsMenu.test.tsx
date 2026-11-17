import { fireEvent, render, screen } from "@testing-library/react";

import { ActionsMenu } from "./ActionsMenu";

function renderMenu(overrides: Partial<Parameters<typeof ActionsMenu>[0]> = {}) {
  const onRename = jest.fn();
  const onDuplicate = jest.fn();
  const onDelete = jest.fn();
  const utils = render(
    <ActionsMenu
      label="Panel actions"
      items={[
        { label: "Rename", onClick: onRename },
        { label: "Duplicate", onClick: onDuplicate, disabled: true },
        { label: "Delete", onClick: onDelete, danger: true },
      ]}
      {...overrides}
    />,
  );
  return { ...utils, onRename, onDuplicate, onDelete };
}

// HEL a11y sweep F-007 — the actions menu was entirely unusable via
// keyboard: Enter/Space opened it but never moved real focus into the menu,
// arrow keys did nothing, and Tab-away left it visually open with focus on
// an unrelated control.
//
// HEL-1003 D5 triage (all 6 `toHaveFocus` assertions below): kept as-is,
// genuinely falsifiable under jsdom. Every element these assertions move
// focus between (the trigger and the menu's own `menuitem`s) is rendered at
// full opacity/size with no `display:none`/`clip`/`0x0` layout involved — the
// component this test renders never applies the resting visually-hidden
// treatment (that's host CSS in `DashboardList.css`, not part of
// `ActionsMenu` itself). D0a's failure mode ("jsdom will happily focus a
// hidden 0x0 element") does not apply here because nothing under test is
// hidden; these assertions test real focus-movement logic (Enter/ArrowUp/
// ArrowDown/Home/End/Escape wiring), which jsdom tracks correctly.
describe("ActionsMenu — keyboard operability (HEL a11y sweep F-007)", () => {
  it("Enter on the trigger opens the menu and moves real focus to the first enabled item", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Panel actions" });
    trigger.focus();
    fireEvent.click(trigger);

    const renameItem = screen.getByRole("menuitem", { name: "Rename" });
    expect(renameItem).toHaveFocus();
  });

  it("ArrowDown moves focus to the next enabled item, skipping a disabled one", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });

    // "Duplicate" is disabled — ArrowDown from "Rename" should skip straight
    // to "Delete".
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("ArrowUp from the first item wraps around to the last enabled item", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowUp" });

    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("Home/End jump to the first/last enabled item", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));

    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  });

  it("Escape closes the menu and returns real focus to the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Panel actions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("focus leaving the menu (Tab away) closes it", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);

    const renameItem = screen.getByRole("menuitem", { name: "Rename" });
    fireEvent.focusOut(renameItem, { relatedTarget: outsideButton });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    document.body.removeChild(outsideButton);
  });

  it("activating an item via click calls its onClick and closes the menu", () => {
    const { onRename } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("menu items are not sequential Tab stops (tabIndex -1) — only reachable via Enter/arrow keys", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });

  it("the menu has an accessible name matching the trigger's label", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(screen.getByRole("menu", { name: "Panel actions" })).toBeInTheDocument();
  });
});

// HEL-719 scope amendment — `align="above"` lets a trigger pinned near the
// viewport bottom (e.g. a page footer) open its panel upward instead of
// ActionsMenu's default "below", which would otherwise render the panel
// past the viewport's bottom edge (confirmed live for the pipeline detail
// footer's "More actions" trigger — see files-modified.md Cycle 4).
describe("ActionsMenu — align prop (HEL-719 scope amendment)", () => {
  it('defaults to opening below the trigger (top set, bottom unset) when "align" is omitted', () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.style.top).not.toBe("");
    expect(panel.style.bottom).toBe("");
  });

  it('opens above the trigger (bottom set, top unset) when align="above"', () => {
    renderMenu({ align: "above" });
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.style.bottom).not.toBe("");
    expect(panel.style.top).toBe("");
  });
});

// HEL-1579: an item may carry an accessible name that differs from its visible label.
describe("ActionsMenu item ariaLabel", () => {
  it("uses the ariaLabel as the menuitem's accessible name and keeps the visible label as its text", () => {
    render(
      <ActionsMenu
        label="Step actions"
        items={[{ label: "Move up", ariaLabel: "Move step up in Sales CSV", onClick: () => {} }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Step actions" }));
    const item = screen.getByRole("menuitem", { name: "Move step up in Sales CSV" });
    expect(item).toHaveTextContent("Move up");
  });
});

// HEL-1582: a native modal <dialog> sits in the top layer, so a panel portalled to the body would render behind it.
// jsdom has no top layer; the DOM ancestry of the panel is the observable contract.
describe("ActionsMenu portal target", () => {
  const items = [{ label: "Rename", onClick: () => {} }];

  it("portals the panel into the open <dialog> its trigger sits in", () => {
    render(
      <dialog open data-testid="host">
        <ActionsMenu label="Step actions" items={items} />
      </dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Step actions" }));
    expect(screen.getByTestId("host")).toContainElement(screen.getByRole("menu"));
  });

  it("portals the panel to the body when the trigger is not inside an open dialog", () => {
    const { container } = render(<ActionsMenu label="Step actions" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Step actions" }));
    const menu = screen.getByRole("menu");
    expect(container).not.toContainElement(menu);
    expect(menu.closest("dialog")).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
  });
});

// HEL-1750: the menu measures itself once mounted and fits the viewport. jsdom has no layout, so the geometry the
// placement reads (trigger rect, panel size, window size) is mocked on the prototypes; the real proof is the HEL-1750 e2e.
describe("ActionsMenu viewport fit (HEL-1750)", () => {
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;

  function mockLayout(opts: {
    trigger: { top: number; bottom: number; left: number; right: number };
    panelHeight: number;
    panelWidth: number;
    innerHeight: number;
    innerWidth: number;
    onMenuRect?: (visibility: string) => void;
  }) {
    window.innerHeight = opts.innerHeight;
    window.innerWidth = opts.innerWidth;
    jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "menu" ? opts.panelHeight : 0;
    });
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("aria-haspopup") === "menu") {
        const { top, bottom, left, right } = opts.trigger;
        return { top, bottom, left, right, width: right - left, height: bottom - top } as DOMRect;
      }
      if (this.getAttribute("role") === "menu") {
        opts.onMenuRect?.(this.style.visibility);
        const left = opts.innerWidth - (parseFloat(this.style.right) || 0) - opts.panelWidth;
        return {
          top: 0,
          bottom: opts.panelHeight,
          left,
          right: left + opts.panelWidth,
          width: opts.panelWidth,
          height: opts.panelHeight,
        } as DOMRect;
      }
      return realRect.call(this);
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    window.innerHeight = originalInnerHeight;
    window.innerWidth = originalInnerWidth;
  });

  const base = {
    trigger: { top: 315, bottom: 345, left: 250, right: 280 },
    panelHeight: 165,
    panelWidth: 140,
    innerHeight: 400,
    innerWidth: 1280,
  };

  it("flips above the trigger when the menu does not fit below and above has more room", () => {
    mockLayout(base);
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    // bottom anchor: innerHeight - (trigger.top - 8) = 400 - 307
    expect(panel.style.bottom).toBe("93px");
    expect(panel.style.top).toBe("");
    expect(panel.style.maxHeight).toBe("165px");
  });

  it("opens below at its natural height when it fits", () => {
    mockLayout({ ...base, trigger: { top: 20, bottom: 50, left: 250, right: 280 } });
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.style.top).toBe("58px");
    expect(panel.style.bottom).toBe("");
    expect(panel.style.maxHeight).toBe("165px");
  });

  it("caps its height to the roomier side when neither side holds it", () => {
    mockLayout({
      ...base,
      innerHeight: 200,
      trigger: { top: 60, bottom: 90, left: 250, right: 280 },
    });
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    // below room 200-98-8 = 94 beats above room 60-16 = 44: stays below, capped.
    expect(panel.style.top).toBe("98px");
    expect(panel.style.maxHeight).toBe("94px");
  });

  it("keeps the menu at least 8px from the left edge of a 390px viewport (guard: a trigger near the left edge)", () => {
    // right edge at 100: a 140px panel aligned to it would start at -40.
    mockLayout({
      ...base,
      innerWidth: 390,
      innerHeight: 900,
      trigger: { top: 20, bottom: 50, left: 70, right: 100 },
    });
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    const panel = screen.getByRole("menu");
    const right = parseFloat(panel.style.right);
    expect(390 - right - 140).toBeGreaterThanOrEqual(8);
    expect(panel.style.right).toBe("242px");
  });

  it("is visibility: hidden when first measured, and visible once placed", () => {
    const seen: string[] = [];
    mockLayout({ ...base, onMenuRect: (v) => seen.push(v) });
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(seen[0]).toBe("hidden");
    expect(screen.getByRole("menu").style.visibility).toBe("");
  });

  it("focuses the first enabled item only once the menu is placed (a hidden element cannot take focus)", () => {
    mockLayout(base);
    const seen: { label: string | null; visibility: string }[] = [];
    const realFocus = HTMLElement.prototype.focus;
    jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "menuitem") {
        const menu = this.closest<HTMLElement>('[role="menu"]');
        seen.push({ label: this.textContent, visibility: menu?.style.visibility ?? "" });
      }
      realFocus.call(this);
    });
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Panel actions" }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.visibility !== "hidden")).toBe(true);
    expect(seen[0].label).toBe("Rename");
  });
});
