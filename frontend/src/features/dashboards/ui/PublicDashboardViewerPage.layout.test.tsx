// HEL-1587 — the public share viewer lays panels out from the dashboard's stored layout (read-only, the signed-in
// grid's own config), renders text/markdown/image/divider content through the shared renderers (hostile content
// inert) and shows a form panel as a disabled, non-submittable preview. Real react-grid-layout; only the container
// width measurement is driven by the test (`mockContainerWidth`).

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";

import { PublicDashboardViewerPage } from "./PublicDashboardViewerPage";
import { authReducer } from "../../auth/state/authSlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { httpClient } from "../../../services/httpClient";
import * as publicDashboardService from "../services/publicDashboardService";
import * as panelService from "../../panels/services/panelService";
import {
  makeDividerPanel,
  makeFormPanel,
  makeImagePanel,
  makeMarkdownPanel,
  makeOutputPanel,
  makeTextPanel,
} from "../../../test/panelFixtures";
import { publicPanelsResult } from "../../../test/publicPanelsResult";
import type { DashboardLayout } from "../types/dashboard";

let mockContainerWidth = 1408;
const mockWidthListeners = new Set<(w: number) => void>();
// The REAL `useContainerWidth` contract (react-grid-layout 2.2.4): it starts at `initialWidth` 1280 and measures in a
// passive effect after the first commit; with `measureBeforeMount: true`, `mounted` stays false until that measurement.
jest.mock("react-grid-layout", () => {
  const React = require("react") as typeof import("react");
  return {
    ...jest.requireActual("react-grid-layout"),
    useContainerWidth: (options?: { measureBeforeMount?: boolean }) => {
      const [state, setState] = React.useState({
        width: 1280,
        mounted: !options?.measureBeforeMount,
      });
      React.useEffect(() => {
        setState({ width: mockContainerWidth, mounted: true });
        const listener = (width: number) => setState({ width, mounted: true });
        mockWidthListeners.add(listener);
        return () => {
          mockWidthListeners.delete(listener);
        };
      }, []);
      return { ...state, containerRef: { current: null }, measureWidth: () => undefined };
    },
  };
});
function resizeTo(width: number) {
  mockContainerWidth = width;
  act(() => mockWidthListeners.forEach((l) => l(width)));
}

jest.mock("../services/publicDashboardService", () => ({
  fetchPublicDashboardPanels: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicDistinctValues: jest.fn(),
  fetchPublicFormSchema: jest.fn(),
}));

// A form panel must never reach the signed-in FormRenderer (submit path + authenticated schema route).
jest.mock("../../panels/ui/renderers/FormRenderer", () => ({
  FormRenderer: () => {
    throw new Error("FormRenderer must not render on the public viewer");
  },
}));

jest.mock("../../panels/services/panelService", () => ({
  ...jest.requireActual("../../panels/services/panelService"),
  submitFormPanel: jest.fn(),
  fetchFormSchema: jest.fn(),
}));

const fetchPanelsMock = jest.mocked(publicDashboardService.fetchPublicDashboardPanels);
const fetchRowsMock = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchMetaMock = jest.mocked(publicDashboardService.fetchPublicOutputMeta);
const fetchFormSchemaMock = jest.mocked(publicDashboardService.fetchPublicFormSchema);
const submitFormPanelMock = jest.mocked(panelService.submitFormPanel);

const item = (panelId: string, x: number, y: number, w: number, h: number) => ({
  panelId,
  x,
  y,
  w,
  h,
});

// Two columns at every breakpoint that has one: the output on the left, the markdown on its right, the image below.
const twoColumn: DashboardLayout = {
  lg: [item("out", 0, 0, 6, 6), item("md", 6, 0, 6, 6), item("img", 0, 6, 12, 5)],
  md: [item("out", 0, 0, 5, 6), item("md", 5, 0, 5, 6), item("img", 0, 6, 10, 5)],
  sm: [item("out", 0, 0, 3, 6), item("md", 3, 0, 3, 6), item("img", 0, 6, 6, 5)],
  xs: [item("out", 0, 0, 2, 6), item("md", 0, 6, 2, 6), item("img", 0, 12, 2, 5)],
};

const outputPanel = makeOutputPanel({
  id: "out",
  dashboardId: "dash-1",
  title: "Sales",
  config: { outputId: "o1", controls: [] },
});
const markdownPanel = makeMarkdownPanel({
  id: "md",
  dashboardId: "dash-1",
  title: "Story",
  config: { content: "# Headline of the story\n\nBody **text**." },
});
// The fixture helper keeps only url/fit, so the caption is set on the config directly.
const imagePanel = {
  ...makeImagePanel({ id: "img", dashboardId: "dash-1", title: "Photo" }),
  config: { imageUrl: "/api/uploads/image/abc", imageFit: "cover", caption: "A caption" },
};

function renderViewer(authenticatedUserId?: string) {
  const store = configureStore({
    reducer: { auth: authReducer, panels: panelsReducer },
    preloadedState: authenticatedUserId
      ? {
          auth: {
            currentUser: {
              id: authenticatedUserId,
              email: "owner@helio.test",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier: "free",
            },
            status: "authenticated",
            submitStatus: "idle",
            mfaChallenge: null,
          } as never,
        }
      : undefined,
  });
  const ui = (
    <MemoryRouter initialEntries={["/dashboards/dash-1/panels?token=tok"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/dashboards/:dashboardId/panels" element={<PublicDashboardViewerPage />} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  return render(ui);
}

/** Markdown mounted and the output panel's rows loaded, so no state update lands after the test. */
async function settled() {
  await screen.findByTestId("markdown-content");
  await screen.findByText("east");
}

function cell(container: HTMLElement, panelId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`);
  if (!el) throw new Error(`no grid cell for ${panelId}`);
  return el;
}

/** The translate(x, y) RGL puts on a positioned item. */
function position(el: HTMLElement): { x: number; y: number } {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`no translate on ${el.outerHTML.slice(0, 120)}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

beforeEach(() => {
  mockContainerWidth = 1408;
  fetchPanelsMock.mockReset();
  fetchRowsMock.mockReset().mockResolvedValue({
    items: [{ region: "east" }],
    total: 1,
    offset: 0,
    limit: 200,
  });
  fetchMetaMock.mockReset().mockResolvedValue({
    kind: "table",
    config: {},
    schema: [{ name: "region", type: "string" }],
    ownerId: null,
  });
  fetchFormSchemaMock.mockReset();
  submitFormPanelMock.mockReset();
});

describe("PublicDashboardViewerPage grid layout (HEL-1587)", () => {
  it("places the panels side by side at md from the stored md layout (a 1440px viewport is a ~1408px container)", async () => {
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    expect(container.querySelector("ul[aria-label='Dashboard panels']")).toBeNull();
    const out = position(cell(container, "out"));
    const md = position(cell(container, "md"));
    const img = position(cell(container, "img"));
    expect(out.y).toBe(md.y);
    expect(md.x).toBeGreaterThan(out.x);
    // md breakpoint: 5 of 10 columns, so the second column starts at half the container (minus half a gutter).
    expect(md.x).toBe(710);
    expect(img.y).toBeGreaterThan(out.y);
    // The grid root exposes the processed-width custom property (HEL-1413) the e2e waits on.
    expect(container.querySelector<HTMLElement>(".public-dashboard-viewer__grid")).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>("[style*='--panel-grid-processed-width']"),
    ).not.toBeNull();
  });

  it("resolves lg for a container of 1440px or more (12 columns, lg items)", async () => {
    mockContainerWidth = 1500;
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    // lg: 6 of 12 columns; md: 5 of 10: both are half, so tell them apart by the item width instead.
    const md = cell(container, "md");
    expect(position(md).x).toBe(756);
    expect(parseFloat(md.style.width)).toBe(744);
  });

  it("resolves sm for 768-1099px", async () => {
    mockContainerWidth = 900;
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    // sm layout: second item at column 3 of 6 -> half the width.
    expect(position(cell(container, "md")).x).toBe(456);
  });

  it("keeps the existing stacked list below 768px", async () => {
    mockContainerWidth = 343;
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    expect(container.querySelector("ul[aria-label='Dashboard panels']")).not.toBeNull();
    expect(container.querySelector(".react-grid-layout")).toBeNull();
  });

  it("mounts each panel body once on a phone cold load (never the grid at the 1280px default first)", async () => {
    mockContainerWidth = 343;
    fetchFormSchemaMock.mockResolvedValue({ fields: [] });
    const frm = makeFormPanel({
      id: "frm",
      dashboardId: "dash-1",
      title: "Intake",
      config: {
        dataSourceId: "ds-1",
        fields: [{ sourceField: "qty", control: "number" }],
        submit: { writeMode: "append" },
      },
    });
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, frm], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    await waitFor(() => expect(fetchFormSchemaMock).toHaveBeenCalled());
    expect(container.querySelector("ul[aria-label='Dashboard panels']")).not.toBeNull();
    expect(container.querySelector(".react-grid-layout")).toBeNull();
    expect(fetchRowsMock).toHaveBeenCalledTimes(1);
    expect(fetchMetaMock).toHaveBeenCalledTimes(1);
    expect(fetchFormSchemaMock).toHaveBeenCalledTimes(1);
  });

  it("orders the phone stack by the stored xs layout (y, then x), not the API order", async () => {
    mockContainerWidth = 343;
    // API order is newest first: markdown, image, output. The xs layout reads output, markdown, image.
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([markdownPanel, imagePanel, outputPanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    const titles = Array.from(
      container.querySelectorAll(".public-dashboard-viewer__panel-title"),
    ).map((el) => el.textContent);
    expect(titles).toEqual(["Sales", "Story", "Photo"]);
  });

  it("puts the output panel's provenance trigger beside its title, in the card's title row (grid and stack)", async () => {
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const grid = renderViewer();
    await settled();
    const gridRow = grid.container.querySelector(
      `[data-panel-id="out"] .public-dashboard-viewer__title-row`,
    );
    expect(gridRow?.querySelector("h2.panel-grid-card__title")?.textContent).toBe("Sales");
    expect(gridRow?.querySelector("button[aria-label='Data provenance']")).not.toBeNull();
    expect(gridRow?.querySelector("h2 button")).toBeNull();
    expect(grid.container.querySelector(".public-dashboard-viewer__provenance-row")).toBeNull();
    // Non-output panels get no trigger.
    expect(
      grid.container.querySelector(`[data-panel-id="md"] button[aria-label='Data provenance']`),
    ).toBeNull();
    grid.unmount();

    mockContainerWidth = 343;
    const stack = renderViewer();
    await settled();
    const stackRow = stack.container.querySelector(".public-dashboard-viewer__title-row");
    expect(stackRow?.querySelector(".public-dashboard-viewer__panel-title")?.textContent).toBe(
      "Sales",
    );
    expect(stackRow?.querySelector("button[aria-label='Data provenance']")).not.toBeNull();
  });

  it("keeps a vertical gap at its stored y (noCompactor), not pulled up", async () => {
    const gap: DashboardLayout = {
      ...twoColumn,
      md: [item("out", 0, 0, 5, 4), item("md", 5, 10, 5, 4), item("img", 0, 20, 10, 4)],
    };
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], gap),
    );
    const { container } = renderViewer();
    await settled();
    // row step = rowHeight 52 + gutter 12
    expect(position(cell(container, "md")).y).toBe(10 * 64);
    expect(position(cell(container, "img")).y).toBe(20 * 64);
  });

  it("marks a minimum-height cell data-short-card, as the signed-in grid does", async () => {
    const short: DashboardLayout = {
      ...twoColumn,
      md: [item("out", 0, 0, 5, 4), item("md", 5, 0, 5, 8), item("img", 0, 8, 10, 5)],
    };
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], short),
    );
    const { container } = renderViewer();
    await settled();
    expect(cell(container, "out").hasAttribute("data-short-card")).toBe(true);
    expect(cell(container, "md").hasAttribute("data-short-card")).toBe(false);
  });

  it("renders no drag, resize, edit or menu affordance on any cell", async () => {
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], twoColumn),
    );
    const { container } = renderViewer();
    await settled();
    // react-grid-layout marks every item `react-resizable-hide` (its stylesheet hides the handle) when resizing is off.
    const items = container.querySelectorAll(".react-grid-item");
    expect(items.length).toBe(3);
    items.forEach((el) => {
      expect(el.classList.contains("react-resizable-hide")).toBe(true);
      expect(el.classList.contains("react-draggable")).toBe(false);
    });
    expect(container.querySelector(".panel-grid-card__handle")).toBeNull();
    expect(container.querySelector(".react-draggable-dragging")).toBeNull();
    expect(screen.queryByRole("button", { name: /actions|edit|delete|resize/i })).toBeNull();
  });

  it("sends no layout save or repair request for the dashboard's owner, across breakpoint changes", async () => {
    const patch = jest.spyOn(httpClient, "patch");
    const post = jest.spyOn(httpClient, "post");
    const put = jest.spyOn(httpClient, "put");
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([outputPanel, markdownPanel, imagePanel], {
        ...twoColumn,
        // a stored-bad (overlapping) md layout is what the signed-in grid would repair
        md: [item("out", 0, 0, 5, 6), item("md", 0, 0, 5, 6), item("img", 0, 0, 10, 5)],
      }),
    );
    const { container } = renderViewer("owner-user");
    await settled();
    for (const w of [1500, 900, 343, 1408]) resizeTo(w);
    expect(container.querySelector("ul[aria-label='Dashboard panels']")).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    const writes = post.mock.calls.map((c) => String(c[0]));
    expect(
      writes.filter((u) => u.includes("/layout/repair") || u.includes("/dashboards/")),
    ).toEqual([]);
    patch.mockRestore();
    post.mockRestore();
    put.mockRestore();
  });
});

describe("PublicDashboardViewerPage content panels (HEL-1587)", () => {
  it("renders markdown, image (with caption), text and divider through the shared renderers", async () => {
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult(
        [
          markdownPanel,
          imagePanel,
          makeTextPanel({ id: "txt", title: "Note", config: { content: "Plain note body" } }),
          makeDividerPanel({ id: "div", title: "Rule" }),
        ],
        {
          lg: [],
          md: [
            item("md", 0, 0, 5, 4),
            item("img", 5, 0, 5, 5),
            item("txt", 0, 4, 5, 3),
            item("div", 0, 7, 10, 2),
          ],
          sm: [],
          xs: [],
        },
      ),
    );
    const { container } = renderViewer();
    // The jest `react-markdown` stand-in renders the raw source under this test id (the real renderer is covered by the e2e).
    expect(await screen.findByTestId("markdown-content")).toHaveTextContent(
      "Headline of the story",
    );
    expect(screen.queryByText("markdown")).not.toBeInTheDocument();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/uploads/image/abc");
    expect(screen.getByText("A caption")).toBeInTheDocument();
    expect(screen.getByText("Plain note body")).toBeInTheDocument();
    expect(container.querySelector(".divider-panel, [role='separator']")).not.toBeNull();
  });

  // GUARD, not a red: jest maps `react-markdown` to a stand-in that prints the raw source, so the markdown half of this proves
  // nothing about sanitising (the e2e, on the real renderer, is the check); the hostile image URL half runs the real code.
  it("renders hostile markdown and a hostile image URL inert", async () => {
    const hostileMd = makeMarkdownPanel({
      id: "md",
      title: "Story",
      config: {
        content:
          'Safe line\n\n<script>window.__pwned = 1</script>\n\n[click](javascript:window.__pwned=2)\n\n<img src=x onerror="window.__pwned=3">\n\n![p](javascript:window.__pwned=4)',
      },
    });
    const hostileImg = makeImagePanel({
      id: "img",
      title: "Photo",
      config: { imageUrl: "javascript:alert(1)", imageFit: "cover", caption: null },
    });
    const dataImg = makeImagePanel({
      id: "img2",
      title: "Data",
      config: {
        imageUrl: "data:text/html,<script>alert(1)</script>",
        imageFit: "cover",
        caption: null,
      },
    });
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([hostileMd, hostileImg, dataImg], {
        lg: [],
        md: [item("md", 0, 0, 5, 5), item("img", 5, 0, 5, 5), item("img2", 0, 5, 5, 5)],
        sm: [],
        xs: [],
      }),
    );
    const { container } = renderViewer();
    await screen.findByTestId("markdown-content");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
    expect(container.querySelector("[src^='javascript']")).toBeNull();
    expect(container.querySelector("[src^='data:']")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // Both hostile image panels show the existing empty state, never an <img>.
    expect(container.querySelectorAll(".image-panel--empty")).toHaveLength(2);
  });

  it("never renders a form panel through PanelContent / FormRenderer", async () => {
    fetchFormSchemaMock.mockResolvedValue({ fields: [] });
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult(
        [
          makeFormPanel({
            id: "frm",
            title: "Intake",
            config: {
              dataSourceId: "ds-1",
              fields: [{ sourceField: "qty", control: "number" }],
              submit: { writeMode: "append" },
            },
          }),
        ],
        { lg: [], md: [item("frm", 0, 0, 5, 5)], sm: [], xs: [] },
      ),
    );
    renderViewer();
    // FormRenderer is mocked to throw; reaching here without an error boundary trip means the preview was used.
    await waitFor(() => expect(fetchFormSchemaMock).toHaveBeenCalledWith("dash-1", "frm", "tok"));
  });
});

describe("PublicDashboardViewerPage form preview (HEL-1587)", () => {
  const formPanel = makeFormPanel({
    id: "frm",
    title: "Intake",
    config: {
      dataSourceId: "ds-1",
      fields: [
        { sourceField: "qty", control: "number", label: "Quantity" },
        { sourceField: "note", control: "text", label: "Note", initialValue: "hello" },
        { sourceField: "hits", control: "counter", label: "Hits" },
        { sourceField: "kind", control: "select", label: "Kind", options: ["a", "b"] },
        { sourceField: "ok", control: "checkbox", label: "Okay" },
      ],
      submit: { writeMode: "append", label: "Send it" },
    },
  });
  const schema = {
    fields: [
      { name: "qty", type: "integer" as const, required: true },
      { name: "note", type: "string" as const, required: false },
      { name: "hits", type: "integer" as const, required: true },
      { name: "kind", type: "string" as const, required: false },
      { name: "ok", type: "boolean" as const, required: false },
    ],
  };

  it("shows the labels with every control disabled, no submit control, and sends no submit request", async () => {
    const post = jest.spyOn(httpClient, "post");
    fetchFormSchemaMock.mockResolvedValue(schema);
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([formPanel], { lg: [], md: [item("frm", 0, 0, 5, 6)], sm: [], xs: [] }),
    );
    const { container } = renderViewer("anyone");
    expect(await screen.findByText("Quantity")).toBeInTheDocument();
    expect(screen.getByText("Hits")).toBeInTheDocument();
    expect(screen.getByText("Read-only preview")).toBeInTheDocument();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button[type='submit']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send it" })).toBeNull();

    const qty = screen.getByLabelText("Quantity") as HTMLInputElement;
    expect(qty).toBeDisabled();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("hello");
    expect(screen.getByRole("spinbutton", { name: "Hits" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: /Increase Hits/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Decrease Hits/ })).toBeDisabled();
    expect(
      container.querySelector("button[aria-label='Kind'], [aria-label='Kind']"),
    ).toBeDisabled();
    expect(container.querySelector("input[type='checkbox']")).toBeDisabled();

    // Try every control.
    fireEvent.change(qty, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Increase Hits/ }));
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Hits" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByLabelText("Note"), { key: "Enter" });
    expect(submitFormPanelMock).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "Hits" })).toHaveAttribute("aria-valuenow", "0");
    post.mockRestore();
  });

  it("shows a quiet unavailable state when the declarations cannot be read", async () => {
    fetchFormSchemaMock.mockRejectedValue(new Error("nope"));
    fetchPanelsMock.mockResolvedValue(
      publicPanelsResult([formPanel], { lg: [], md: [item("frm", 0, 0, 5, 6)], sm: [], xs: [] }),
    );
    renderViewer();
    expect(await screen.findByText("Form preview unavailable")).toBeInTheDocument();
  });
});
