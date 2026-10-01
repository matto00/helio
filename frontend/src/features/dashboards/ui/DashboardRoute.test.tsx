import { fireEvent, screen } from "@testing-library/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import type { UserTier } from "../../auth/types/user";
import type { FirstRunBuildResult } from "../../onboarding/services/firstRunService";
import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardRoute } from "./DashboardRoute";

jest.mock("../../panels/ui/PanelList", () => ({
  PanelList: () => <p>panel list</p>,
}));

const result: FirstRunBuildResult = {
  dashboardId: "dash-2",
  dashboardName: "Sales",
  panelCount: 3,
  pipelineId: "pipe-9",
  pipelineName: "Sales pipeline",
  sourceId: "src-7",
  sourceName: "Sales",
};

const dashboards = (status: "idle" | "loading" | "succeeded" | "failed" = "succeeded") => ({
  items: [
    { id: "dash-1", name: "Ops" },
    { id: "dash-2", name: "Sales" },
  ],
  selectedDashboardId: "dash-1",
  status,
});

const user = (tier: UserTier) => ({
  id: "u1",
  email: "a@b.c",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier,
});

function LocationProbe() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderRoute(opts: {
  id: string;
  tier?: UserTier;
  firstRun?: boolean;
  status?: "idle" | "loading" | "succeeded" | "failed";
}) {
  return renderWithStore(
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={`/dashboards/${opts.id}`}
            replace
            state={opts.firstRun ? { firstRun: result } : null}
          />
        }
      />
      <Route path="/dashboards/:id" element={<DashboardRoute />} />
      <Route path="/chat" element={<LocationProbe />} />
    </Routes>,
    {
      auth: { status: "authenticated", currentUser: user(opts.tier ?? "free") },
      dashboards: dashboards(opts.status),
    },
  );
}

describe("DashboardRoute (HEL-1209)", () => {
  it("selects the routed dashboard and renders the panel list", () => {
    const { store } = renderRoute({ id: "dash-2" });

    expect(screen.getByText("panel list")).toBeInTheDocument();
    expect(store.getState().dashboards.selectedDashboardId).toBe("dash-2");
  });

  it("shows a not-found state, with a way back, for an unknown id", () => {
    const { store } = renderRoute({ id: "nope" });

    expect(screen.getByText("Dashboard not found")).toBeInTheDocument();
    expect(screen.queryByText("panel list")).not.toBeInTheDocument();
    expect(store.getState().dashboards.selectedDashboardId).toBe("dash-1");
    expect(screen.getByRole("button", { name: "Back to dashboards" })).toBeInTheDocument();
  });

  it("waits for the dashboards fetch instead of claiming not-found while it is in flight", () => {
    renderRoute({ id: "dash-2", status: "loading" });
    expect(screen.queryByText("Dashboard not found")).not.toBeInTheDocument();
  });

  it.each<UserTier>(["beta", "owner"])(
    "offers 'Refine with the assistant' to a %s user after a first run",
    (tier) => {
      renderRoute({ id: "dash-2", tier, firstRun: true });
      expect(screen.getByRole("button", { name: "Refine with the assistant" })).toBeInTheDocument();
    },
  );

  it("does NOT render 'Refine with the assistant' for a free user", () => {
    renderRoute({ id: "dash-2", tier: "free", firstRun: true });

    expect(screen.getByText("panel list")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Refine with the assistant" }),
    ).not.toBeInTheDocument();
  });

  it("does not render the refine action on a dashboard that was not just built", () => {
    renderRoute({ id: "dash-2", tier: "beta", firstRun: false });
    expect(
      screen.queryByRole("button", { name: "Refine with the assistant" }),
    ).not.toBeInTheDocument();
  });

  it("hands off to /chat", () => {
    renderRoute({ id: "dash-2", tier: "beta", firstRun: true });
    fireEvent.click(screen.getByRole("button", { name: "Refine with the assistant" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/chat");
  });
});
