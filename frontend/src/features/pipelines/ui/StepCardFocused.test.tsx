// StepCardFocused.test.tsx -- HEL-1582: the focused step editor (desktop spine centre column and the phone's step
// sheet) rendered directly. Ported from the retired river card's StepCard.test.tsx: the behaviour that is the
// editor's own (dispatch to the right config editor, error and warning surfacing, the disable / duplicate / remove
// actions) -- the card's expand toggle, preview tray, Move buttons and drag handle no longer exist.

import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";

import { StepCardFocused } from "./StepCardFocused";
import { renderWithStore } from "../../../test/renderWithStore";
import { OP_TYPES, unsupportedOpType } from "../state/stepNarrowing";
import type { AnalyzeWarning } from "../types/pipelineStep";
import type { Step } from "../types/step";

// HEL-1600 -- stands in for GET /api/data-sources, which the upsertsource editor reaches but this test does not
// exercise (the network guard fails an unmocked request).
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() =>
    Promise.reject(new Error("fetchSources: unmocked request stubbed (HEL-1600)")),
  ),
}));
jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const LIMIT = OP_TYPES.find((op) => op.id === "limit")!;

// "persisted-step-1" (not "step-N"): exactly the `step-<counter>` shape is a not-yet-saved draft.
function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "persisted-step-1",
    opType: LIMIT,
    label: "Limit rows",
    config: { count: 5 },
    enabled: true,
    ...overrides,
  };
}

function props(overrides: Partial<ComponentProps<typeof StepCardFocused>> = {}) {
  return {
    step: makeStep(),
    stepNumber: 1,
    onRemove: jest.fn(),
    analyzeColumns: [],
    analyzeSchema: [],
    onConfigChange: jest.fn(),
    onToggleEnabled: jest.fn(),
    onDuplicate: jest.fn(),
    isDuplicating: false,
    ...overrides,
  };
}

const w = (message: string): AnalyzeWarning => ({
  stepId: "persisted-step-1",
  code: "field-not-in-input-schema",
  message,
});

afterEach(() => jest.clearAllMocks());

describe("StepCardFocused -- editor dispatch", () => {
  it("names the step by its number and label and is always expanded", () => {
    renderWithStore(<StepCardFocused {...props()} />);
    expect(screen.getByRole("region", { name: "Step 1 Limit rows" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  // HEL-1100 (design.md Decision 9): a persisted step whose kind this build does not recognize renders a read-only
  // notice, never a config editor and never a PATCH-triggering handler.
  it("an unsupported step type renders a read-only notice instead of any config editor", () => {
    const step = makeStep({
      opType: unsupportedOpType("somefuturestep"),
      label: "Unsupported step (somefuturestep)",
    });
    renderWithStore(<StepCardFocused {...props({ step })} />);
    expect(screen.getByText(/not yet supported/i)).toBeInTheDocument();
  });

  // HEL-1102 task 2.3: StepOpEditor's ladder renders the real UpsertSourceConfig for an `upsertsource` step.
  it("an upsertsource step renders the real editor, not the unsupported-step notice", () => {
    const step = makeStep({
      opType: OP_TYPES.find((op) => op.id === "upsertsource")!,
      label: "Write to source",
      config: { mode: "append" },
    });
    renderWithStore(<StepCardFocused {...props({ step })} />, { sources: { items: [] } });
    expect(screen.queryByText(/not yet supported/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Use existing dataset")).toBeInTheDocument();
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
  });
});

describe("StepCardFocused -- validationError surfacing (skeptic-final-1.md CR1)", () => {
  it("a non-compute step with a validationError shows the error text", () => {
    renderWithStore(
      <StepCardFocused {...props({ validationError: "Unknown field(s): 'full_name'" })} />,
    );
    expect(screen.getByText("Unknown field(s): 'full_name'")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Step has a validation error" })).toBeInTheDocument();
  });

  it("renders no error and no error marker when validationError is absent", () => {
    const { container } = renderWithStore(<StepCardFocused {...props()} />);
    expect(container.querySelector(".inline-error")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
  });

  it("a compute step renders the error once, not twice, via its own contextual placement", () => {
    const step: Step = {
      id: "persisted-step-1",
      opType: { id: "compute", label: "Compute column", icon: LIMIT.icon },
      label: "Compute column",
      config: { column: "revenue_per_user", expression: "$revenue / $users", type: "number" },
      enabled: true,
    };
    renderWithStore(
      <StepCardFocused {...props({ step, validationError: "Unknown field(s): 'revenue'" })} />,
    );
    expect(screen.getAllByText("Unknown field(s): 'revenue'")).toHaveLength(1);
  });

  it("clears the marker and the inline message together when the analyze refresh removes the error", () => {
    const { rerender } = renderWithStore(
      <StepCardFocused {...props({ validationError: "Unknown field(s): 'full_name'" })} />,
    );
    expect(screen.getByRole("img", { name: "Step has a validation error" })).toBeInTheDocument();
    rerender(<StepCardFocused {...props({ validationError: undefined })} />);
    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unknown field(s): 'full_name'")).not.toBeInTheDocument();
  });
});

describe("StepCardFocused -- disable / enable, duplicate and remove (HEL-412)", () => {
  it("an enabled step shows 'Disable step', which calls onToggleEnabled(id, false)", () => {
    const onToggleEnabled = jest.fn();
    renderWithStore(<StepCardFocused {...props({ onToggleEnabled })} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable step" }));
    expect(onToggleEnabled).toHaveBeenCalledWith("persisted-step-1", false);
  });

  it("a disabled step shows 'Enable step', which calls onToggleEnabled(id, true)", () => {
    const onToggleEnabled = jest.fn();
    renderWithStore(
      <StepCardFocused {...props({ step: makeStep({ enabled: false }), onToggleEnabled })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enable step" }));
    expect(onToggleEnabled).toHaveBeenCalledWith("persisted-step-1", true);
  });

  it("'Duplicate step' calls onDuplicate(id) and is disabled while that duplicate is in flight", () => {
    const onDuplicate = jest.fn();
    const { rerender } = renderWithStore(<StepCardFocused {...props({ onDuplicate })} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate step" }));
    expect(onDuplicate).toHaveBeenCalledWith("persisted-step-1");
    rerender(<StepCardFocused {...props({ onDuplicate, isDuplicating: true })} />);
    expect(screen.getByRole("button", { name: "Duplicate step" })).toBeDisabled();
  });

  it("'Remove step' calls onRemove(id)", () => {
    const onRemove = jest.fn();
    renderWithStore(<StepCardFocused {...props({ onRemove })} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));
    expect(onRemove).toHaveBeenCalledWith("persisted-step-1");
  });

  it("the editor stays visible and editable for a disabled step (disabling is about execution, not locking)", () => {
    renderWithStore(<StepCardFocused {...props({ step: makeStep({ enabled: false }) })} />);
    expect(screen.getByRole("spinbutton")).toBeEnabled();
  });

  it("a disabled step shows no error marker when it has no validationError", () => {
    renderWithStore(<StepCardFocused {...props({ step: makeStep({ enabled: false }) })} />);
    expect(
      screen.queryByRole("img", { name: "Step has a validation error" }),
    ).not.toBeInTheDocument();
  });
});

// HEL-1414: schema-only, NON-BLOCKING analyze warnings render on the warned step's own editor.
describe("StepCardFocused -- analyze warnings (HEL-1414)", () => {
  it("shows a header indicator with an accessible count, and a visible count when N > 1", () => {
    renderWithStore(<StepCardFocused {...props({ warnings: [w("first"), w("second")] })} />);
    expect(screen.getByRole("img", { name: "2 schema warnings" })).toHaveTextContent("2");
  });

  it("shows no visible count for a single warning and uses a singular name", () => {
    renderWithStore(<StepCardFocused {...props({ warnings: [w("only")] })} />);
    expect(screen.getByRole("img", { name: "1 schema warning" })).not.toHaveTextContent("1");
  });

  it("lists every message under 'Check before running', outside the editor body and before it", () => {
    const { container } = renderWithStore(
      <StepCardFocused {...props({ warnings: [w("first message"), w("second message")] })} />,
    );
    const region = screen.getByRole("region", { name: /Check before running/ });
    expect(region).toHaveTextContent("(these don't block runs)");
    expect(region).toHaveTextContent("first message");
    expect(region).toHaveTextContent("second message");
    expect(region).not.toHaveAttribute("role", "alert");
    expect(region.closest(".step-focused__body")).toBeNull();
    const body = container.querySelector(".step-focused__body")!;
    expect(region.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.textContent).not.toMatch(/can.?t run|cannot run/i);
  });

  it("shows both the error and the warning indicator for a step with a validationError and warnings", () => {
    renderWithStore(
      <StepCardFocused {...props({ validationError: "Unknown field", warnings: [w("a hint")] })} />,
    );
    expect(screen.getByRole("img", { name: "Step has a validation error" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 schema warning" })).toBeInTheDocument();
  });

  it("GUARD: a step without warnings renders no indicator and no region", () => {
    renderWithStore(<StepCardFocused {...props()} />);
    expect(screen.queryByRole("img", { name: /schema warning/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Check before running/ })).not.toBeInTheDocument();
  });
});

describe("StepCardFocused -- creating and draft states", () => {
  it("disables the editor and says so while the step's create is in flight (HEL-1294)", () => {
    const { container } = renderWithStore(<StepCardFocused {...props({ isCreating: true })} />);
    expect(screen.getByText("Saving step…")).toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeDisabled();
  });

  it("shows a draft's rejected create message and the saved-error message", () => {
    renderWithStore(
      <StepCardFocused
        {...props({ draftError: "Instruction too long", savedError: "Couldn't save" })}
      />,
    );
    expect(screen.getByText("Instruction too long")).toBeInTheDocument();
    expect(screen.getByText("Couldn't save")).toBeInTheDocument();
  });
});
