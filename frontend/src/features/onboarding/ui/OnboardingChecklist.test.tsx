import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";

import { fetchSources as fetchSourcesRequest } from "../../sources/services/dataSourceService";
import { getPipelines as getPipelinesRequest } from "../../pipelines/services/pipelineService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { CreateActionResult } from "../../dashboards/hooks/useCreateDashboardAction";
import { OnboardingChecklist } from "./OnboardingChecklist";

jest.mock("../../sources/services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn().mockResolvedValue([]),
}));

const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const getPipelinesMock = jest.mocked(getPipelinesRequest);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function noopCreateDashboardAction(
  overrides: Partial<CreateActionResult> = {},
): CreateActionResult {
  return {
    cta: { label: "New dashboard", onClick: jest.fn(), disabled: false },
    error: null,
    isPending: false,
    ...overrides,
  };
}

describe("OnboardingChecklist", () => {
  beforeEach(() => {
    fetchSourcesMock.mockReset().mockResolvedValue([]);
    getPipelinesMock.mockReset().mockResolvedValue([]);
  });

  // D8 — the copy is the deliverable; assert it verbatim.
  it("renders D8's copy verbatim for the in-progress state", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      { sources: { status: "idle" }, pipelines: { status: "idle" } },
    );

    expect(screen.getByText("Build your first dashboard")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Helio turns a data source into a dashboard in four steps — each one feeds the next.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
    expect(screen.getByText("A CSV, a database, or an API.")).toBeInTheDocument();
    expect(screen.getByText("Build a pipeline")).toBeInTheDocument();
    expect(
      screen.getByText(/Types are only ever a pipeline.s output — you never create one directly\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Create a dashboard")).toBeInTheDocument();
    expect(screen.getByText("A canvas for your panels.")).toBeInTheDocument();
    expect(screen.getByText("Add a panel")).toBeInTheDocument();
    // task 2.3 — exact wording, not "to see it".
    expect(screen.getByText("Bind a panel to that type to see your data.")).toBeInTheDocument();
  });

  // task 2.6 — the /registry glyph rendered inline beside "type" in the
  // pipeline step's own sentence, not as a pill/chip.
  it("renders the Shapes (/registry) glyph inline in the pipeline step's sentence", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
    );
    const pipelineDescription = screen.getByText(/Shape that source into a/);
    expect(pipelineDescription.querySelector(".lucide-shapes")).toBeInTheDocument();
    // Not rendered as a StatusChip pill (§6) — no chip class wraps it.
    expect(pipelineDescription.querySelector(".onboarding-checklist__glyph")).not.toHaveClass(
      "status-chip",
    );
  });

  // task 2.5/D8 — each step's glyph comes from `shared/chrome/sections.ts`,
  // matching the same icon the nav uses for that section.
  it("each step carries its section's own nav glyph", () => {
    const { container } = renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
    );
    const titles = container.querySelectorAll(".onboarding-checklist__step-title");
    expect(titles[0].querySelector(".lucide-database")).toBeInTheDocument(); // /sources
    expect(titles[1].querySelector(".lucide-workflow")).toBeInTheDocument(); // /pipelines
    expect(titles[2].querySelector(".lucide-layout-dashboard")).toBeInTheDocument(); // /
    expect(titles[3].querySelector(".lucide-layout-grid")).toBeInTheDocument(); // panels (D8 fallback)
  });

  describe("step completion state (D10)", () => {
    it("an indeterminate (idle/loading) collection renders a Skeleton indicator, not a check or an empty box, and keeps its action available", () => {
      const { container } = renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "loading" } },
      );
      const sourceStep = container.querySelectorAll(
        ".onboarding-checklist__step",
      )[0] as HTMLElement;
      expect(sourceStep.querySelector(".ui-skeleton")).toBeInTheDocument();
      expect(within(sourceStep).getByText("Go to Data Sources")).toBeEnabled();
    });

    it("a complete collection renders a check and no button", () => {
      const { container } = renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "succeeded", items: [{ id: "s1" } as never] } },
      );
      const sourceStep = container.querySelectorAll(
        ".onboarding-checklist__step",
      )[0] as HTMLElement;
      expect(sourceStep.querySelector(".lucide-check")).toBeInTheDocument();
      expect(within(sourceStep).queryByText("Go to Data Sources")).not.toBeInTheDocument();
    });

    // D10 — never reads as unchecked; surfaces an announced retry instead.
    it("a failed collection renders an announced error with Retry, never as unchecked/incomplete", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "failed", error: "Failed to load sources." } },
      );

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Failed to load sources.");
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      // Not rendered as the ordinary "Go to Data Sources" action.
      expect(screen.queryByText("Go to Data Sources")).not.toBeInTheDocument();
    });

    it("retry re-dispatches the failed collection's fetch", async () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "failed", error: "Failed to load sources." } },
      );

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(fetchSourcesMock).toHaveBeenCalledTimes(1));
      // Let the default-mocked resolution settle (status -> succeeded)
      // before the test ends.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Go to Data Sources" })).toBeInTheDocument(),
      );
    });

    // (probe-confirmed, not assumed) — `fetchSources` has no `condition`
    // guard (finding #3's named hazard: "a hand-rolled always-enabled Retry
    // double-fires GET /api/data-sources on a double-click"). Verified here:
    // the FIRST click's dispatch synchronously flips `sources.status` to
    // "loading" (React 18 batches the reducer update into the same commit as
    // the click), which swaps this step out of its `failed` branch entirely
    // — so the Retry control itself is gone before a second click could ever
    // land on it. A naive implementation that kept its own "is this failed"
    // flag independent of `status` (rather than deriving straight from it)
    // would leave the Retry button sitting there for a genuine double-fire —
    // this step's status-derived rendering rules that out structurally.
    it("a rapid second click cannot double-fire — the collection's own status flips away from 'failed' on the very first dispatch", async () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "failed", error: "Failed to load sources." } },
      );

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(fetchSourcesMock).toHaveBeenCalledTimes(1);

      // Nothing left in this slot reads as a retry control at all now — the
      // step rendered its indeterminate (Skeleton) state instead.
      expect(screen.getByRole("button", { name: "Go to Data Sources" })).toBeInTheDocument();

      // Let the default-mocked resolution settle before the test ends.
      await waitFor(() => expect(screen.getByRole("button", { name: "Go to Data Sources" })));
    });
  });

  it("the panel step's action is unavailable with no dashboard selected, matching the underlying create action's own state", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      { dashboards: { items: [], selectedDashboardId: null } },
    );
    expect(screen.getByRole("button", { name: "Add panel" })).toBeDisabled();
  });

  it("step 1 navigates to /sources rather than setting a modal flag", () => {
    renderWithStore(
      <>
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />
        <LocationProbe />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to Data Sources" }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/sources");
  });

  it("dismiss (X) dispatches dismissOnboarding", () => {
    const { store } = renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      { onboarding: { active: true, dismissed: false } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss getting-started checklist" }));
    expect(store.getState().onboarding).toEqual({ active: false, dismissed: true });
  });

  // task 2.16 / finding #2 — the SAME shared instance's error renders here,
  // with the same announced treatment PanelList's own empty state uses.
  it("renders the shared createDashboardAction's error with an announced role", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction({ error: "Failed to create dashboard." })}
        emphasisVariant="primary"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to create dashboard.");
  });

  describe("all-four-complete (D8)", () => {
    const completeState = {
      dashboards: {
        items: [
          {
            id: "dash-1",
            name: "Ops",
            meta: {
              createdBy: "system",
              createdAt: "2026-01-01T00:00:00Z",
              lastUpdated: "2026-01-01T00:00:00Z",
            },
          },
        ],
        selectedDashboardId: "dash-1",
        status: "succeeded" as const,
      },
      sources: { status: "succeeded" as const, items: [{ id: "s1" } as never] },
      pipelines: { status: "succeeded" as const, items: [{ id: "p1" } as never] },
      panels: {
        status: "succeeded" as const,
        loadedDashboardId: "dash-1",
        items: [{ id: "panel-1", dashboardId: "dash-1" } as never],
      },
    };

    it("keeps the chain on screen, ticked, with the completion title/lede and a Done button", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        completeState,
      );
      expect(screen.getByText("That's the whole chain")).toBeInTheDocument();
      expect(
        screen.getByText("Source, pipeline, type, panel — every dashboard you build follows it."),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(
          /^(Connect a data source|Build a pipeline|Create a dashboard|Add a panel)$/,
        ),
      ).toHaveLength(4);
      const doneButton = screen.getByRole("button", { name: "Done" });
      expect(doneButton).toBeInTheDocument();
    });

    it("Done dismisses", () => {
      const { store } = renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        completeState,
      );
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(store.getState().onboarding.active).toBe(false);
      expect(store.getState().onboarding.dismissed).toBe(true);
    });
  });

  describe("emphasis (D6)", () => {
    it("uses the Primary recipe on the first incomplete step's action in the superseding placement", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "idle" } },
      );
      expect(screen.getByRole("button", { name: "Go to Data Sources" })).toHaveClass(
        "onboarding-checklist__action--primary",
      );
    });

    it("uses the Secondary recipe above the grid instead", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="secondary"
        />,
        { sources: { status: "idle" } },
      );
      expect(screen.getByRole("button", { name: "Go to Data Sources" })).toHaveClass(
        "onboarding-checklist__action--secondary",
      );
    });

    it("non-emphasized steps use Ghost regardless of placement", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        { sources: { status: "idle" }, pipelines: { status: "idle" } },
      );
      const pipelineButton = screen.getByRole("button", { name: "New pipeline" });
      expect(pipelineButton).toHaveClass("onboarding-checklist__action--ghost");
    });
  });
});
