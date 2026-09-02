import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
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

// A source must exist before there's anything to fetch/idle-check for
// pipelines — most scenarios below seed one so the pipeline step's action
// isn't unavailable for reasons unrelated to what's being tested.
const withSource = { sources: { status: "succeeded" as const, items: [{ id: "s1" } as never] } };

describe("OnboardingChecklist", () => {
  beforeEach(() => {
    fetchSourcesMock.mockReset().mockResolvedValue([]);
    getPipelinesMock.mockReset().mockResolvedValue([]);
  });

  // Spec: "The checklist teaches the source-to-output-to-dashboard model in
  // words and in glyphs" — exactly three steps, verbatim copy.
  it("renders exactly three steps with D8's copy verbatim for the in-progress state", () => {
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
        "Helio turns a data source into a dashboard in three steps — each one feeds the next.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
    expect(screen.getByText("A CSV, a database, or an API.")).toBeInTheDocument();
    expect(screen.getByText("Shape it into outputs")).toBeInTheDocument();
    expect(
      screen.getByText("Turn that source into the Outputs your dashboards will show."),
    ).toBeInTheDocument();
    expect(screen.getByText("Place them on a dashboard")).toBeInTheDocument();
    expect(
      screen.getByText("Pick an Output and drop it onto a dashboard to see your data."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/[Tt]ype/)).not.toBeInTheDocument();
    expect(screen.queryByText(/[Mm]etric/)).not.toBeInTheDocument();
  });

  // task 2.5/D8 — each step's glyph comes from `shared/chrome/sections.ts`,
  // matching the same icon the nav uses for that section (closes HEL-794).
  it("each step carries its section's own nav glyph", () => {
    const { container } = renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      withSource,
    );
    const titles = container.querySelectorAll(".onboarding-checklist__step-title");
    expect(titles[0].querySelector(".lucide-database")).toBeInTheDocument(); // /sources
    expect(titles[1].querySelector(".lucide-workflow")).toBeInTheDocument(); // /pipelines
    expect(titles[2].querySelector(".lucide-layout-dashboard")).toBeInTheDocument(); // /
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

  // ADDED requirement: "An unmet precondition leaves a step unavailable" —
  // the "shape it into outputs" step names "at least one source exists" as
  // its example precondition.
  it("the pipeline step's action is unavailable with no source connected yet", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      { sources: { status: "succeeded", items: [] } },
    );
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeDisabled();
  });

  it("the pipeline step's action is available once a source exists", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      withSource,
    );
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeEnabled();
  });

  it("with no dashboard yet, the placement step's action creates a dashboard, not the Output picker", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      { dashboards: { items: [], selectedDashboardId: null, status: "succeeded" }, ...withSource },
    );
    expect(screen.getByRole("button", { name: "New dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add panel" })).not.toBeInTheDocument();
  });

  it("once a dashboard exists, the placement step's action opens the Output picker (Add panel), never PanelCreationModal", () => {
    renderWithStore(
      <OnboardingChecklist
        createDashboardAction={noopCreateDashboardAction()}
        emphasisVariant="primary"
      />,
      {
        dashboards: {
          items: [{ id: "dash-1" } as never],
          selectedDashboardId: "dash-1",
          status: "succeeded",
        },
        ...withSource,
      },
    );
    expect(screen.getByRole("button", { name: "Add panel" })).toBeInTheDocument();
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
      { dashboards: { items: [], selectedDashboardId: null, status: "succeeded" } },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to create dashboard.");
  });

  describe("all-three-complete", () => {
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

    it("keeps the chain on screen, ticked, with the completion title/lede (naming all five destinations) and a Done button", () => {
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        completeState,
      );
      expect(screen.getByText("That's the whole chain")).toBeInTheDocument();
      // Closing copy names all five nav destinations (closes the surviving
      // half of HEL-793).
      for (const destination of ["Dashboards", "Pipelines", "Sources", "Connectors", "Assistant"]) {
        expect(screen.getByText(new RegExp(destination))).toBeInTheDocument();
      }
      expect(
        screen.getAllByText(
          /^(Connect a data source|Shape it into outputs|Place them on a dashboard)$/,
        ),
      ).toHaveLength(3);
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

    // HEL-792 — a regression test asserting COMPUTED styles, not just text
    // content/class name. `OnboardingChecklist.css` is mocked away by
    // jest's moduleNameMapper (like every `.css` import in this suite), so
    // this test loads the REAL file off disk with `fs.readFileSync` and
    // injects it into `document.head` as a real `<style>` tag — jsdom's CSS
    // engine then actually matches the selector and resolves declared
    // values (verified: a `var(...)` declaration comes back verbatim from
    // `getComputedStyle`, since jsdom doesn't evaluate custom properties,
    // but DOES apply the matching rule) onto the rendered element.
    const realCss = readFileSync(join(__dirname, "OnboardingChecklist.css"), "utf8");

    function renderWithInjectedCss(css: string) {
      const styleTag = document.createElement("style");
      styleTag.textContent = css;
      document.head.appendChild(styleTag);
      renderWithStore(
        <OnboardingChecklist
          createDashboardAction={noopCreateDashboardAction()}
          emphasisVariant="primary"
        />,
        completeState,
      );
      return () => styleTag.remove();
    }

    afterEach(() => {
      document.head.innerHTML = "";
    });

    it("the Done button's computed background/color come from the real CSS cascade (HEL-792)", () => {
      renderWithInjectedCss(realCss);
      const doneButton = screen.getByRole("button", { name: "Done" });
      const computed = getComputedStyle(doneButton);
      expect(computed.getPropertyValue("background")).toBe("var(--app-accent)");
      expect(computed.getPropertyValue("color")).toBe("var(--app-accent-ink)");
    });

    // (red-before-green, HEL-792's explicit requirement) — with the
    // governing rule's declarations stripped out of the SAME real
    // stylesheet (simulating the cascade being deliberately broken), the
    // assertion above must fail. Proves this test can actually catch a
    // regression, not just echo back whatever renders.
    it("(red-before-green) stripping the governing rule's declarations from the real stylesheet fails the computed-style assertion", () => {
      const brokenCss = realCss.replace(
        /\.onboarding-checklist__done--primary\s*\{[^}]*\}/,
        ".onboarding-checklist__done--primary { }",
      );
      // Confirm the probe actually found and blanked the rule — otherwise
      // this "red" case would trivially pass for the wrong reason.
      expect(brokenCss).not.toEqual(realCss);
      renderWithInjectedCss(brokenCss);
      const doneButton = screen.getByRole("button", { name: "Done" });
      const computed = getComputedStyle(doneButton);
      expect(computed.getPropertyValue("background")).not.toBe("var(--app-accent)");
      expect(computed.getPropertyValue("color")).not.toBe("var(--app-accent-ink)");
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
