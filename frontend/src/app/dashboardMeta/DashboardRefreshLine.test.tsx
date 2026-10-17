import fs from "fs";
import path from "path";
import { screen } from "@testing-library/react";

import { useDashboardMeta } from "../../features/panels/hooks/useDashboardMeta";
import type { DashboardMeta } from "../../features/panels/state/dashboardMeta";
import { resetUseNowForTests } from "../../hooks/useNow";
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
});
