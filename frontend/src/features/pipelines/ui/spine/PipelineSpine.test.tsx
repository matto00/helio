// PipelineSpine.test.tsx -- HEL-1582: the spine rendered directly (desktop and phone variants share it). Ported from
// the retired river view's tests: the per-step node path in each row's title (HEL-985), analyze warnings reaching
// every lane and root (HEL-1414), and reorder in every root's trunk lane (HEL-1007). Fixtures carry explicit
// `rootId` / `parentStepId` and `position` at every branch point (`buildLaneGraph` mis-shapes the tree on an implicit
// one).

import { useCallback, useMemo, useState } from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { OP_TYPES } from "../../state/stepNarrowing";
import { buildLaneGraph } from "../../state/stepTree";
import type { AnalyzeWarning, PipelineRoot } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { PipelineSpine } from "./PipelineSpine";
import { useSpineStepActions } from "./useSpineStepActions";

// `StepPalette` (mounted closed by the step actions) renders on the shared Modal, whose dialog methods jsdom lacks;
// its catalog fetch is mocked so mounting never reaches the real httpClient.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
jest.mock("../../services/pipelineService", () => ({
  getPipelineStepCatalog: jest.fn().mockResolvedValue({ groups: [], steps: [] }),
}));

const op = (id: string) => OP_TYPES.find((o) => o.id === id)!;
function step(id: string, opId: string, label: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    opType: op(opId),
    label,
    config: {} as Step["config"],
    enabled: true,
    ...extra,
  };
}
const ids = (order: Step[]) => order.map((s) => s.id);

const ROOTS: PipelineRoot[] = [
  { id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" },
  { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
];

interface HarnessProps {
  initialSteps: Step[];
  roots?: PipelineRoot[];
  variant?: "desktop" | "phone";
  getAnalyzeWarnings?: (stepId: string) => AnalyzeWarning[];
  /** Models the CR2 guard / a failed PUT: the reorder resolves without changing the steps. */
  refuse?: boolean;
  onReorderSteps?: (order: Step[]) => void;
}

/** Mirrors the page: applies a reorder optimistically, like `handleReorderSteps`. */
function Harness({
  initialSteps,
  roots = ROOTS,
  variant = "desktop",
  getAnalyzeWarnings = () => [],
  refuse = false,
  onReorderSteps,
}: HarnessProps) {
  const [steps, setSteps] = useState<Step[]>(initialSteps);
  const laneGraph = useMemo(() => buildLaneGraph(steps, roots), [steps, roots]);
  const reorder = useCallback(
    async (next: Step[]) => {
      onReorderSteps?.(next);
      if (!refuse) setSteps(next);
    },
    [refuse, onReorderSteps],
  );
  const actions = useSpineStepActions({
    laneGraph,
    roots,
    onAddStep: jest.fn(),
    onInsertStep: jest.fn(),
    onAddLaneStep: jest.fn(),
    onAddOutput: jest.fn(),
    onAddRoot: jest.fn(),
    onInstantiateShape: jest.fn(async () => {}),
    onReorderSteps: reorder,
  });
  return (
    <>
      <PipelineSpine
        variant={variant}
        actions={actions}
        steps={steps}
        laneGraph={laneGraph}
        roots={roots}
        sourceByRootId={{}}
        outputs={[]}
        selectedStepId={null}
        stepCount={steps.length}
        rowCountFor={() => null}
        countsPartial={false}
        getAnalyzeValidationError={() => undefined}
        getAnalyzeWarnings={getAnalyzeWarnings}
        stepSaveErrors={{}}
        creatingStepIds={new Set<string>()}
        onSelectStep={jest.fn()}
        onEditSource={jest.fn()}
        onRemoveRoot={jest.fn()}
        onAddOutput={jest.fn()}
        onOpenOutput={jest.fn()}
        onOpenOutputHistory={jest.fn()}
      />
      {actions.dialogs}
      <button type="button" onClick={() => setSteps((prev) => prev.map((s) => ({ ...s })))}>
        unrelated edit
      </button>
    </>
  );
}

const rowOf = (label: string): HTMLElement =>
  screen
    .getByRole("button", { name: new RegExp(`^Step \\d+: ${label}`) })
    .closest("[data-step-row]")!;

// ---- HEL-985: nodePath wiring ---------------------------------------------------------------------------------

describe("PipelineSpine -- the node path is each row's title (HEL-985)", () => {
  const f = (
    id: string,
    label: string,
    parentStepId: string | undefined,
    extra: Partial<Step> = {},
  ) => step(id, "filter", label, { parentStepId, ...extra });
  // Root 1's trunk r1a -> r1b -> r1c; a one-step lane off r1b; a two-step lane off r1c with a lane nested under it;
  // root 2's own head.
  const r1a = f("r1a", "Trunk one", undefined, { rootId: "root-1" });
  const r1b = f("r1b", "Trunk two", "r1a", { position: 0 });
  const r1c = f("r1c", "Trunk three", "r1b", { position: 0 });
  const lane1a = f("lane1a", "Solo lane step", "r1b", { position: 1 });
  const laneA = f("laneA", "Two lane first", "r1c", { position: 1 });
  const laneB = f("laneB", "Two lane second", "laneA", { position: 0 });
  const laneC = f("laneC", "Nested lane step", "laneB", { position: 1 });
  const r2a = f("r2a", "Root two step", undefined, { rootId: "root-2" });
  const STEPS = [r1a, r1b, r1c, lane1a, laneA, laneB, laneC, r2a];

  /** The title of the row's own wrapper (never a bare ancestor `[title]` walk, which a titled lane or column
   *  would hijack); throws distinctly for a missing wrapper and a missing title. */
  function titleFor(label: string): string {
    const wrapper = rowOf(label);
    if (!wrapper.hasAttribute("title")) throw new Error(`Row "${label}" has no title attribute`);
    return wrapper.getAttribute("title") ?? "";
  }

  it.each([
    ["Trunk one", "root:root-1 > r1a"],
    ["Trunk three", "root:root-1 > r1a > r1b > r1c"],
    ["Solo lane step", "root:root-1 > r1a > r1b > lane1a"],
    ["Two lane first", "root:root-1 > r1a > r1b > r1c > laneA"],
    ["Nested lane step", "root:root-1 > r1a > r1b > r1c > laneA > laneB > laneC"],
    ["Root two step", "root:root-2 > r2a"],
  ])("%s carries %s (desktop and phone variants alike)", (label, expected) => {
    for (const variant of ["desktop", "phone"] as const) {
      const { unmount } = renderWithStore(<Harness initialSteps={STEPS} variant={variant} />);
      expect(titleFor(label)).toBe(expected);
      unmount();
    }
  });

  it("renders the expected shape: both roots, three branch lanes, no accidental collapse to one root", () => {
    renderWithStore(<Harness initialSteps={STEPS} />);
    expect(screen.getByText("From Shipments")).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "Lane" })).toHaveLength(3);
  });

  it("a titled ancestor of the row does not hijack the resolved title, and a row without one is reported", () => {
    renderWithStore(<Harness initialSteps={STEPS} />);
    const wrapper = rowOf("Trunk one");
    const ancestor = wrapper.parentElement!;
    ancestor.setAttribute("title", "ancestor title");
    expect(titleFor("Trunk one")).toBe("root:root-1 > r1a");
    wrapper.removeAttribute("title");
    expect(() => titleFor("Trunk one")).toThrow(/no title attribute/);
  });
});

// ---- HEL-1414: warnings reach branch lanes and extra roots ---------------------------------------------------

describe("PipelineSpine -- analyze warnings reach every lane and root (HEL-1414)", () => {
  const warn = (stepId: string): AnalyzeWarning[] => [
    { stepId, code: "join-column-renamed", message: `warning for ${stepId}` },
  ];
  const only = (id: string) => (stepId: string) => (stepId === id ? warn(id) : []);
  const warned = () =>
    screen
      .getAllByRole("button", { name: /^Step \d+:/ })
      .filter((b) => /schema warning/.test(b.getAttribute("aria-label") ?? ""));

  it("a one-step branch lane's row carries its step's warning", () => {
    const trunk = step("a", "filter", "Filter rows", { rootId: "root-1" });
    const cont = step("c", "sort", "Sort rows", { parentStepId: "a", position: 0 });
    const lane = step("b", "limit", "Limit rows", { parentStepId: "a", position: 1 });
    renderWithStore(<Harness initialSteps={[trunk, cont, lane]} getAnalyzeWarnings={only("b")} />);
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toHaveAccessibleName(/^Step 1: Limit rows.*1 schema warning$/);
    expect(rowOf("Limit rows").closest(".spine-lane--sub")).not.toBeNull();
  });

  it("a multi-step branch lane's second row carries its step's warning", () => {
    const trunk = step("a", "filter", "Filter rows", { rootId: "root-1" });
    const cont = step("c", "sort", "Sort rows", { parentStepId: "a", position: 0 });
    const head = step("b", "limit", "Limit rows", { parentStepId: "a", position: 1 });
    const second = step("d", "cast", "Cast type", { parentStepId: "b", position: 2 });
    renderWithStore(
      <Harness initialSteps={[trunk, cont, head, second]} getAnalyzeWarnings={only("d")} />,
    );
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toHaveAccessibleName(/^Step \d+: Cast type.*1 schema warning$/);
  });

  it("a non-first root's row carries its step's warning", () => {
    const trunk = step("a", "filter", "Filter rows", { rootId: "root-1" });
    const second = step("r2", "sort", "Sort rows", { rootId: "root-2" });
    renderWithStore(<Harness initialSteps={[trunk, second]} getAnalyzeWarnings={only("r2")} />);
    expect(warned()).toHaveLength(1);
    expect(warned()[0]).toHaveAccessibleName(/^Step 1: Sort rows/);
  });

  it("GUARD: with no warnings supplied no row carries one", () => {
    const trunk = step("a", "filter", "Filter rows", { rootId: "root-1" });
    renderWithStore(<Harness initialSteps={[trunk]} />);
    expect(warned()).toHaveLength(0);
  });
});

// ---- HEL-1007: reorder in every root's trunk lane ------------------------------------------------------------

describe("PipelineSpine -- reorder in every root's trunk lane (HEL-1007)", () => {
  // Root 1 (Orders): Filter -> Limit.   Root 2 (Shipments): Sort -> Cast -> Select.
  const a = step("a", "filter", "Filter rows", { rootId: "root-1" });
  const b = step("b", "limit", "Limit rows", { parentStepId: "a", position: 0 });
  const x = step("x", "sort", "Sort rows", { rootId: "root-2" });
  const y = step("y", "cast", "Cast type", { parentStepId: "x" });
  const z = step("z", "select", "Select fields", { parentStepId: "y" });
  const TWO_LANES = [a, b, x, y, z];

  function openMenu(label: string) {
    fireEvent.click(
      within(rowOf(label)).getByRole("button", { name: new RegExp(`^Step actions for ${label}`) }),
    );
  }
  const item = (name: string | RegExp) => screen.getByRole("menuitem", { name });
  const trunkOf = (order: Step[], rootId: string) =>
    buildLaneGraph(order, ROOTS).lanes.find(
      (l) => l.parentStepId === undefined && l.rootId === rootId,
    )!;

  it("Move up in root 2's lane reorders only root 2's trunk, passing the whole pipeline", () => {
    const onReorderSteps = jest.fn();
    renderWithStore(<Harness initialSteps={TWO_LANES} onReorderSteps={onReorderSteps} />);
    openMenu("Select fields");
    fireEvent.click(item("Move step up in Shipments"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    const order = onReorderSteps.mock.calls[0][0] as Step[];
    expect(ids(trunkOf(order, "root-1").steps)).toEqual(["a", "b"]);
    expect(ids(trunkOf(order, "root-2").steps)).toEqual(["x", "z", "y"]);
    // Every step keeps its owning root: only the head carries `rootId`.
    expect(order.find((s) => s.id === "x")?.rootId).toBe("root-2");
    expect(order.find((s) => s.id === "a")?.rootId).toBe("root-1");
  });

  it("moving a non-first root's second step into head position carries rootId with it (no orphaned root)", () => {
    const onReorderSteps = jest.fn();
    renderWithStore(<Harness initialSteps={TWO_LANES} onReorderSteps={onReorderSteps} />);
    openMenu("Cast type");
    fireEvent.click(item("Move step up in Shipments"));

    const order = onReorderSteps.mock.calls[0][0] as Step[];
    expect(ids(trunkOf(order, "root-2").steps)).toEqual(["y", "x", "z"]);
    expect(order.find((s) => s.id === "y")?.rootId).toBe("root-2");
    expect(order.find((s) => s.id === "x")?.rootId).toBeUndefined();
  });

  it("Move down works in root 2's lane and is disabled by position at the lane's ends", () => {
    const onReorderSteps = jest.fn();
    renderWithStore(<Harness initialSteps={TWO_LANES} onReorderSteps={onReorderSteps} />);

    openMenu("Sort rows");
    expect(item("Move step up in Shipments")).toBeDisabled();
    expect(item("Move step down in Shipments")).toBeEnabled();
    fireEvent.click(item("Move step down in Shipments"));
    expect(ids(trunkOf(onReorderSteps.mock.calls[0][0] as Step[], "root-2").steps)).toEqual([
      "y",
      "x",
      "z",
    ]);

    openMenu("Select fields");
    expect(item("Move step down in Shipments")).toBeDisabled();
    expect(item("Move step up in Shipments")).toBeEnabled();
  });

  it("the Move items name their lane by the root's source name, for root 0 and root 2 alike", () => {
    renderWithStore(<Harness initialSteps={TWO_LANES} />);
    openMenu("Filter rows");
    expect(item("Move step up in Orders")).toBeInTheDocument();
    expect(item("Move step down in Orders")).toBeInTheDocument();
    fireEvent.keyDown(item("Move step up in Orders"), { key: "Escape" });
    openMenu("Cast type");
    expect(item("Move step up in Shipments")).toBeInTheDocument();
  });

  it("drag-reorder works inside root 2's lane (drag the last step above the first)", () => {
    const onReorderSteps = jest.fn();
    renderWithStore(<Harness initialSteps={TWO_LANES} onReorderSteps={onReorderSteps} />);

    fireEvent.dragStart(rowOf("Select fields").querySelector(".spine-row__grip")!);
    fireEvent.dragOver(rowOf("Sort rows"));
    fireEvent.drop(rowOf("Sort rows"));

    expect(onReorderSteps).toHaveBeenCalledTimes(1);
    expect(ids(trunkOf(onReorderSteps.mock.calls[0][0] as Step[], "root-2").steps)).toEqual([
      "z",
      "x",
      "y",
    ]);
  });

  it("a drop onto a DIFFERENT root's lane is ignored (no cross-lane / cross-root move)", () => {
    const onReorderSteps = jest.fn();
    const { container } = renderWithStore(
      <Harness initialSteps={TWO_LANES} onReorderSteps={onReorderSteps} />,
    );

    fireEvent.dragStart(rowOf("Select fields").querySelector(".spine-row__grip")!); // root 2
    const over = fireEvent.dragOver(rowOf("Filter rows")); // root 1's row
    fireEvent.drop(rowOf("Filter rows"));

    // `dragOver` was NOT `preventDefault`ed there (the browser shows a no-drop cursor) and no drop indicator
    // was drawn in the other lane.
    expect(over).toBe(true);
    expect(container.querySelector(".spine-lane__drop-indicator")).toBeNull();
    expect(onReorderSteps).not.toHaveBeenCalled();
  });

  it("a one-step root lane's row has both Move items disabled by position", () => {
    renderWithStore(<Harness initialSteps={[a, b, x]} />);
    openMenu("Sort rows");
    expect(item("Move step up in Shipments")).toBeDisabled();
    expect(item("Move step down in Shipments")).toBeDisabled();
  });

  it("a branch lane's rows have no Move items and no drag grip", () => {
    // Orders: a -> b (trunk), plus a branch lane off `a`: t1 -> t2.
    const t1 = step("t1", "rename", "Rename column", { parentStepId: "a", position: 1 });
    const t2 = step("t2", "dedupe", "Dedupe rows", { parentStepId: "t1" });
    renderWithStore(<Harness initialSteps={[a, b, t1, t2, x]} />);
    for (const label of ["Rename column", "Dedupe rows"]) {
      expect(rowOf(label).querySelector(".spine-row__grip")).toBeNull();
      openMenu(label);
      expect(screen.queryByRole("menuitem", { name: /^Move step/ })).toBeNull();
      fireEvent.keyDown(screen.getByRole("menuitem", { name: "Branch from here" }), {
        key: "Escape",
      });
    }
    openMenu("Filter rows");
    expect(item("Move step down in Orders")).toBeEnabled();
  });

  it("the phone variant has no drag grip and no per-row menu at all (Move lives in the step sheet)", () => {
    renderWithStore(<Harness initialSteps={TWO_LANES} variant="phone" />);
    expect(document.querySelector(".spine-row__grip")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Step actions for/ })).toBeNull();
  });

  describe("focus follows the moved step", () => {
    it("after Move up, focus is on the moved step's own row, in the lane it moved in", async () => {
      renderWithStore(<Harness initialSteps={TWO_LANES} />);
      openMenu("Select fields");
      await act(async () => {
        fireEvent.click(item("Move step up in Shipments"));
      });
      expect(document.activeElement).toBe(
        within(rowOf("Select fields")).getByRole("button", { name: /^Step 2: Select fields/ }),
      );
    });

    it("a refused reorder leaves no stale pending focus: a later unrelated change never steals focus", async () => {
      renderWithStore(<Harness initialSteps={TWO_LANES} refuse />);
      openMenu("Select fields");
      await act(async () => {
        fireEvent.click(item("Move step up in Shipments")); // refused: no commit consumes the pending focus
      });

      const elsewhere = screen.getByRole("button", { name: "unrelated edit" });
      elsewhere.focus();
      await act(async () => {
        fireEvent.click(elsewhere); // a new `laneGraph` for the focus effect
      });
      expect(document.activeElement).toBe(elsewhere);
    });
  });
});
