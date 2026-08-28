import { fireEvent, render, screen } from "@testing-library/react";
import { PipelineDetailHeader } from "./PipelineDetailHeader";
import type { DataSource } from "../../sources/types/dataSource";
import type { PipelineSchedule } from "../types/pipelineSchedule";

// Ports every scenario from the retired BoundSourceBar.test.tsx,
// BoundTypeBar.test.tsx, and PipelineScheduleBar.test.tsx (HEL-719 design.md
// Risks: "port every existing scenario ... before deleting the old
// .test.tsx files") against the new consolidated header component.

const sqlSource: DataSource = {
  id: "src-1",
  name: "Test Source",
  type: "sql",
  createdAt: "",
  updatedAt: "",
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
  sourceName?: string;
  source?: DataSource | undefined;
  canEditSource?: boolean;
  onEditSource?: () => void;
  outputTypeName?: string;
  canEditType?: boolean;
  onEditType?: () => void;
  schedule?: PipelineSchedule | null;
  onEditSchedule?: () => void;
  onToggleScheduleEnabled?: (enabled: boolean) => void;
  onOpenHistory?: () => void;
  onOpenPreview?: () => void;
  isOwner?: boolean;
  onOpenShare?: () => void;
}

function renderHeader(overrides: OverrideProps = {}) {
  return render(
    <PipelineDetailHeader
      sourceName={overrides.sourceName ?? "Test Source"}
      source={overrides.source}
      canEditSource={overrides.canEditSource ?? false}
      onEditSource={overrides.onEditSource ?? jest.fn()}
      outputTypeName={overrides.outputTypeName ?? "Test Type"}
      canEditType={overrides.canEditType ?? false}
      onEditType={overrides.onEditType ?? jest.fn()}
      schedule={overrides.schedule ?? null}
      onEditSchedule={overrides.onEditSchedule ?? jest.fn()}
      onToggleScheduleEnabled={overrides.onToggleScheduleEnabled ?? jest.fn()}
      onOpenHistory={overrides.onOpenHistory ?? jest.fn()}
      onOpenPreview={overrides.onOpenPreview ?? jest.fn()}
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
  it("renders the Edit source menu item when canEditSource is true", () => {
    renderHeader({ source: sqlSource, canEditSource: true });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Edit source" })).toBeInTheDocument();
  });

  it("calls onEditSource when the Edit source menu item is activated", () => {
    const onEditSource = jest.fn();
    renderHeader({ source: sqlSource, canEditSource: true, onEditSource });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit source" }));
    expect(onEditSource).toHaveBeenCalledTimes(1);
  });

  it("does not render the Edit source menu item when canEditSource is false", () => {
    renderHeader({ source: undefined, canEditSource: false });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
  });

  it("shows the source's kind badge when a matching DataSource is resolved", () => {
    renderHeader({ source: sqlSource });
    expect(screen.getByText("SQL")).toBeInTheDocument();
  });
});

describe("PipelineDetailHeader — bound output type (ported from BoundTypeBar)", () => {
  it("renders the output type name", () => {
    renderHeader({ outputTypeName: "Test Type" });
    expect(screen.getByText("Test Type")).toBeInTheDocument();
  });

  it("renders the Edit type menu item when canEditType is true", () => {
    renderHeader({ canEditType: true });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Edit type" })).toBeInTheDocument();
  });

  it("calls onEditType when the Edit type menu item is activated", () => {
    const onEditType = jest.fn();
    renderHeader({ canEditType: true, onEditType });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit type" }));
    expect(onEditType).toHaveBeenCalledTimes(1);
  });

  it("does not render the Edit type menu item when canEditType is false", () => {
    renderHeader({ canEditType: false });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Edit type" })).not.toBeInTheDocument();
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

// This is the page's ONE actions menu: the three edit actions (design.md D5)
// plus Run history / Preview / Share, which moved here from the footer's
// former second `ActionsMenu`.
describe("PipelineDetailHeader — actions menu", () => {
  it("one trigger exposes every available action", () => {
    renderHeader({
      source: sqlSource,
      canEditSource: true,
      canEditType: true,
      schedule: null,
      isOwner: true,
    });
    expect(screen.getAllByRole("button", { name: "Pipeline actions" })).toHaveLength(1);
    openActionsMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    for (const name of [
      "Edit source",
      "Edit type",
      "Set schedule",
      "Run history",
      "Preview",
      "Share",
    ]) {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("the menu narrows to only the actions the user has", () => {
    renderHeader({
      source: undefined,
      canEditSource: false,
      canEditType: true,
      schedule: enabledSchedule,
      isOwner: false,
    });
    openActionsMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).not.toBeInTheDocument();
    // Owner-only, and this user is not the owner — the same gating the item
    // carried as a footer menu item before the merge.
    expect(screen.queryByRole("menuitem", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit type" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit schedule" })).toBeInTheDocument();
  });

  it("the view actions are always present, regardless of edit permissions", () => {
    renderHeader({ canEditSource: false, canEditType: false, schedule: null, isOwner: false });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Run history" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Preview" })).toBeInTheDocument();
  });
});

describe("PipelineDetailHeader — single-container structure (HEL-719)", () => {
  it("renders exactly one bordered/backed header container for source + type + schedule", () => {
    const { container } = renderHeader({ source: sqlSource, canEditSource: true });
    expect(container.querySelectorAll(".pipeline-detail-header")).toHaveLength(1);
  });
});
