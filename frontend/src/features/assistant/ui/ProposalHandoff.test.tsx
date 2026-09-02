import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ProposalHandoff } from "./ProposalHandoff";
import type { AssistantProposalExtraction } from "../proposalExtraction";
import type { DashboardProposal } from "../../dashboards/types/proposal";
import type { PatchSet } from "../../patchSets/types/patchSet";
import type { PipelineProposal } from "../../pipelines/types/pipelineProposal";
import type { CombinedProposal } from "../../proposals/types/combinedProposal";

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
        <Route path="/pipeline-proposals/review" element={<RouteProbe />} />
        <Route path="/combined-proposals/review" element={<RouteProbe />} />
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

  // HEL-739 tasks.md 5.1/6.5 — a successful propose_pipeline result now renders a working
  // "Review proposal" action navigating to /pipeline-proposals/review with the parsed
  // PipelineProposal in router state, replacing the former informational-only fallback card.
  it("navigates to /pipeline-proposals/review with the parsed PipelineProposal on Review proposal", () => {
    const proposal: PipelineProposal = {
      pipelineName: "Sales pipeline",
      source: { sourceId: "src-1" },
      steps: [{ clientId: "s1", type: "rename", config: {} }],
      outputs: [{ kind: "table", name: "SalesMetrics" }],
    };

    renderAt({ kind: "pipeline", input: proposal });

    expect(screen.getByText("Proposal ready")).toBeInTheDocument();
    expect(screen.getByText("Sales pipeline · 1 step")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));

    const state = JSON.parse(screen.getByTestId("route-probe").textContent ?? "null") as {
      proposal: PipelineProposal;
    };
    expect(state.proposal).toEqual(proposal);
  });

  // HEL-739 tasks.md 5.1/6.5 — same coverage for a successful propose_combined result, navigating
  // to /combined-proposals/review with the parsed CombinedProposal in router state.
  it("navigates to /combined-proposals/review with the parsed CombinedProposal on Review proposal", () => {
    const proposal: CombinedProposal = {
      pipeline: {
        pipelineName: "Sales pipeline",
        source: { type: "static", name: "Demo source", config: {} },
        steps: [],
        outputs: [{ kind: "table", name: "SalesMetrics" }],
      },
      dashboard: {
        dashboardName: "Sales overview",
        panels: [{ title: "Total", type: "output", outputId: "$pipelineOutput" }],
      },
    };

    renderAt({ kind: "combined", input: proposal });

    expect(screen.getByText("Proposal ready")).toBeInTheDocument();
    expect(screen.getByText("Sales pipeline → Sales overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));

    const state = JSON.parse(screen.getByTestId("route-probe").textContent ?? "null") as {
      proposal: CombinedProposal;
    };
    expect(state.proposal).toEqual(proposal);
  });
});
