// HEL-1465 D4 — two expanded lookup steps on one page must not share the "Reference match field"
// input id. The input also carries aria-label, so getAllByLabelText passes even with duplicate ids;
// these assertions inspect the ids and each <label htmlFor> directly.
import { screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { LookupConfig } from "./LookupConfig";
import type { LookupConfigValue } from "./LookupConfig";

const config: LookupConfigValue = {
  secondary: { kind: "source", dataSourceId: "" },
  sourceKey: "",
  lookupKey: "",
  columns: [],
};

function renderTwoLookupCards() {
  renderWithStore(
    <>
      {["card-a", "card-b"].map((testId) => (
        <div key={testId} data-testid={testId}>
          <LookupConfig
            config={config}
            analyzeSchema={[]}
            allSteps={[]}
            currentStepId={testId}
            onChange={jest.fn()}
          />
        </div>
      ))}
    </>,
    { sources: { items: [], status: "succeeded" } },
  );
  return ["card-a", "card-b"].map((testId) => within(screen.getByTestId(testId)));
}

describe("LookupConfig reference-match-field id", () => {
  it("gives each lookup card its own input id, used exactly once in the document", () => {
    const [a, b] = renderTwoLookupCards();
    const idA = a.getByRole("textbox", { name: "Reference match field" }).id;
    const idB = b.getByRole("textbox", { name: "Reference match field" }).id;
    expect(idA).not.toBe("");
    expect(idB).not.toBe("");
    expect(idA).not.toBe(idB);
    expect(document.querySelectorAll(`[id="${idA}"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[id="${idB}"]`)).toHaveLength(1);
  });

  it("points each card's label htmlFor at that card's own input", () => {
    for (const card of renderTwoLookupCards()) {
      const input = card.getByRole("textbox", { name: "Reference match field" });
      const label = card.getByText("Reference match field", { selector: "label" });
      expect(label).toHaveAttribute("for", input.id);
      expect(document.getElementById(label.getAttribute("for") ?? "")).toBe(input);
    }
  });
});
