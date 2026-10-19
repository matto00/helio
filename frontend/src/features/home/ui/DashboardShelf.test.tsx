import { screen, within } from "@testing-library/react";

import { dashboard } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import { DashboardShelf } from "./DashboardShelf";
import { LayoutThumbnail, thumbnailItems } from "./LayoutThumbnail";

jest.mock("../../onboarding/ui/FirstRunDropZone", () => ({
  FirstRunDropZone: () => <p>Drop zone</p>,
}));

const NOW = Date.parse("2026-10-13T09:12:00Z");

describe("DashboardShelf", () => {
  const five = ["a", "b", "c", "d", "e"].map((id, i) =>
    dashboard(id, `Dash ${id}`, new Date(NOW - (i + 1) * 3_600_000).toISOString()),
  );

  it("shows at most four cards, newest first, linking to /dashboards/:id, plus an All N link", () => {
    renderHome(
      <DashboardShelf
        dashboards={five}
        status="succeeded"
        changedIds={new Set()}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    const cards = screen.getAllByRole("link", { name: /Dash/ });
    expect(cards.map((c) => c.getAttribute("href"))).toEqual([
      "/dashboards/a",
      "/dashboards/b",
      "/dashboards/c",
      "/dashboards/d",
    ]);
    expect(screen.getByRole("link", { name: /All 5/ })).toHaveAttribute("href", "/dashboards");
    expect(within(cards[0]).getByText("1h")).toBeInTheDocument();
  });

  it("puts a changed dashboard first and adds the dot to its accessible name", () => {
    renderHome(
      <DashboardShelf
        dashboards={five}
        status="succeeded"
        changedIds={new Set(["e"])}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    const first = screen.getAllByRole("link", { name: /Dash/ })[0];
    expect(first).toHaveAttribute("href", "/dashboards/e");
    expect(first).toHaveAccessibleName(/Dash e.*changed since your last visit/);
    expect(screen.getAllByText(/changed since your last visit/)).toHaveLength(1);
  });

  it("renders the first-run drop zone for zero dashboards", () => {
    renderHome(
      <DashboardShelf
        dashboards={[]}
        status="succeeded"
        changedIds={new Set()}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    expect(screen.getByText("Drop zone")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /All/ })).not.toBeInTheDocument();
  });
});

describe("DashboardShelf loading skeleton (HEL-1665)", () => {
  it("builds each skeleton card from the loaded card's own foot boxes, with a hidden text line each", () => {
    const { container } = renderHome(
      <DashboardShelf
        dashboards={[]}
        status="loading"
        changedIds={new Set()}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    const cards = container.querySelectorAll(".home-card--skeleton");
    expect(cards).toHaveLength(4);
    for (const card of Array.from(cards)) {
      expect(card.querySelector(".home-card__foot .home-card__name")).not.toBeNull();
      expect(card.querySelector(".home-card__foot .home-card__time")).not.toBeNull();
    }
  });

  it("holds the link's line with a hidden slot while loading, and renders no slot once the link is there", () => {
    const loading = renderHome(
      <DashboardShelf
        dashboards={[]}
        status="loading"
        changedIds={new Set()}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    expect(loading.container.querySelector(".home-section__link-slot")).not.toBeNull();
    expect(screen.queryByRole("link", { name: /All/ })).not.toBeInTheDocument();
    loading.unmount();
    const loaded = renderHome(
      <DashboardShelf
        dashboards={[dashboard("a", "Dash a", new Date(NOW).toISOString())]}
        status="succeeded"
        changedIds={new Set()}
        now={NOW}
        onStepByStep={jest.fn()}
      />,
    );
    expect(loaded.container.querySelector(".home-section__link-slot")).toBeNull();
    expect(screen.getByRole("link", { name: /All 1/ })).toBeInTheDocument();
  });
});

describe("LayoutThumbnail", () => {
  it("draws one box per panel in the saved large layout, at relative positions", () => {
    const layout = {
      lg: [
        { panelId: "1", x: 0, y: 0, w: 6, h: 2 },
        { panelId: "2", x: 6, y: 0, w: 6, h: 2 },
        { panelId: "3", x: 0, y: 2, w: 12, h: 2 },
      ],
      md: [],
      sm: [],
      xs: [],
    };
    const { container } = renderHome(<LayoutThumbnail layout={layout} />);
    const boxes = Array.from(container.querySelectorAll<HTMLElement>(".home-thumb__box"));
    expect(boxes).toHaveLength(3);
    expect(boxes[1].style.left).toBe("50%");
    expect(boxes[2].style.top).toBe("50%");
    expect(boxes[2].style.width).toBe("100%");
  });

  it("falls back to md, sm, then xs, and says so when the layout is empty", () => {
    const item = { panelId: "x", x: 0, y: 0, w: 4, h: 4 };
    expect(thumbnailItems({ lg: [], md: [], sm: [item], xs: [] })).toEqual([item]);
    renderHome(<LayoutThumbnail layout={{ lg: [], md: [], sm: [], xs: [] }} />);
    expect(screen.getByText("No panels yet")).toBeInTheDocument();
  });
});
