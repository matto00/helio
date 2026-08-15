import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ProposalHandoff } from "./ProposalHandoff";
import type { AssistantProposalExtraction } from "../proposalExtraction";
import type { DashboardProposal } from "../../dashboards/types/proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";

/** Renders the exact router state a navigation carried, mirroring
 * `AuthoringChatDrawer.test.tsx`'s `ReviewRouteProbe` pattern -- asserts the byte-identical shape
 * without mocking react-router internals. */
function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-probe">{JSON.stringify(location.state)}</div>;
}

function renderAt(extraction: AssistantProposalExtraction) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ProposalHandoff extraction={extraction} />} />
        <Route path="/proposals/review" element={<RouteProbe />} />
        <Route path="/patch-sets/review" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProposalHandoff", () => {
  // tasks.md 5.6 — a successful propose_dashboard result renders a working "Review proposal"
  // action that navigates to /proposals/review with the parsed DashboardProposal in router state.
  it("navigates to /proposals/review with the parsed DashboardProposal on Review proposal", () => {
    const proposal: DashboardProposal = {
      dashboardName: "Revenue Overview",
      panels: [{ title: "MRR", type: "metric" }],
    };

    renderAt({ kind: "dashboard", input: proposal });

    expect(screen.getByText("Proposal ready")).toBeInTheDocument();
    expect(screen.getByText("Revenue Overview · 1 panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));

    const state = JSON.parse(screen.getByTestId("route-probe").textContent ?? "null") as {
      proposal: DashboardProposal;
    };
    expect(state.proposal).toEqual(proposal);
  });

  // tasks.md 5.7 — a successful propose_patch_set result renders a working hand-off to
  // /patch-sets/review with the parsed PatchSet in router state.
  it("navigates to /patch-sets/review with the parsed PatchSet on Review proposal", () => {
    const patchSet: PatchSet = {
      summary: "Rename a panel",
      edits: [
        { target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "New title" } },
      ],
    };

    renderAt({ kind: "patch", input: patchSet });

    expect(screen.getByText("Proposal ready")).toBeInTheDocument();
    expect(screen.getByText("1 edit proposed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));

    const state = JSON.parse(screen.getByTestId("route-probe").textContent ?? "null") as {
      patchSet: PatchSet;
    };
    expect(state.patchSet).toEqual(patchSet);
  });

  // tasks.md 5.8 — a successful propose_pipeline/propose_combined result renders the
  // informational notice with no navigation action.
  it.each(["pipeline", "combined"] as const)(
    "renders an informational notice with no navigation action for kind=%s",
    (kind) => {
      renderAt({ kind, input: {} });

      expect(
        screen.getByText("This proposal type doesn't have a review page yet."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
});
