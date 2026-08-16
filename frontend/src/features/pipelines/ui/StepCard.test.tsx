// StepCard.test.tsx — HEL-404 inline per-step output preview (rows + schema).
//
// Renders StepCard directly (not through PipelineDetailPage) so these tests
// isolate the preview-tray behavior: activation fetch, debounced
// refresh-on-edit, the output-schema chip strip, and the persistent
// previewOpen preference. Config-editor interactions are out of scope here
// (covered by the per-op *Config.test.tsx files); config "changes" are
// simulated by re-rendering with a new `step` prop, matching design.md's
// "step.config only changes after a successful PATCH" contract.

import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { faLink } from "@fortawesome/free-solid-svg-icons";

import { StepCard } from "./StepCard";
import { OP_TYPES } from "../state/stepNarrowing";
import { fetchStepPreview, updatePipelineStep } from "../services/pipelineService";
import type { OpType, Step } from "../types/step";
import type { SchemaField } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const fetchStepPreviewMock = jest.mocked(fetchStepPreview);
const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const LIMIT_OP_TYPE = OP_TYPES.find((op) => op.id === "limit")!;
const SELECT_OP_TYPE = OP_TYPES.find((op) => op.id === "select")!;
const RENAME_OP_TYPE = OP_TYPES.find((op) => op.id === "rename")!;
// Mirrors stepNarrowing.ts's internal (unexported) JOIN_OP_TYPE — join has no
// dedicated editor, so it exercises StepCard's no-editor fallback branch.
const JOIN_OP_TYPE: OpType = { id: "join", label: "Join tables", icon: faLink };

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "step-1",
    opType: LIMIT_OP_TYPE,
    label: "Limit rows",
    config: { count: 5 },
    enabled: true,
    ...overrides,
  };
}

const outputSchema: SchemaField[] = [
  { name: "id", type: "number" },
  { name: "name", type: "string" },
];

function baseProps(overrides: Partial<ComponentProps<typeof StepCard>> = {}) {
  return {
    step: makeStep(),
    stepIndex: 0,
    pipelineId: "pipe-1",
    onRemove: jest.fn(),
    analyzeColumns: [],
    analyzeSchema: [],
    analyzeOutputSchema: outputSchema,
    onConfigChange: jest.fn(),
    rowCount: null,
    onStepDragStart: jest.fn(),
    onStepDragEnd: jest.fn(),
    onToggleEnabled: jest.fn(),
    onDuplicate: jest.fn(),
    enabledBits: "1",
    ...overrides,
  };
}

/** Clicks a button by accessible name, wrapped in `act` so any state update
 *  a resolved (or already-settled) promise makes is flushed before the next
 *  assertion. Safe for never-resolving mocks too — `act` only drains
 *  already-queued microtasks, it does not block on unrelated pending
 *  promises. A RegExp matcher is needed for the toggle button once a step
 *  has a `validationError`: the HEL-409 header chip's `aria-label` bleeds
 *  into the button's own accessible-name computation (nested `role="img"`
 *  content, not `aria-hidden`), so its name is no longer the label alone. */
async function click(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  updatePipelineStepMock.mockResolvedValue({
    id: "step-1",
    pipelineId: "pipe-1",
    position: 0,
    type: "limit",
    config: { count: 5 },
    createdAt: "",
    updatedAt: "",
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("StepCard preview — rows + schema (3.1)", () => {
  it("renders sample rows and the output schema together when the preview is activated", async () => {
    fetchStepPreviewMock.mockResolvedValue({
      rows: [{ id: 1, name: "alice" }],
      rowCount: 1,
    });

    const { container } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledWith("pipe-1", "step-1");
    expect(screen.getByText("alice")).toBeInTheDocument();

    const chips = container.querySelectorAll(".pipeline-detail-page__step-preview-schema-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("id: number");
    expect(chips[1]).toHaveTextContent("name: string");
  });

  it("omits the schema strip (rows still render) when analyzeOutputSchema is empty", async () => {
    fetchStepPreviewMock.mockResolvedValue({
      rows: [{ id: 1, name: "alice" }],
      rowCount: 1,
    });

    const { container } = render(<StepCard {...baseProps({ analyzeOutputSchema: [] })} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(
      container.querySelector(".pipeline-detail-page__step-preview-schema"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading indicator while the preview request is in flight", async () => {
    fetchStepPreviewMock.mockReturnValue(new Promise<never>(() => {}));

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  });

  it("shows an inline error message when the preview request fails", async () => {
    fetchStepPreviewMock.mockRejectedValue(new Error("Network error"));

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
  });

  it("second toggle hides the preview", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1, name: "alice" }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");
    expect(screen.getByText("alice")).toBeInTheDocument();

    await click("Hide preview");

    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });
});

describe("StepCard preview — refresh on edit (3.2)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("re-fetches exactly once, debounced, when the config changes while the preview is open", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const { rerender } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Simulate a config PATCH settling: the parent re-renders StepCard with
    // the new persisted config (design.md Decision 2 — StepCard does not
    // drive the PATCH itself here).
    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });

    // Not yet — still inside the debounce window.
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);

    // A further re-render with the *same* config should not trigger another fetch.
    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch on config change while the preview is closed", async () => {
    const { rerender } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).not.toHaveBeenCalled();
  });
});

// HEL-407 (design.md Decision 9) — a reorder changes a step's list index but
// not its `config`, so the preview-refresh fingerprint folds in `stepIndex`
// too. Task 3.4.
describe("StepCard preview — refresh on reorder (HEL-407)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("re-fetches exactly once, debounced, when stepIndex changes while the preview is open (config unchanged)", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const { rerender } = render(<StepCard {...baseProps({ stepIndex: 0 })} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Same step, same config — only its position in the list moved.
    await act(async () => {
      rerender(<StepCard {...baseProps({ stepIndex: 2 })} />);
    });

    // Not yet — still inside the debounce window.
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);

    // A further re-render at the *same* index should not trigger another fetch.
    await act(async () => {
      rerender(<StepCard {...baseProps({ stepIndex: 2 })} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when stepIndex changes while the preview is closed", async () => {
    const { rerender } = render(<StepCard {...baseProps({ stepIndex: 0 })} />);
    await click("Limit rows");

    await act(async () => {
      rerender(<StepCard {...baseProps({ stepIndex: 2 })} />);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).not.toHaveBeenCalled();
  });
});

// HEL-412 (design.md Decision 8) — `enabledBits` is the join of every step's
// enabled flag, passed identically to every card; toggling ANY step changes
// it for ALL cards, so an open preview refreshes even when this card's own
// config and stepIndex are untouched.
describe("StepCard preview — refresh on enabledBits change (HEL-412)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("re-fetches exactly once, debounced, when enabledBits changes (config/stepIndex unchanged)", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const { rerender } = render(<StepCard {...baseProps({ enabledBits: "10" })} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Some OTHER step in the list toggled — this card's own config/index
    // didn't change, only the shared enabledBits string.
    await act(async () => {
      rerender(<StepCard {...baseProps({ enabledBits: "11" })} />);
    });

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);
  });
});

// HEL-412 evaluation-1.md CR1/CR2 — a disabled→enabled transition must never
// take the immediate/undebounced "activation" fetch path: it races the same
// click's own enable PATCH in `PipelineDetailPage.handleToggleStepEnabled`
// (see the fuller integration-level repro in `PipelineDetailPage.test.tsx`'s
// "PipelineDetailPage step preview" describe block). These tests pin the
// exact effect-level invariant at the point of the fix.
describe("StepCard preview — re-enable does not race the enable PATCH (HEL-412 evaluation-1.md CR1)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("re-enabling (single-step pipeline: config/enabledBits round-trip to the same fingerprint) still debounces, never fetches immediately", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    // A single-step pipeline: enabledBits is "1" both before disabling and
    // after re-enabling — the composed fingerprint round-trips to the exact
    // same string, which is the trap a naive "does the fingerprint match
    // what I last fetched?" short-circuit would fall into.
    const { rerender } = render(<StepCard {...baseProps({ enabledBits: "1" })} />);
    await click("Limit rows");
    await click("Preview data");
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Optimistic disable (mirrors PipelineDetailPage.handleToggleStepEnabled's
    // synchronous flip, before its PATCH resolves).
    await act(async () => {
      rerender(
        <StepCard {...baseProps({ step: makeStep({ enabled: false }), enabledBits: "0" })} />,
      );
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Optimistic re-enable — the exact same click-driven flip the race
    // condition depends on. Must NOT fetch before the debounce elapses.
    await act(async () => {
      rerender(<StepCard {...baseProps({ enabledBits: "1" })} />);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(499);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);
  });

  it("a step disabled+previewOpen from mount (never fetched while disabled) still debounces on re-enable, never fetches immediately", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
    window.localStorage.setItem("helio-step-preview-open", "true");

    // Mounts already disabled — the preview tray is logically "open"
    // (persisted preference) but rendered nothing (gated on step.enabled),
    // so no fetch has ever been dispatched: `lastFetchedFingerprint` is
    // still its initial `null`.
    const { rerender } = render(
      <StepCard {...baseProps({ step: makeStep({ enabled: false }), enabledBits: "0" })} />,
    );
    await click("Limit rows");
    expect(fetchStepPreviewMock).not.toHaveBeenCalled();

    // Enable — must debounce, not fetch immediately, even though this is
    // technically the card's first-ever activation (fingerprint ref is null).
    await act(async () => {
      rerender(<StepCard {...baseProps({ enabledBits: "1" })} />);
    });
    expect(fetchStepPreviewMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("StepCard preview — persistent open preference (3.3)", () => {
  it("auto-opens the preview on expand when the stored preference is true", async () => {
    window.localStorage.setItem("helio-step-preview-open", "true");
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();
    expect(fetchStepPreviewMock).toHaveBeenCalledWith("pipe-1", "step-1");
  });

  it("writes false to storage when the user hides an open preview", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();

    await click("Hide preview");

    expect(window.localStorage.getItem("helio-step-preview-open")).toBe("false");
  });

  it("defaults closed when no value is stored", async () => {
    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Preview data" })).toBeInTheDocument();
  });

  it("defaults closed when the stored value is invalid", async () => {
    window.localStorage.setItem("helio-step-preview-open", "yes-please");

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Preview data" })).toBeInTheDocument();
  });
});

describe("StepCard preview — cross-card same-session preference (3.4)", () => {
  it("re-syncs from localStorage on expand, not just at mount", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    // Both cards mount unconditionally (as in PipelineRiverView.steps.map),
    // before either is expanded — so both read the not-yet-set preference
    // (false) in their mount-time lazy initializer.
    render(
      <>
        <StepCard {...baseProps({ step: makeStep({ id: "step-1", label: "Card one" }) })} />
        <StepCard {...baseProps({ step: makeStep({ id: "step-2", label: "Card two" }) })} />
      </>,
    );

    await click("Card one");
    await click("Preview data");
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();

    // Card two expands *after* card one's toggle wrote the preference —
    // a mount-time-only read would still show "Preview data" here.
    await click("Card two");

    expect(screen.getAllByRole("button", { name: "Hide preview" })).toHaveLength(2);
  });
});

describe("StepCard — real schema diff chips (HEL-405)", () => {
  it("renders all four diff kinds for a step with analyze data", async () => {
    // input: a (retyped), b (renamed → b2), e (dropped)
    // output: a (retyped), b2 (renamed), d (added)
    const step = makeStep({
      opType: RENAME_OP_TYPE,
      label: "Rename column",
      config: { renames: { b: "b2" } },
    });
    const analyzeSchema: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "string" },
      { name: "e", type: "string" },
    ];
    const analyzeOutputSchema: SchemaField[] = [
      { name: "a", type: "number" },
      { name: "b2", type: "string" },
      { name: "d", type: "string" },
    ];

    const { container } = render(
      <StepCard {...baseProps({ step, analyzeSchema, analyzeOutputSchema })} />,
    );
    await click("Rename column");

    const addedChip = container.querySelector(".pipeline-detail-page__step-card-diff-chip--added");
    const droppedChip = container.querySelector(
      ".pipeline-detail-page__step-card-diff-chip--removed",
    );
    const retypedChip = container.querySelector(
      ".pipeline-detail-page__step-card-diff-chip--changed",
    );
    const renamedChip = container.querySelector(
      ".pipeline-detail-page__step-card-diff-chip--renamed",
    );

    expect(addedChip).toHaveTextContent("+ d");
    expect(droppedChip).toHaveTextContent("− e");
    expect(retypedChip).toHaveTextContent("~ a: string→number");
    expect(renamedChip).toHaveTextContent("b → b2");
  });

  it("renders diff chips for an op with a dedicated editor (select)", async () => {
    const step = makeStep({
      opType: SELECT_OP_TYPE,
      label: "Select fields",
      config: { fields: [] },
    });
    const analyzeSchema: SchemaField[] = [{ name: "x", type: "string" }];
    const analyzeOutputSchema: SchemaField[] = [{ name: "y", type: "string" }];

    const { container } = render(
      <StepCard
        {...baseProps({ step, analyzeColumns: ["x"], analyzeSchema, analyzeOutputSchema })}
      />,
    );
    await click("Select fields");

    // The diff strip is present alongside the select-fields editor — proves
    // it renders above the op-editor branch for ops with a dedicated editor,
    // not only the no-editor fallback.
    expect(
      container.querySelector(".pipeline-detail-page__step-card-diff-chip--added"),
    ).toHaveTextContent("+ y");
    expect(
      container.querySelector(".pipeline-detail-page__step-card-diff-chip--removed"),
    ).toHaveTextContent("− x");
    expect(screen.getByRole("checkbox", { name: "x" })).toBeInTheDocument();
  });

  it("renders no diff chips (and no empty container) when the schemas are identical", async () => {
    const schema: SchemaField[] = [{ name: "a", type: "string" }];
    const step = makeStep({ opType: JOIN_OP_TYPE, label: "Join tables" });

    const { container } = render(
      <StepCard {...baseProps({ step, analyzeSchema: schema, analyzeOutputSchema: schema })} />,
    );
    await click("Join tables");

    expect(
      container.querySelector(".pipeline-detail-page__step-card-diff"),
    ).not.toBeInTheDocument();
    // Fallback branch's desc text still renders — only the placeholder chips were removed.
    expect(screen.getByText("Configure this join tables step.")).toBeInTheDocument();
  });

  it("renders no diff chips when analyze data is unavailable for the step", async () => {
    const step = makeStep({ opType: JOIN_OP_TYPE, label: "Join tables" });

    const { container } = render(
      <StepCard {...baseProps({ step, analyzeSchema: [], analyzeOutputSchema: [] })} />,
    );
    await click("Join tables");

    expect(
      container.querySelector(".pipeline-detail-page__step-card-diff"),
    ).not.toBeInTheDocument();
  });

  it("never renders the hardcoded col_a/col_b/col_c placeholder", async () => {
    const step = makeStep({ opType: JOIN_OP_TYPE, label: "Join tables" });
    const analyzeSchema: SchemaField[] = [{ name: "col_a", type: "string" }];
    const analyzeOutputSchema: SchemaField[] = [{ name: "col_x", type: "string" }];

    render(<StepCard {...baseProps({ step, analyzeSchema, analyzeOutputSchema })} />);
    await click("Join tables");

    expect(screen.queryByText("+ col_a")).not.toBeInTheDocument();
    expect(screen.queryByText(/col_b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/col_c/)).not.toBeInTheDocument();
  });
});

// HEL-407 (design.md Decision 4) — the header is now a wrapper `<div>` with
// the expand-toggle `<button>` and a sibling drag-handle/Move-buttons
// actions cluster. These guard the regression the restructure exists to
// avoid: new controls nested inside the toggle would bubble clicks into it.
describe("StepCard header restructure — sibling controls (HEL-407)", () => {
  it("clicking Move step up does not toggle expand/collapse", async () => {
    const onMoveUp = jest.fn();
    render(<StepCard {...baseProps({ onMoveUp })} />);

    await click("Limit rows");
    expect(screen.getByRole("button", { name: "Limit rows", expanded: true })).toBeInTheDocument();

    await click("Move step up");

    expect(onMoveUp).toHaveBeenCalledTimes(1);
    // Still expanded — the Move click neither toggled collapse nor bubbled
    // into the toggle button.
    expect(screen.getByRole("button", { name: "Limit rows", expanded: true })).toBeInTheDocument();
  });

  it("clicking Move step down does not toggle expand/collapse", async () => {
    const onMoveDown = jest.fn();
    render(<StepCard {...baseProps({ onMoveDown })} />);

    // Starts collapsed — clicking Move down must not expand it.
    await click("Move step down");

    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Limit rows", expanded: false })).toBeInTheDocument();
  });

  it("Move buttons are disabled when their handler prop is undefined (first/last position)", () => {
    render(<StepCard {...baseProps({ onMoveUp: undefined, onMoveDown: undefined })} />);

    expect(screen.getByRole("button", { name: "Move step up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step down" })).toBeDisabled();
  });

  it("the expand toggle is still a native <button> with aria-expanded after the restructure", async () => {
    render(<StepCard {...baseProps()} />);

    // Native <button> semantics (not a div-based pseudo-button) is exactly
    // what preserves keyboard (Enter/Space) activation for free — the
    // property design.md Decision 4 requires the restructure to keep.
    const toggle = screen.getByRole("button", { name: "Limit rows", expanded: false });
    expect(toggle.tagName).toBe("BUTTON");

    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Limit rows", expanded: true })).toBeInTheDocument();
  });

  it("the drag handle and Move buttons are siblings of the toggle, not nested inside it", async () => {
    const { container } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    const toggle = screen.getByRole("button", { name: "Limit rows", expanded: true });
    // design.md Decision 5 — the drag handle is `aria-hidden` (mouse/touch-
    // only; the Move buttons are the keyboard path), so it's queried by
    // class, not accessible role.
    const dragHandle = container.querySelector(".pipeline-detail-page__step-card-drag-handle");
    const header = container.querySelector(".pipeline-detail-page__step-card-header");

    expect(dragHandle).not.toBeNull();
    expect(toggle.contains(dragHandle)).toBe(false);
    expect(header?.contains(toggle)).toBe(true);
    expect(header?.contains(dragHandle as Node)).toBe(true);
  });

  it("the drag handle is excluded from the accessibility tree (aria-hidden) — the Move buttons are the keyboard path", async () => {
    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.queryByRole("button", { name: /Drag to reorder/i })).not.toBeInTheDocument();
  });

  it("the drag handle fires onStepDragStart(stepIndex) / onStepDragEnd() from its own drag events", () => {
    const onStepDragStart = jest.fn();
    const onStepDragEnd = jest.fn();
    const { container } = render(
      <StepCard {...baseProps({ stepIndex: 2, onStepDragStart, onStepDragEnd })} />,
    );

    const dragHandle = container.querySelector(".pipeline-detail-page__step-card-drag-handle");
    expect(dragHandle).not.toBeNull();
    fireEvent.dragStart(dragHandle as Element);
    expect(onStepDragStart).toHaveBeenCalledWith(2);

    fireEvent.dragEnd(dragHandle as Element);
    expect(onStepDragEnd).toHaveBeenCalledTimes(1);
  });
});

// skeptic-final-1.md CR1 — a reorder-invalidated step must surface its
// validationError regardless of op type (AC2's "surfacing" half). Before
// this fix, `validationError` was only ever rendered by `ComputeFieldConfig`
// — every other op silently dropped it.
describe("StepCard validationError surfacing (skeptic-final-1.md CR1)", () => {
  it("a non-compute step with a validationError shows the error text in the expanded card", async () => {
    render(<StepCard {...baseProps({ validationError: "Unknown field(s): 'full_name'" })} />);

    await click(/Limit rows/);

    expect(screen.getByText("Unknown field(s): 'full_name'")).toBeInTheDocument();
  });

  it("renders nothing extra when validationError is absent", async () => {
    const { container } = render(<StepCard {...baseProps()} />);

    await click("Limit rows");

    expect(container.querySelector(".inline-error")).not.toBeInTheDocument();
  });

  it("a compute step renders the error once, not twice, via its own contextual placement", async () => {
    const computeStep: Step = {
      id: "step-1",
      opType: { id: "compute", label: "Compute column", icon: LIMIT_OP_TYPE.icon },
      label: "Compute column",
      config: { column: "revenue_per_user", expression: "$revenue / $users", type: "number" },
      enabled: true,
    };

    render(
      <StepCard
        {...baseProps({
          step: computeStep,
          validationError: "Unknown field(s): 'revenue'",
        })}
      />,
    );

    await click(/Compute column/);

    expect(screen.getAllByText("Unknown field(s): 'revenue'")).toHaveLength(1);
  });
});

// HEL-409 — the collapsed-card list marking (AC2): a card with a
// validationError must be visually distinguishable without expanding it.
describe("StepCard — errored card marking (HEL-409)", () => {
  it("a collapsed errored step shows the --errored class and an accessible header indicator", () => {
    const { container } = render(
      <StepCard {...baseProps({ validationError: "Unknown field(s): 'full_name'" })} />,
    );

    expect(
      container.querySelector(".pipeline-detail-page__step-card--errored"),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step has a validation error" })).toBeInTheDocument();
  });

  it("a collapsed valid step shows neither the --errored class nor the header indicator", () => {
    const { container } = render(<StepCard {...baseProps()} />);

    expect(
      container.querySelector(".pipeline-detail-page__step-card--errored"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
  });

  it("clears the accent, indicator, and inline message together when the analyze refresh removes the error", async () => {
    const { container, rerender } = render(
      <StepCard {...baseProps({ validationError: "Unknown field(s): 'full_name'" })} />,
    );
    await click(/Limit rows/);

    expect(
      container.querySelector(".pipeline-detail-page__step-card--errored"),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step has a validation error" })).toBeInTheDocument();
    expect(screen.getByText("Unknown field(s): 'full_name'")).toBeInTheDocument();

    await act(async () => {
      rerender(<StepCard {...baseProps({ validationError: undefined })} />);
    });

    expect(
      container.querySelector(".pipeline-detail-page__step-card--errored"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown field(s): 'full_name'")).not.toBeInTheDocument();
  });
});

// HEL-412 — disable/enable toggle + duplicate action, both siblings of the
// drag/Move controls in the header actions cluster (design.md Decision 6).
// Persistence itself is page-owned (PipelineDetailPage.test.tsx); these
// tests cover what StepCard renders and delegates.
describe("StepCard disable/enable + duplicate (HEL-412)", () => {
  it("an enabled step shows a 'Disable step' button that calls onToggleEnabled(id, false)", () => {
    const onToggleEnabled = jest.fn();
    render(<StepCard {...baseProps({ onToggleEnabled })} />);

    fireEvent.click(screen.getByRole("button", { name: "Disable step" }));

    expect(onToggleEnabled).toHaveBeenCalledWith("step-1", false);
  });

  it("a disabled step shows an 'Enable step' button that calls onToggleEnabled(id, true)", () => {
    const onToggleEnabled = jest.fn();
    render(<StepCard {...baseProps({ step: makeStep({ enabled: false }), onToggleEnabled })} />);

    fireEvent.click(screen.getByRole("button", { name: "Enable step" }));

    expect(onToggleEnabled).toHaveBeenCalledWith("step-1", true);
  });

  it("Duplicate step calls onDuplicate(id)", () => {
    const onDuplicate = jest.fn();
    render(<StepCard {...baseProps({ onDuplicate })} />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate step" }));

    expect(onDuplicate).toHaveBeenCalledWith("step-1");
  });

  it("a disabled step renders the --disabled card modifier and hides the preview control", async () => {
    const { container } = render(
      <StepCard {...baseProps({ step: makeStep({ enabled: false }) })} />,
    );

    expect(
      container.querySelector(".pipeline-detail-page__step-card--disabled"),
    ).toBeInTheDocument();

    await click("Limit rows");
    expect(screen.queryByRole("button", { name: "Preview data" })).not.toBeInTheDocument();
  });

  it("an enabled step does not render the --disabled card modifier and shows the preview control", async () => {
    const { container } = render(<StepCard {...baseProps()} />);

    expect(
      container.querySelector(".pipeline-detail-page__step-card--disabled"),
    ).not.toBeInTheDocument();

    await click("Limit rows");
    expect(screen.getByRole("button", { name: "Preview data" })).toBeInTheDocument();
  });

  it("the config editor stays visible and editable for a disabled step (disabling is about execution, not locking)", async () => {
    render(<StepCard {...baseProps({ step: makeStep({ enabled: false }) })} />);

    await click("Limit rows");

    // LimitConfig's numeric input is still present and enabled.
    expect(screen.getByRole("spinbutton")).toBeEnabled();
  });

  it("a disabled step shows no error chip when it has no validationError (no analyze entry)", () => {
    render(
      <StepCard
        {...baseProps({ step: makeStep({ enabled: false }), validationError: undefined })}
      />,
    );

    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
  });
});
