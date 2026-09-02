import {
  allOnboardingStepsComplete,
  deriveCollectionStepStatus,
  derivePanelStepStatus,
  derivePlacementStepStatus,
  firstIncompleteStep,
  type OnboardingStepStatuses,
} from "./onboardingSteps";

describe("deriveCollectionStepStatus", () => {
  it("idle or loading is indeterminate, regardless of item count", () => {
    expect(deriveCollectionStepStatus("idle", 0)).toBe("indeterminate");
    expect(deriveCollectionStepStatus("idle", 3)).toBe("indeterminate");
    expect(deriveCollectionStepStatus("loading", 0)).toBe("indeterminate");
  });

  it("succeeded with items is complete; succeeded with none is incomplete", () => {
    expect(deriveCollectionStepStatus("succeeded", 1)).toBe("complete");
    expect(deriveCollectionStepStatus("succeeded", 0)).toBe("incomplete");
  });

  // D10 — the core defect this derivation exists to prevent: a failed fetch
  // must NEVER fall through to "incomplete", which would assert as fact that
  // the user hasn't done something they may well have done.
  it("failed is reported failed, never incomplete — even with zero items", () => {
    expect(deriveCollectionStepStatus("failed", 0)).toBe("failed");
  });

  it("(red-before-green) a naive `status === 'succeeded' ? ... : 'incomplete'` derivation WOULD misreport failed as incomplete", () => {
    function naiveDerivation(
      status: "idle" | "loading" | "succeeded" | "failed",
      itemCount: number,
    ): string {
      return status === "succeeded" && itemCount > 0 ? "complete" : "incomplete";
    }
    // Proves the probe can actually distinguish the two: the naive version
    // genuinely produces the wrong answer...
    expect(naiveDerivation("failed", 0)).toBe("incomplete");
    // ...while the real derivation does not.
    expect(deriveCollectionStepStatus("failed", 0)).not.toBe("incomplete");
    expect(deriveCollectionStepStatus("failed", 0)).toBe("failed");
  });
});

describe("derivePanelStepStatus", () => {
  it("no dashboard selected is incomplete", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: null,
        panels: { status: "succeeded", loadedDashboardId: null, items: [] },
      }),
    ).toBe("incomplete");
  });

  it("complete when a panel exists for the selected dashboard", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-1",
        panels: {
          status: "succeeded",
          loadedDashboardId: "dash-1",
          items: [{ dashboardId: "dash-1" }],
        },
      }),
    ).toBe("complete");
  });

  it("indeterminate while THIS dashboard's fetch is in flight", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-1",
        panels: { status: "loading", loadedDashboardId: "dash-1", items: [] },
      }),
    ).toBe("indeterminate");
  });

  it("failed when THIS dashboard's fetch failed", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-1",
        panels: { status: "failed", loadedDashboardId: "dash-1", items: [] },
      }),
    ).toBe("failed");
  });

  // task 1.11 — the specific defect this derivation exists to avoid: `idle`
  // is re-entrant (HEL-548's `staleDashboardId` post-delete terminal state
  // also renders as `idle`), so it must never be read as "loading".
  it("idle (the post-delete terminal state) reports incomplete, NOT indeterminate", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-1",
        panels: { status: "idle", loadedDashboardId: null, items: [] },
      }),
    ).toBe("incomplete");
  });

  it("(red-before-green) a naive `status === 'idle' -> indeterminate` derivation WOULD park a permanent skeleton over the post-delete terminal state", () => {
    function naiveDerivation(status: string): string {
      if (status === "idle" || status === "loading") return "indeterminate";
      return "incomplete";
    }
    expect(naiveDerivation("idle")).toBe("indeterminate"); // the wrong answer, proven reachable
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-1",
        panels: { status: "idle", loadedDashboardId: null, items: [] },
      }),
    ).not.toBe("indeterminate");
  });

  it("only counts panels belonging to the SELECTED dashboard — a stale previous-dashboard item does not satisfy it", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-2",
        panels: {
          status: "succeeded",
          loadedDashboardId: "dash-1",
          items: [{ dashboardId: "dash-1" }],
        },
      }),
    ).toBe("incomplete");
  });

  it("a failed fetch for a DIFFERENT dashboard than the one selected does not leak into this step", () => {
    expect(
      derivePanelStepStatus({
        selectedDashboardId: "dash-2",
        panels: { status: "failed", loadedDashboardId: "dash-1", items: [] },
      }),
    ).toBe("incomplete");
  });
});

describe("derivePlacementStepStatus", () => {
  it("reports the dashboard status while no dashboard exists yet", () => {
    expect(derivePlacementStepStatus("incomplete", "incomplete")).toBe("incomplete");
    expect(derivePlacementStepStatus("indeterminate", "incomplete")).toBe("indeterminate");
    expect(derivePlacementStepStatus("failed", "incomplete")).toBe("failed");
  });

  it("defers to the panel status once a dashboard exists", () => {
    expect(derivePlacementStepStatus("complete", "complete")).toBe("complete");
    expect(derivePlacementStepStatus("complete", "incomplete")).toBe("incomplete");
    expect(derivePlacementStepStatus("complete", "indeterminate")).toBe("indeterminate");
    expect(derivePlacementStepStatus("complete", "failed")).toBe("failed");
  });
});

describe("allOnboardingStepsComplete / firstIncompleteStep", () => {
  const allComplete: OnboardingStepStatuses = {
    source: "complete",
    pipeline: "complete",
    placement: "complete",
  };

  it("true only when all three steps are complete", () => {
    expect(allOnboardingStepsComplete(allComplete)).toBe(true);
    expect(allOnboardingStepsComplete({ ...allComplete, placement: "incomplete" })).toBe(false);
    expect(allOnboardingStepsComplete({ ...allComplete, source: "indeterminate" })).toBe(false);
    expect(allOnboardingStepsComplete({ ...allComplete, pipeline: "failed" })).toBe(false);
  });

  it("firstIncompleteStep stays on step 1 while later collections are still resolving", () => {
    const steps: OnboardingStepStatuses = {
      source: "incomplete",
      pipeline: "indeterminate",
      placement: "indeterminate",
    };
    expect(firstIncompleteStep(steps)).toBe("source");
  });

  it("firstIncompleteStep is null once every step is complete", () => {
    expect(firstIncompleteStep(allComplete)).toBeNull();
  });

  it("firstIncompleteStep treats a failed step the same as any other not-complete step", () => {
    const steps: OnboardingStepStatuses = {
      source: "complete",
      pipeline: "failed",
      placement: "incomplete",
    };
    expect(firstIncompleteStep(steps)).toBe("pipeline");
  });
});
