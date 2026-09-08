import { fireEvent, render, screen } from "@testing-library/react";
import { PipelineDetailHeader } from "./PipelineDetailHeader";
import type { DataSource } from "../../sources/types/dataSource";
import type { PipelineRoot } from "../types/pipelineStep";
import type { PipelineSchedule } from "../types/pipelineSchedule";

// Ports every scenario from the retired BoundSourceBar.test.tsx,
// BoundTypeBar.test.tsx, and PipelineScheduleBar.test.tsx (HEL-719 design.md
// Risks: "port every existing scenario ... before deleting the old
// .test.tsx files") against the new consolidated header component.

const oneRoot: PipelineRoot[] = [
  { id: "root-1", dataSourceId: "src-1", dataSourceName: "Test Source" },
];

const sqlSource: DataSource = {
  id: "src-1",
  name: "Test Source",
  type: "sql",
  createdAt: "",
  updatedAt: "",
  inferredSchema: [],
  config: {
    dialect: "postgresql",
    host: "h",
    port: 5432,
    database: "d",
    user: "u",
    password: "p",
    query: "SELECT 1",
  },
};

const enabledSchedule: PipelineSchedule = {
  id: "sched-1",
  pipelineId: "p-1",
  kind: "interval",
  expression: "15m",
  enabled: true,
  timezone: "UTC",
  nextRunAt: "2026-05-01T11:00:00Z",
  lastRunAt: null,
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-01T10:00:00Z",
};

interface OverrideProps {
  roots?: PipelineRoot[];
  /** Keyed by ROOT id, mirroring the real `sourceByRootId` shape — per-root,
   *  never a single global boolean. Omit an entry (or the whole prop) for
   *  "source doesn't resolve"; the harness's default resolves `oneRoot`'s
   *  single root to `sqlSource` so most tests read as before. */
  sourceByRootId?: Record<string, DataSource | undefined>;
  onEditSource?: (sourceId: string) => void;
  onAddRoot?: (sourceId: string) => void;
  onRemoveRoot?: (rootId: string) => void;
  outputsCount?: number;
  lastRunStatus?: "succeeded" | "failed" | null;
  schedule?: PipelineSchedule | null;
  onEditSchedule?: () => void;
  onToggleScheduleEnabled?: (enabled: boolean) => void;
  onOpenHistory?: () => void;
  isOwner?: boolean;
  onOpenShare?: () => void;
}

function renderHeader(overrides: OverrideProps = {}) {
  return render(
    <PipelineDetailHeader
      roots={overrides.roots ?? oneRoot}
      sourceByRootId={overrides.sourceByRootId ?? { "root-1": sqlSource }}
      onEditSource={overrides.onEditSource ?? jest.fn()}
      onAddRoot={overrides.onAddRoot ?? jest.fn()}
      onRemoveRoot={overrides.onRemoveRoot ?? jest.fn()}
      outputsCount={overrides.outputsCount ?? 0}
      lastRunStatus={overrides.lastRunStatus ?? null}
      schedule={overrides.schedule ?? null}
      onEditSchedule={overrides.onEditSchedule ?? jest.fn()}
      onToggleScheduleEnabled={overrides.onToggleScheduleEnabled ?? jest.fn()}
      onOpenHistory={overrides.onOpenHistory ?? jest.fn()}
      isOwner={overrides.isOwner ?? false}
      onOpenShare={overrides.onOpenShare ?? jest.fn()}
    />,
  );
}

/** design.md D5 (scope amendment): the three per-field edit actions live
 *  behind one `ActionsMenu` trigger now — open it before querying for a
 *  `menuitem`. */
function openActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
}

describe("PipelineDetailHeader — bound source (ported from BoundSourceBar)", () => {
  it("renders the Edit source menu item when the single root's source resolves", () => {
    renderHeader();
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Edit source" })).toBeInTheDocument();
  });

  it("calls onEditSource with that source's id when the Edit source menu item is activated", () => {
    const onEditSource = jest.fn();
    renderHeader({ onEditSource });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit source" }));
    expect(onEditSource).toHaveBeenCalledWith("src-1");
  });

  it("does not render the Edit source menu item when the single root's source doesn't resolve", () => {
    renderHeader({ sourceByRootId: { "root-1": undefined } });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
  });
});

// HEL-1022: the header used to read only `roots[0]`, silently discarding
// every other root. Now one chip per root, labelled "Source" at one and
// "Sources (N)" at 2+ (so a single-source pipeline reads exactly as calm
// as it always has), plus a working add/remove path per chip.
describe("PipelineDetailHeader — multi-source chips (HEL-1022)", () => {
  const twoRoots: PipelineRoot[] = [
    { id: "root-1", dataSourceId: "src-1", dataSourceName: "CR11 Eval Src" },
    { id: "root-2", dataSourceId: "src-2", dataSourceName: "Orders CSV" },
  ];

  it("labels the group 'Source' (singular) with exactly one root", () => {
    renderHeader({ roots: oneRoot });
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Test Source")).toBeInTheDocument();
  });

  it("labels the group 'Sources (N)' with 2+ roots and renders a chip per root", () => {
    renderHeader({ roots: twoRoots });
    expect(screen.getByText("Sources (2)")).toBeInTheDocument();
    expect(screen.getByText("CR11 Eval Src")).toBeInTheDocument();
    expect(screen.getByText("Orders CSV")).toBeInTheDocument();
  });

  it("disables a chip's remove control when it is the only remaining source", () => {
    renderHeader({ roots: oneRoot });
    expect(screen.getByRole("button", { name: "Remove source Test Source" })).toBeDisabled();
  });

  it("calls onRemoveRoot with that chip's root id when 2+ sources exist", () => {
    const onRemoveRoot = jest.fn();
    renderHeader({ roots: twoRoots, onRemoveRoot });
    fireEvent.click(screen.getByRole("button", { name: "Remove source Orders CSV" }));
    expect(onRemoveRoot).toHaveBeenCalledWith("root-2");
  });

  it("collapses chips past the visible limit into a '+N more' affordance", () => {
    const sixRoots: PipelineRoot[] = Array.from({ length: 6 }, (_, i) => ({
      id: `root-${i}`,
      dataSourceId: `src-${i}`,
      dataSourceName: `Source ${i}`,
    }));
    renderHeader({ roots: sixRoots });
    expect(screen.getByText("Source 0")).toBeInTheDocument();
    expect(screen.getByText("Source 1")).toBeInTheDocument();
    expect(screen.getByText("Source 2")).toBeInTheDocument();
    expect(screen.queryByText("Source 3")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+3 more" })).toBeInTheDocument();
  });

  // Cold-review defect: the overflow popover previously had no dismissal
  // path at all (bare `useState`, nothing ever closed it) and used an
  // invalid `role="menu"` around non-`menuitem` children. Both fixed by
  // reusing `usePortalPopover` (the same primitive `ActionsMenu` already
  // uses) instead of hand-rolling either.
  describe("overflow popover dismissal + ARIA", () => {
    const sixRoots: PipelineRoot[] = Array.from({ length: 6 }, (_, i) => ({
      id: `root-${i}`,
      dataSourceId: `src-${i}`,
      dataSourceName: `Source ${i}`,
    }));

    function openOverflow() {
      fireEvent.click(screen.getByRole("button", { name: "+3 more" }));
    }

    it("the trigger advertises a popup and its open state", () => {
      renderHeader({ roots: sixRoots });
      const trigger = screen.getByRole("button", { name: "+3 more" });
      expect(trigger).toHaveAttribute("aria-haspopup");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      openOverflow();
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("does not render an invalid menu/menuitem ARIA structure", () => {
      renderHeader({ roots: sixRoots });
      openOverflow();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
      // A valid, non-menu container role is used instead.
      expect(screen.getByText("Source 3").closest('[role="group"]')).not.toBeNull();
    });

    it("Escape closes the popover and returns focus to the trigger", () => {
      renderHeader({ roots: sixRoots });
      const trigger = screen.getByRole("button", { name: "+3 more" });
      openOverflow();
      expect(screen.getByText("Source 3")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByText("Source 3")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("an outside click (the scrim) closes the popover", () => {
      renderHeader({ roots: sixRoots });
      openOverflow();
      expect(screen.getByText("Source 3")).toBeInTheDocument();
      const scrim = document.querySelector(".popover__scrim");
      expect(scrim).not.toBeNull();
      fireEvent.click(scrim as Element);
      expect(screen.queryByText("Source 3")).not.toBeInTheDocument();
    });
  });

  // Follow-up fix: `canEditSource` is per-root now, so a chip's editability
  // (and the navigation target) must be decided PER CHIP, not once globally.
  it("renders a chip's name as a clickable edit affordance when that root's source resolves", () => {
    const onEditSource = jest.fn();
    renderHeader({
      roots: twoRoots,
      sourceByRootId: { "root-1": sqlSource, "root-2": undefined },
      onEditSource,
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit source CR11 Eval Src" }));
    expect(onEditSource).toHaveBeenCalledWith("src-1");
  });

  it("renders a chip's name as plain non-interactive text when that root's source doesn't resolve", () => {
    renderHeader({
      roots: twoRoots,
      sourceByRootId: { "root-1": sqlSource, "root-2": undefined },
    });
    expect(screen.getByText("Orders CSV")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit source Orders CSV/ }),
    ).not.toBeInTheDocument();
  });

  // Follow-up fix: chips lost the kind badge entirely in the first pass —
  // restore it, but only when there is exactly one source (2+ stays lighter).
  it("shows the kind badge on the single chip at exactly one source", () => {
    renderHeader({ roots: oneRoot, sourceByRootId: { "root-1": sqlSource } });
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });

  it("shows no kind badge on any chip once there are 2+ sources", () => {
    renderHeader({
      roots: twoRoots,
      sourceByRootId: { "root-1": sqlSource, "root-2": sqlSource },
    });
    expect(screen.queryByText("SQL")).not.toBeInTheDocument();
  });
});

describe("PipelineDetailHeader — Outputs count + last run status (HEL-908 task 8.1)", () => {
  it("renders the Outputs count as 'Outputs (N)'", () => {
    renderHeader({ outputsCount: 3 });
    expect(screen.getByText("Outputs (3)")).toBeInTheDocument();
  });

  it("shows no status chip when lastRunStatus is null (no run yet)", () => {
    renderHeader({ lastRunStatus: null });
    expect(screen.queryByText("Succeeded")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("shows a Succeeded chip when lastRunStatus is succeeded", () => {
    renderHeader({ lastRunStatus: "succeeded" });
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("shows a Failed chip when lastRunStatus is failed", () => {
    renderHeader({ lastRunStatus: "failed" });
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("does not render an 'Edit type'/'Output type' action -- retired alongside the DataType-bound link", () => {
    renderHeader({});
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: /edit type/i })).not.toBeInTheDocument();
  });
});

describe("PipelineDetailHeader — schedule (ported from PipelineScheduleBar)", () => {
  it("shows 'No schedule set' and a 'Set schedule' menu item when schedule is null", () => {
    renderHeader({ schedule: null });
    expect(screen.getByText("No schedule set")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Set schedule" })).toBeInTheDocument();
  });

  it("activating 'Set schedule' calls onEditSchedule", () => {
    const onEditSchedule = jest.fn();
    renderHeader({ schedule: null, onEditSchedule });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Set schedule" }));
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
  });

  it("shows the expression and next-run time when enabled with a computed next run", () => {
    renderHeader({ schedule: enabledSchedule });
    expect(screen.getByText("Every 15m")).toBeInTheDocument();
    expect(screen.getByText(/next run/)).toBeInTheDocument();
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Edit schedule" })).toBeInTheDocument();
  });

  it("shows 'no next run yet' (not an error) when enabled but nextRunAt is null", () => {
    renderHeader({ schedule: { ...enabledSchedule, nextRunAt: null } });
    expect(screen.getByText("no next run yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Regression test (ported from PipelineScheduleBar.test.tsx): spray-json's
  // default `Option` formatter omits `None` fields from the wire entirely
  // rather than serializing `null` — a freshly-saved/cadence-changed
  // schedule's not-yet-computed `nextRunAt` deserializes with the key
  // **absent**, not `null`.
  it("shows 'no next run yet' (not 'Invalid Date') when nextRunAt is omitted entirely from the payload", () => {
    const { nextRunAt: _omitted, ...rest } = enabledSchedule;
    const scheduleWithOmittedNextRun = rest as unknown as PipelineSchedule;
    expect("nextRunAt" in scheduleWithOmittedNextRun).toBe(false);

    renderHeader({ schedule: scheduleWithOmittedNextRun });
    expect(screen.getByText("no next run yet")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("shows a Disabled badge and no next-run text when disabled", () => {
    renderHeader({ schedule: { ...enabledSchedule, enabled: false } });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText(/next run/)).not.toBeInTheDocument();
  });

  it("the enabled toggle reflects schedule.enabled and calls onToggleScheduleEnabled with the new value", () => {
    const onToggleScheduleEnabled = jest.fn();
    renderHeader({ schedule: enabledSchedule, onToggleScheduleEnabled });
    // F-139: rendered via the shared Toggle primitive — an ARIA switch, not a
    // bare checkbox, so its meaning (on/off) is legible from the control's
    // own shape rather than relying solely on the aria-label.
    const toggle = screen.getByRole("switch", { name: "Disable schedule" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggleScheduleEnabled).toHaveBeenCalledWith(false);
  });

  it("activating 'Edit schedule' calls onEditSchedule", () => {
    const onEditSchedule = jest.fn();
    renderHeader({ schedule: enabledSchedule, onEditSchedule });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit schedule" }));
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
  });

  it("shows a cron expression verbatim (no 'Every' prefix) for kind: cron", () => {
    renderHeader({
      schedule: { ...enabledSchedule, kind: "cron", expression: "0 * * * *" },
    });
    expect(screen.getByText("0 * * * *")).toBeInTheDocument();
  });
});

// This is the page's ONE actions menu: the edit-source/edit-schedule actions
// (design.md D5) plus Run history / Share. HEL-908 task 8.1/8.2 retired
// "Edit type" (DataType-bound) and "Preview" (superseded `PipelinePreviewModal`,
// deleted -- see per-Output previews instead).
describe("PipelineDetailHeader — actions menu", () => {
  it("one trigger exposes every available action", () => {
    renderHeader({
      roots: oneRoot,
      schedule: null,
      isOwner: true,
    });
    expect(screen.getAllByRole("button", { name: "Pipeline actions" })).toHaveLength(1);
    openActionsMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    for (const name of ["Edit source", "Set schedule", "Run history", "Share"]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("the menu narrows to only the actions the user has", () => {
    renderHeader({
      roots: oneRoot,
      sourceByRootId: { "root-1": undefined },
      schedule: enabledSchedule,
      isOwner: false,
    });
    openActionsMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
    // Owner-only, and this user is not the owner — the same gating the item
    // carried as a footer menu item before the merge.
    expect(screen.queryByRole("menuitem", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit schedule" })).toBeInTheDocument();
  });

  it("the view actions are always present, regardless of edit permissions", () => {
    renderHeader({ sourceByRootId: { "root-1": undefined }, schedule: null, isOwner: false });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Run history" })).toBeInTheDocument();
  });

  // HEL-1022 — the singular "Edit source" item is ambiguous once 2+ chips
  // exist (it used to silently pick `roots[0]`, which is the exact defect
  // this follow-up fixes); it must drop out of the menu entirely there, in
  // favor of clicking the specific chip.
  it("drops 'Edit source' from the menu entirely once there are 2+ roots", () => {
    const twoRoots: PipelineRoot[] = [
      { id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" },
      { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
    ];
    renderHeader({
      roots: twoRoots,
      sourceByRootId: { "root-1": sqlSource, "root-2": sqlSource },
    });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
  });
});

describe("PipelineDetailHeader — single-container structure (HEL-719)", () => {
  it("renders exactly one bordered/backed header container for source + type + schedule", () => {
    const { container } = renderHeader();
    expect(container.querySelectorAll(".pipeline-detail-header")).toHaveLength(1);
  });
});
