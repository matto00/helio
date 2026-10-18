import fs from "fs";
import path from "path";
import { screen } from "@testing-library/react";

import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";
import { resetUseNowForTests } from "../../hooks/useNow";
import { makeMarkdownPanel, makeOutputPanel } from "../../test/panelFixtures";
import { renderWithStore } from "../../test/renderWithStore";
import { DashboardMetaFacts } from "./DashboardMetaFacts";
import { DashboardRefreshLine } from "./DashboardRefreshLine";

// The hook's own network behaviour is covered by `useDashboardMeta.test.tsx`; here it returns facts.
jest.mock("../../features/panels/hooks/useDashboardMeta", () => ({ useDashboardMeta: jest.fn() }));
const metaMock = jest.mocked(useDashboardMeta);

const baseMeta: DashboardMeta = {
  panelCount: 3,
  refreshState: "unknown",
  refreshedAt: null,
  refreshIntent: null,
  sources: [],
  moreSources: 0,
};
const nineHoursAgo = () => new Date(Date.now() - 9 * 3600_000).toISOString();

function renderLine(selected: string | null = "d1") {
  return renderWithStore(
    <DashboardRefreshLine />,
    { dashboards: { items: [{ id: "d1", name: "Ops" }], selectedDashboardId: selected } },
    "/dashboards",
  );
}

beforeEach(() => {
  resetUseNowForTests();
  metaMock.mockReturnValue(baseMeta);
});

describe("DashboardRefreshLine (HEL-1583 D11)", () => {
  it("reads 'refreshed <ago>' with a success dot, a <time dateTime> and a full-date title when a pipeline ran", () => {
    const iso = nineHoursAgo();
    metaMock.mockReturnValue({
      ...baseMeta,
      refreshState: "ran",
      refreshedAt: iso,
      refreshIntent: "success",
    });
    const { container } = renderLine();
    const time = screen.getByText(/^refreshed 9 hours ago$/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", iso);
    expect(time).toHaveAttribute("title", new Date(iso).toLocaleString());
    expect(container.querySelector(".dashboard-meta-row__dot--success")).not.toBeNull();
  });

  it("reads 'last run failed <ago>' with a danger dot when the latest run failed", () => {
    metaMock.mockReturnValue({
      ...baseMeta,
      refreshState: "ran",
      refreshedAt: nineHoursAgo(),
      refreshIntent: "danger",
    });
    const { container } = renderLine();
    expect(screen.getByText(/^last run failed 9 hours ago$/)).toBeInTheDocument();
    expect(container.querySelector(".dashboard-meta-row__dot--danger")).not.toBeNull();
  });

  it("reads 'not refreshed yet' with no dot and no <time> when no feeding pipeline has run", () => {
    metaMock.mockReturnValue({ ...baseMeta, refreshState: "never" });
    const { container } = renderLine();
    expect(screen.getByText("not refreshed yet")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-meta-row__dot")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
  });

  it("renders nothing for an unknown refresh state", () => {
    const { container } = renderLine();
    expect(container.querySelector(".dashboard-refresh-line")).toBeNull();
  });

  it("renders nothing without a selected dashboard", () => {
    metaMock.mockReturnValue({ ...baseMeta, refreshState: "never" });
    const { container } = renderLine(null);
    expect(container.querySelector(".dashboard-refresh-line")).toBeNull();
  });

  it("says exactly what the desktop meta row's refresh fact says (one shared helper)", () => {
    const meta: DashboardMeta = {
      ...baseMeta,
      refreshState: "ran",
      refreshedAt: nineHoursAgo(),
      refreshIntent: "danger",
    };
    metaMock.mockReturnValue(meta);
    const line = renderLine();
    const phoneText = line.container.querySelector(".dashboard-refresh-line")?.textContent;
    line.unmount();
    const desktop = renderWithStore(
      <DashboardMetaFacts
        meta={meta}
        countOnly={false}
        showSaveState={false}
        onSaveNow={jest.fn()}
      />,
    );
    const desktopText = desktop.container.querySelector(
      ".dashboard-meta-row__refresh",
    )?.textContent;
    expect(phoneText).toBe("last run failed 9 hours ago");
    expect(desktopText).toBe(phoneText);
  });

  it("is never mounted by the public shared-dashboard viewer, which cannot read pipelines", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../features/dashboards/ui/PublicDashboardViewerPage.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/DashboardRefreshLine|useDashboardMeta|PanelList/);
  });

  it("CSS pin: the phone caption is --font-mono, like the desktop meta row's facts (fails on sans)", () => {
    const css = fs
      .readFileSync(path.join(__dirname, "DashboardMetaRow.css"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.dashboard-refresh-line\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/font-family:\s*var\(--font-mono\)\s*;/);
    expect(rule).not.toMatch(/--font-sans/);
  });

  describe("reserved slot (owner answer reserve-line-space)", () => {
    function renderWith(panels: unknown[]) {
      return renderWithStore(
        <DashboardRefreshLine />,
        {
          dashboards: { items: [{ id: "d1", name: "Ops" }], selectedDashboardId: "d1" },
          panels: { items: panels, loadedDashboardId: "d1", status: "succeeded" },
        } as never,
        "/dashboards",
      );
    }
    const fed = [makeOutputPanel({ id: "p1", dashboardId: "d1", config: { outputId: "o1" } })];

    it("reserves an empty aria-hidden slot, with no text, while the facts are loading and panels are pipeline-fed", () => {
      const { container } = renderWith(fed);
      const slot = container.querySelector(".dashboard-refresh-line");
      expect(slot).not.toBeNull();
      expect(slot).toHaveAttribute("aria-hidden", "true");
      expect(slot).toHaveAttribute("data-reserved", "true");
      expect(slot?.textContent).toBe("");
    });

    it("keeps the empty reserved slot when the refresh state resolves to unknown (no second shift)", () => {
      metaMock.mockReturnValue({ ...baseMeta, refreshState: "unknown" });
      const { container } = renderWith(fed);
      expect(container.querySelector(".dashboard-refresh-line[data-reserved]")).not.toBeNull();
    });

    it("fills the same slot, no longer reserved or hidden, once the facts resolve", () => {
      metaMock.mockReturnValue({ ...baseMeta, refreshState: "never" });
      const { container } = renderWith(fed);
      const slots = container.querySelectorAll(".dashboard-refresh-line");
      expect(slots).toHaveLength(1);
      expect(slots[0]).not.toHaveAttribute("aria-hidden");
      expect(slots[0]).not.toHaveAttribute("data-reserved");
      expect(slots[0]).toHaveTextContent("not refreshed yet");
    });

    it("reserves nothing when no panel is pipeline-fed (markdown only, or an unbound output)", () => {
      expect(
        renderWith([makeMarkdownPanel({ id: "m1", dashboardId: "d1" })]).container.querySelector(
          ".dashboard-refresh-line",
        ),
      ).toBeNull();
      const unbound = [makeOutputPanel({ id: "p2", dashboardId: "d1", config: { outputId: "" } })];
      expect(renderWith(unbound).container.querySelector(".dashboard-refresh-line")).toBeNull();
    });

    describe("before the panels are known (HEL-1646)", () => {
      function renderState(
        flag: boolean | undefined,
        panels: Record<string, unknown>,
        dashboards: unknown[] = [{ id: "d1", name: "Ops", hasPipelineFedPanels: flag }],
      ) {
        return renderWithStore(
          <DashboardRefreshLine />,
          {
            dashboards: { items: dashboards, selectedDashboardId: "d1" },
            panels: { items: [], loadedDashboardId: null, status: "idle", ...panels },
          } as never,
          "/dashboards",
        ).container.querySelector(".dashboard-refresh-line");
      }
      const otherDashboardFed = [
        makeOutputPanel({ id: "px", dashboardId: "d0", config: { outputId: "o9" } }),
      ];

      it("reserves the slot while loading when the list flag is true", () => {
        const slot = renderState(true, { loadedDashboardId: "d1", status: "loading" });
        expect(slot).toHaveAttribute("data-reserved", "true");
      });

      it("reserves nothing while loading when the flag is false or absent", () => {
        expect(renderState(false, { loadedDashboardId: "d1", status: "loading" })).toBeNull();
        expect(renderState(undefined, { loadedDashboardId: "d1", status: "loading" })).toBeNull();
      });

      it("never reads another dashboard's stale items: a fed previous dashboard gives a markdown-only target no slot", () => {
        expect(
          renderState(false, {
            items: otherDashboardFed,
            loadedDashboardId: "d1",
            status: "loading",
          }),
        ).toBeNull();
        // The pre-dispatch switch frame: succeeded, the previous dashboard's items, nothing loaded for d1.
        expect(
          renderState(false, {
            items: otherDashboardFed,
            loadedDashboardId: "d0",
            status: "succeeded",
          }),
        ).toBeNull();
      });

      it("a restoring frame (previous items, succeeded) follows the flag", () => {
        expect(
          renderState(true, {
            items: otherDashboardFed,
            loadedDashboardId: "d0",
            status: "succeeded",
          }),
        ).toHaveAttribute("data-reserved", "true");
      });

      it("loaded panels override a stale true flag, and a stale false flag", () => {
        const md = [makeMarkdownPanel({ id: "m1", dashboardId: "d1" })];
        const fedHere = [
          makeOutputPanel({ id: "p1", dashboardId: "d1", config: { outputId: "o1" } }),
        ];
        expect(
          renderState(true, { items: md, loadedDashboardId: "d1", status: "succeeded" }),
        ).toBeNull();
        expect(
          renderState(false, { items: fedHere, loadedDashboardId: "d1", status: "succeeded" }),
        ).toHaveAttribute("data-reserved", "true");
      });

      it("settled-empty and delete-last stale-empty override a true flag", () => {
        expect(renderState(true, { loadedDashboardId: "d1", status: "succeeded" })).toBeNull();
        expect(renderState(true, { status: "idle", staleDashboardId: "d1" })).toBeNull();
      });

      it("a failed panels fetch keeps the slot per the flag (keeps cards still on retry)", () => {
        expect(renderState(true, { loadedDashboardId: "d1", status: "failed" })).toHaveAttribute(
          "data-reserved",
          "true",
        );
      });
    });

    it("CSS pin: the slot has one fixed, token-derived height in every state (no literal pixels)", () => {
      const css = fs
        .readFileSync(path.join(__dirname, "DashboardMetaRow.css"), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      const rule = /\.dashboard-refresh-line\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
      expect(rule).toMatch(/(?<![-\w])height:\s*calc\(var\(--text-xs\)\s*\*\s*1\.6\)\s*;/);
      expect(rule).toMatch(/margin:\s*0 0 var\(--space-2\)\s*;/);
      expect(rule).not.toMatch(/\d+px/);
    });
  });
});
