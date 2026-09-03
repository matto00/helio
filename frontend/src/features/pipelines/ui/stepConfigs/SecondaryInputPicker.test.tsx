// SecondaryInputPicker.test.tsx — HEL-912 task 5.5. The only Jest expression
// of ticket AC2's "rejoin picker excludes ancestor lanes": asserts the
// PRODUCED option list and its disabled/reason state (lesson 8), not that
// render succeeded.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { SecondaryInputPicker } from "./SecondaryInputPicker";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { SecondaryInput } from "../../types/pipelineStep";
import type { Step } from "../../types/step";

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;
const UNION_OP = OP_TYPES.find((op) => op.id === "union")!;

function plainStep(id: string, label: string, parentStepId?: string): Step {
  return {
    id,
    opType: FILTER_OP,
    label,
    config: { combinator: "AND", conditions: [] },
    enabled: true,
    parentStepId,
  };
}

function unionStep(
  id: string,
  label: string,
  parentStepId: string,
  secondaryInput: SecondaryInput,
): Step {
  return {
    id,
    opType: UNION_OP,
    label,
    config: { secondaryInput, mode: "byPosition" },
    enabled: true,
    parentStepId,
  };
}

// Topology:
//   a (root)
//   ├─ b (parent a)        -- ancestor of "current" via parentStepId
//   │  └─ current (union, parent b) -- the configuring step
//   ├─ c (parent a)        -- a SIBLING lane, non-ancestor, selectable
//   │  └─ d (parent c)     -- non-terminal (has its own child e below);
//   │                         also already-consumed by "otherRejoin"
//   │  └─ e (parent d)     -- a node at a LOWER row than "current"
//   └─ f (parent a)        -- a node in a HIGHER-index lane than b's
//   otherRejoin (union, parent e, secondaryInput lane -> d) -- makes an
//     existing lane edge d -> otherRejoin, so "current"'s own ancestry via
//     an existing lane edge is exercised by a SEPARATE fixture below.
function buildSteps(): Step[] {
  const a = plainStep("a", "Filter A");
  const b = plainStep("b", "Filter B", "a");
  const current = unionStep("current", "Union current", "b", {
    kind: "source",
    dataSourceId: "",
  });
  const c = plainStep("c", "Filter C", "a");
  const d = plainStep("d", "Filter D", "c");
  const e = plainStep("e", "Filter E", "d");
  const f = plainStep("f", "Filter F", "a");
  const otherRejoin = unionStep("otherRejoin", "Union other", "e", {
    kind: "lane",
    stepId: "d",
  });
  return [a, b, current, c, d, e, f, otherRejoin];
}

function renderPicker(overrides: { value?: SecondaryInput; onChange?: jest.Mock } = {}) {
  const onChange = overrides.onChange ?? jest.fn();
  renderWithStore(
    <SecondaryInputPicker
      label="Other source"
      value={overrides.value ?? { kind: "source", dataSourceId: "" }}
      allSteps={buildSteps()}
      currentStepId="current"
      onChange={onChange}
    />,
    { sources: { items: [], status: "succeeded" } },
  );
  return onChange;
}

function openPicker() {
  fireEvent.click(screen.getByRole("combobox", { name: "Other source" }));
}

describe("SecondaryInputPicker — eligibility as a PROPERTY (task 5.5)", () => {
  it("(a) the configuring step's own id is absent from the options", () => {
    renderPicker();
    openPicker();
    expect(screen.queryByRole("option", { name: /Union current/ })).not.toBeInTheDocument();
  });

  it("(b) an ancestor reached via the parentStepId chain is PRESENT but disabled with a cycle reason", () => {
    renderPicker();
    openPicker();
    const option = screen.getByRole("option", { name: /Filter B/ });
    expect(option).toBeInTheDocument();
    expect(option).toHaveTextContent("would create a cycle");
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it('(b) an ancestor reached ONLY via an existing {kind:"lane"} edge is also PRESENT but disabled', () => {
    // Re-point "current"'s own parent to "otherRejoin" so "d" becomes an
    // ancestor of "current" ONLY through otherRejoin's existing lane edge
    // (otherRejoin -> d), not through any parentStepId chain directly.
    const steps = buildSteps().map((s) =>
      s.id === "current" ? { ...s, parentStepId: "otherRejoin" } : s,
    );
    const onChange = jest.fn();
    renderWithStore(
      <SecondaryInputPicker
        label="Other source"
        value={{ kind: "source", dataSourceId: "" }}
        allSteps={steps}
        currentStepId="current"
        onChange={onChange}
      />,
      { sources: { items: [], status: "succeeded" } },
    );
    openPicker();
    const option = screen.getByRole("option", { name: /Filter D/ });
    expect(option).toHaveTextContent("would create a cycle");
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("(c) a non-terminal node, an already-consumed node, a node in a higher-index lane, and a node at a lower row are each present and NOT disabled", () => {
    renderPicker();
    openPicker();
    // "d" is both non-terminal (has child "e") AND already consumed by
    // "otherRejoin" -- neither property disables it (no terminal-only
    // filter, no single-consumer filter, per contract items 6/6b).
    const dOption = screen.getByRole("option", { name: /Filter D/ });
    expect(dOption).not.toHaveAttribute("aria-disabled", "true");
    expect(dOption).not.toHaveTextContent("would create a cycle");

    // "e" -- a node at a lower row (deeper in c's own chain) than "current".
    const eOption = screen.getByRole("option", { name: /Filter E/ });
    expect(eOption).not.toHaveAttribute("aria-disabled", "true");

    // "f" -- a sibling lane at a higher index than "current"'s own lane.
    const fOption = screen.getByRole("option", { name: /Filter F/ });
    expect(fOption).not.toHaveAttribute("aria-disabled", "true");
  });

  it("selecting an enabled lane option calls onChange with a lane-kind SecondaryInput", () => {
    const onChange = renderPicker();
    openPicker();
    fireEvent.click(screen.getByRole("option", { name: /Filter F/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: "lane", stepId: "f" });
  });
});
