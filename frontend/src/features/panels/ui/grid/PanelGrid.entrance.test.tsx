// HEL-1584 D4 -- the grid's cold-load entrance: staggered in reading order for panels that arrived from a network fetch,
// at most once per load, never for a warm restore, a shell swap or a remount; a panel added while mounted pops once. It is
// carried as data attributes on the item wrapper, never a className (react-grid-layout forwards a child's className onto
// the positioned item).
import { act } from "@testing-library/react";
import type { ReactNode } from "react";

import { useAppSelector } from "../../../../hooks/reduxHooks";
import { resetFirstMountRegistryForTests } from "../../../../shared/motion/useFirstMountForToken";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { fetchPanels, panelsRestored } from "../../state/panelsSlice";
import { PanelGrid } from "./PanelGrid";

// Stands in for react-grid-layout: like the real one it forwards each child's className onto a `.react-grid-item` it
// renders around it, so a className leaking from the entrance hook would show up on the item.
jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: ({ children }: { children?: ReactNode }) =>
      React.createElement(
        "div",
        { className: "panel-grid" },
        React.Children.map(children, (child: { props: { className?: string } }) =>
          React.cloneElement(child, {
            className: ["react-grid-item", child.props.className].filter(Boolean).join(" "),
          }),
        ),
      ),
  };
});
jest.mock("react-grid-layout/core", () => ({
  ...jest.requireActual("react-grid-layout/core"),
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));
jest.mock("../PanelCard", () => ({
  getPanelCardStyle: () => ({}),
  PanelCard: ({ panel }: { panel: { id: string } }) =>
    require("react").createElement("div", { "data-testid": `card-${panel.id}` }),
}));
jest.mock("../PanelCardBody", () => ({
  PanelCardBody: () => null,
}));
jest.mock("../../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  }),
}));
jest.mock("../../hooks/useOutputRetention", () => ({ useOutputRetention: jest.fn() }));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../provenance/ProvenanceTrigger", () => ({ ProvenanceTrigger: () => null }));
jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const DESKTOP = 1600;
const PHONE = 600;

const make = (id: string) => makeOutputPanel({ id, dashboardId: "d1", title: id });
const A = make("a");
const B = make("b");
const C = make("c");
const D = make("d");

/** a is bottom-left, b top-right, c top-left: reading order is c, b, a (y first, then x). d is not placed: it is auto-placed. */
const place = (panelId: string, x: number, y: number) => ({ panelId, x, y, w: 4, h: 4 });
const lg = [place("a", 0, 4), place("b", 6, 0), place("c", 0, 0)];
const layoutFor = (ids: string[]): DashboardLayout => {
  const only = lg.filter((item) => ids.includes(item.panelId));
  return { lg: only, md: only, sm: only, xs: only };
};

function Harness({ show, width }: { show: boolean; width: number }) {
  const panels = useAppSelector((state) => state.panels.items);
  return show && panels.length > 0 ? (
    <PanelGrid
      dashboardId="d1"
      layout={layoutFor(panels.map((panel) => panel.id))}
      panels={panels}
      width={width}
    />
  ) : null;
}

function setup(width = DESKTOP) {
  const ctx = renderWithStore(<Harness show width={width} />, {
    dashboards: { items: [{ id: "d1", name: "D", layout: layoutFor([]) }] },
    panels: { items: [], status: "idle" },
  });
  const rerender = (show: boolean, w = width) => ctx.rerender(<Harness show={show} width={w} />);
  const load = (panels = [A, B, C]) =>
    act(() => void ctx.store.dispatch(fetchPanels.fulfilled(panels, "r", "d1")));
  const restore = (panels = [A, B, C]) =>
    act(() => void ctx.store.dispatch(panelsRestored({ dashboardId: "d1", items: panels })));
  return { ...ctx, rerender, load, restore };
}

const items = () => [...document.querySelectorAll<HTMLElement>(".react-grid-item")];
const phases = () => items().map((el) => el.getAttribute("data-entrance"));
const indexed = () => items().map((el) => el.style.getPropertyValue("--motion-index"));
const cardClasses = () => [...document.querySelectorAll<HTMLElement>(".panel-grid-card")];

beforeEach(() => resetFirstMountRegistryForTests());

describe("PanelGrid cold-load entrance (HEL-1584 D4)", () => {
  it("a network load staggers the cards in reading order (y, then x)", () => {
    const { load } = setup();
    load();
    // DOM order is panel order a, b, c; reading order is c (0), b (1), a (2).
    expect(
      items().map((el) => el.querySelector("[data-testid]")?.getAttribute("data-testid")),
    ).toEqual(["card-a", "card-b", "card-c"]);
    expect(phases()).toEqual(["enter", "enter", "enter"]);
    expect(indexed()).toEqual(["2", "1", "0"]);
  });

  it("puts no entrance class on any .react-grid-item (only data attributes)", () => {
    const { load } = setup();
    load();
    for (const el of items()) {
      expect(el.className).not.toMatch(/motion-enter|motion-pop/);
    }
    expect(cardClasses()).toHaveLength(0);
  });

  it("a warm restore plays no entrance", () => {
    const { restore } = setup();
    restore();
    expect(items()).toHaveLength(3);
    expect(phases()).toEqual([null, null, null]);
  });

  it("a panel added while the grid is mounted pops once, and the others do not animate", () => {
    const { load } = setup();
    load();
    load([A, B, C, D]);
    expect(phases()).toEqual(["enter", "enter", "enter", "pop"]);
    expect(items()[3].style.getPropertyValue("--motion-index")).toBe("");
  });

  it("a fresh mount with one panel enters (a dashboard's first panel always arrives as a fresh mount)", () => {
    const { load } = setup();
    load([A]);
    expect(phases()).toEqual(["enter"]);
    expect(indexed()).toEqual(["0"]);
  });

  it("crossing the sm width swaps the shell without replaying the entrance, in both directions", () => {
    const { load, rerender } = setup();
    load();
    rerender(true, PHONE);
    expect(document.querySelector(".mobile-panel-stack")).not.toBeNull();
    expect(document.querySelectorAll(".motion-enter, .motion-pop")).toHaveLength(0);
    rerender(true, DESKTOP);
    expect(items()).toHaveLength(3);
    expect(phases()).toEqual([null, null, null]);
  });

  it("the phone stack staggers its cards on a cold load with the emphasized rise", () => {
    const { load } = setup(PHONE);
    load();
    const articles = [...document.querySelectorAll<HTMLElement>(".mobile-panel-stack > article")];
    expect(articles).toHaveLength(3);
    for (const article of articles) {
      expect(article).toHaveClass("motion-enter", "motion-enter--emphasized");
    }
  });

  it("mount, unmount, remount with the same store: the second mount does not replay", () => {
    const { load, rerender } = setup();
    load();
    expect(phases()).toEqual(["enter", "enter", "enter"]);
    rerender(false);
    expect(items()).toHaveLength(0);
    rerender(true);
    expect(items()).toHaveLength(3);
    expect(phases()).toEqual([null, null, null]);
  });

  it("a refetch while mounted, then unmount and remount: nothing plays", () => {
    const { load, rerender } = setup();
    load();
    load(); // e.g. an add-panel refetch under the on-screen grid bumps the load id
    rerender(false);
    rerender(true);
    expect(phases()).toEqual([null, null, null]);
  });

  it("a load that arrived while no grid was mounted plays", () => {
    const { load, rerender } = setup();
    load();
    rerender(false);
    load(); // lands while the user is on Home
    rerender(true);
    expect(phases()).toEqual(["enter", "enter", "enter"]);
  });

  it("a restored load never plays, even right after a network load of the same dashboard", () => {
    const { load, restore, rerender } = setup();
    load();
    rerender(false);
    restore();
    rerender(true);
    expect(phases()).toEqual([null, null, null]);
  });
});
