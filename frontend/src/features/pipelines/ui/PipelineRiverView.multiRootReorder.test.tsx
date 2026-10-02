// PipelineRiverView.multiRootReorder.test.tsx — HEL-1007. Move up/down + drag-reorder must work in
// EVERY root's trunk lane (HEL-968 wired root 0 only; every other root rendered permanently-disabled
// controls). Fixtures carry explicit `rootId`/`parentStepId` and deliberately do NOT go through
// `linkChain`, which would chain root 2's head onto root 1's tail and collapse this to one root.

import { useCallback, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { PipelineRiverView } from "./PipelineRiverView";
import { OP_TYPES } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

// `StepPalette` renders on the shared Modal (<dialog>), which jsdom doesn't implement; its catalog
// fetch is mocked so mounting the river never reaches the real httpClient.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
jest.mock("../services/pipelineService", () => ({
  getPipelineStepCatalog: jest.fn().mockResolvedValue({ groups: [], steps: [] }),
}));

const op = (id: string) => OP_TYPES.find((o) => o.id === id)!;
function step(id: string, opId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    opType: op(opId),
    label: op(opId).label,
    config: {} as Step["config"],
    enabled: true,
    ...extra,
  };
}

const ROOTS: PipelineRoot[] = [
  { id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" },
  { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
];

// Root 1 (Orders): Filter -> Limit.   Root 2 (Shipments): Sort -> Cast -> Select.
const a = step("a", "filter", { rootId: "root-1" });
const b = step("b", "limit", { parentStepId: "a", position: 0 });
const x = step("x", "sort", { rootId: "root-2" });
const y = step("y", "cast", { parentStepId: "x" });
const z = step("z", "select", { parentStepId: "y" });
const TWO_LANE_STEPS: Step[] = [a, b, x, y, z];

function riverProps(steps: Step[]): ComponentProps<typeof PipelineRiverView> {
  return {
    steps,
    laneGraph: buildLaneGraph(steps, ROOTS),
    roots: ROOTS,
    onRemoveRoot: jest.fn(),
    pipelineId: "pipe-1",
    dropdownOpen: false,
    openDropdown: jest.fn(),
    closeDropdown: jest.fn(),
    onAddStep: jest.fn(),
    onInsertStep: jest.fn(),
    onAddLaneStep: jest.fn(),
    onRemoveStep: jest.fn(),
    getAnalyzeColumns: () => [],
    getAnalyzeSchema: () => [],
    getAnalyzeOutputSchema: () => [],
    getAnalyzeValidationError: () => undefined,
    onStepConfigChange: jest.fn(),
    runStepRowCounts: null,
    onInstantiateShape: jest.fn(async () => {}),
    onReorderSteps: jest.fn(),
    onToggleStepEnabled: jest.fn(),
    onDuplicateStep: jest.fn(),
    duplicatingStepIds: new Set<string>(),
    outputsByStepId: {},
    previewRowCountByOutputId: {},
    onOpenOutput: jest.fn(),
    onAddOutput: jest.fn(),
  };
}

function sectionFor(label: string): HTMLElement {
  const section = screen
    .getByRole("button", { name: label })
    .closest(".pipeline-detail-page__step-section");
  if (section === null) throw new Error(`No step-section ancestor for "${label}"`);
  return section as HTMLElement;
}
const dragHandleFor = (label: string) =>
  sectionFor(label).querySelector(".pipeline-detail-page__step-card-drag-handle") as HTMLElement;
const moveBtn = (label: string, dir: "up" | "down") =>
  within(sectionFor(label)).getByRole("button", { name: new RegExp(`^Move step ${dir}`) });
const ids = (order: Step[]) => order.map((s) => s.id);

describe("PipelineRiverView — reorder in a NON-FIRST root's lane (HEL-1007)", () => {
  it("Move step up in root 2's lane reorders only root 2's trunk, passing the whole pipeline", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...riverProps(TWO_LANE_STEPS)} onReorderSteps={onReorderSteps} />);

    fireEvent.click(moveBtn("Select fields", "up"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const order = onReorderSteps.mock.calls[0][0] as Step[];
    // Root 1's relative order untouched; root 2 becomes Sort -> Select -> Cast.
    const rebuilt = buildLaneGraph(order, ROOTS);
    const lane = (rootId: string) =>
      rebuilt.lanes.find((l) => l.parentStepId === undefined && l.rootId === rootId)!;
    expect(ids(lane("root-1").steps)).toEqual(["a", "b"]);
    expect(ids(lane("root-2").steps)).toEqual(["x", "z", "y"]);
    // Every step keeps its owning root: only the head carries `rootId`.
    expect(order.find((s) => s.id === "x")?.rootId).toBe("root-2");
    expect(order.find((s) => s.id === "a")?.rootId).toBe("root-1");
  });

  it("moving a non-first root's second step into head position carries rootId with it (no orphaned root)", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...riverProps(TWO_LANE_STEPS)} onReorderSteps={onReorderSteps} />);

    fireEvent.click(moveBtn("Cast type", "up"));

    const order = onReorderSteps.mock.calls[0][0] as Step[];
    const rebuilt = buildLaneGraph(order, ROOTS);
    const root2 = rebuilt.lanes.find((l) => l.parentStepId === undefined && l.rootId === "root-2")!;
    expect(ids(root2.steps)).toEqual(["y", "x", "z"]);
    expect(order.find((s) => s.id === "y")?.rootId).toBe("root-2");
    expect(order.find((s) => s.id === "x")?.rootId).toBeUndefined();
  });

  it("Move step down works in root 2's lane and is disabled by position at the lane's ends", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...riverProps(TWO_LANE_STEPS)} onReorderSteps={onReorderSteps} />);

    expect(moveBtn("Sort rows", "up")).toBeDisabled();
    expect(moveBtn("Sort rows", "down")).toBeEnabled();
    expect(moveBtn("Select fields", "down")).toBeDisabled();
    expect(moveBtn("Select fields", "up")).toBeEnabled();

    fireEvent.click(moveBtn("Sort rows", "down"));
    const rebuilt = buildLaneGraph(onReorderSteps.mock.calls[0][0] as Step[], ROOTS);
    const root2 = rebuilt.lanes.find((l) => l.parentStepId === undefined && l.rootId === "root-2")!;
    expect(ids(root2.steps)).toEqual(["y", "x", "z"]);
  });

  it("Move buttons name their lane by the root's source name, for root 0 and root 2 alike", () => {
    render(<PipelineRiverView {...riverProps(TWO_LANE_STEPS)} />);

    expect(screen.getAllByRole("button", { name: "Move step up in Orders" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Move step down in Orders" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Move step up in Shipments" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Move step down in Shipments" })).toHaveLength(3);
  });

  it("drag-reorder works inside root 2's lane (drag the last step above the first)", () => {
    const onReorderSteps = jest.fn();
    render(<PipelineRiverView {...riverProps(TWO_LANE_STEPS)} onReorderSteps={onReorderSteps} />);

    fireEvent.dragStart(dragHandleFor("Select fields"));
    fireEvent.dragOver(sectionFor("Sort rows"));
    fireEvent.drop(sectionFor("Sort rows"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const rebuilt = buildLaneGraph(onReorderSteps.mock.calls[0][0] as Step[], ROOTS);
    const root2 = rebuilt.lanes.find((l) => l.parentStepId === undefined && l.rootId === "root-2")!;
    expect(ids(root2.steps)).toEqual(["z", "x", "y"]);
  });

  it("a drop onto a DIFFERENT root's lane is ignored (no cross-lane / cross-root move)", () => {
    const onReorderSteps = jest.fn();
    const { container } = render(
      <PipelineRiverView {...riverProps(TWO_LANE_STEPS)} onReorderSteps={onReorderSteps} />,
    );

    fireEvent.dragStart(dragHandleFor("Select fields")); // root 2
    const over = fireEvent.dragOver(sectionFor("Filter rows")); // root 1's card
    fireEvent.drop(sectionFor("Filter rows"));

    // `dragOver` was NOT `preventDefault`ed there (the browser shows a no-drop cursor) and no
    // drop indicator was drawn in the other lane.
    expect(over).toBe(true);
    expect(container.querySelector(".pipeline-detail-page__drop-indicator")).toBeNull();
    expect(onReorderSteps).not.toHaveBeenCalled();
  });

  it("a one-step root lane renders a full card whose Move buttons are both disabled by position", () => {
    const steps = [a, b, x];
    render(<PipelineRiverView {...riverProps(steps)} />);

    expect(moveBtn("Sort rows", "up")).toBeDisabled();
    expect(moveBtn("Sort rows", "down")).toBeDisabled();
  });
});

describe("PipelineRiverView — branch lanes expose no reorder controls (HEL-1007)", () => {
  it("a two-step branch lane renders no Move buttons and no drag handle", () => {
    // Orders: a -> b (trunk), plus a branch lane off `a`: t1 -> t2.
    const t1 = step("t1", "rename", { parentStepId: "a", position: 1 });
    const t2 = step("t2", "dedupe", { parentStepId: "t1" });
    render(<PipelineRiverView {...riverProps([a, b, t1, t2, x])} />);

    for (const label of ["Rename column", "Dedupe rows"]) {
      const section = sectionFor(label);
      expect(within(section).queryByRole("button", { name: /^Move step/ })).toBeNull();
      expect(section.querySelector(".pipeline-detail-page__step-card-drag-handle")).toBeNull();
    }
    // The trunk lane's own cards still have them.
    expect(moveBtn("Filter rows", "down")).toBeEnabled();
  });
});

/** Mirrors the page: applies the reorder optimistically, like `handleReorderSteps`. `refuse`
 *  models the CR2 guard / a failed PUT's early return: resolves without changing `steps`. */
function Harness({ refuse = false }: { refuse?: boolean }) {
  const [steps, setSteps] = useState<Step[]>(TWO_LANE_STEPS);
  const laneGraph = useMemo(() => buildLaneGraph(steps, ROOTS), [steps]);
  const onReorderSteps = useCallback(
    async (next: Step[]) => {
      if (!refuse) setSteps(next);
    },
    [refuse],
  );
  const props = riverProps(steps);
  return (
    <>
      <PipelineRiverView {...props} laneGraph={laneGraph} onReorderSteps={onReorderSteps} />
      <button type="button" onClick={() => setSteps((prev) => prev.map((s) => ({ ...s })))}>
        unrelated edit
      </button>
    </>
  );
}

describe("PipelineRiverView — focus follows the moved step (HEL-1007)", () => {
  it("after Move up, focus is on the moved step's own Move up button, in the lane it moved in", async () => {
    render(<Harness />);
    const up = moveBtn("Select fields", "up");
    up.focus();
    await act(async () => {
      fireEvent.click(up);
    });

    expect(document.activeElement).toBe(moveBtn("Select fields", "up"));
    expect(document.activeElement).toHaveAttribute("data-step-id", "z");
  });

  it("when the moved step reaches the lane's start, focus falls to its (enabled) opposite button", async () => {
    render(<Harness />);
    // Cast is second in Shipments; moving it up makes it first, so Move up is now disabled.
    const up = moveBtn("Cast type", "up");
    up.focus();
    await act(async () => {
      fireEvent.click(up);
    });

    expect(moveBtn("Cast type", "up")).toBeDisabled();
    expect(document.activeElement).toBe(moveBtn("Cast type", "down"));
  });

  it("a refused reorder leaves no stale pending focus: a later unrelated change never steals focus", async () => {
    render(<Harness refuse />);
    const up = moveBtn("Select fields", "up");
    up.focus();
    await act(async () => {
      fireEvent.click(up); // refused: steps unchanged, so no commit consumes the pending focus
    });

    // The user moves on and focuses something else, then edits an unrelated step.
    const elsewhere = screen.getByRole("button", { name: "unrelated edit" });
    elsewhere.focus();
    await act(async () => {
      fireEvent.click(elsewhere); // a new `laneGraph` for the lane owner's effect
    });

    expect(document.activeElement).toBe(elsewhere);
  });
});
