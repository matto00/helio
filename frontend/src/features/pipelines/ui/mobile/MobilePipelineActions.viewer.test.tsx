// HEL-1661 (design.md D4/D5): a viewer with a client-only draft keeps the draft status and Discard, never Save & run.
import { fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";

import { MobilePipelineActions } from "./MobilePipelineActions";

function renderBar(runRole: "viewer" | "editor" | "pending", hasDraft: boolean) {
  const onDiscard = jest.fn();
  render(
    <div>
      <MobilePipelineActions
        busy={false}
        onDryRun={jest.fn()}
        onRun={jest.fn()}
        runRole={runRole}
        draft={{ hasDraft, saving: false, onDiscard, onSaveAndRun: jest.fn() }}
      />
    </div>,
  );
  return onDiscard;
}

describe("MobilePipelineActions for a viewer", () => {
  it("renders nothing without a draft", () => {
    renderBar("viewer", false);
    expect(document.querySelector(".mobile-actions")).toBeNull();
  });

  it("with a draft: the draft status and Discard remain, Save & run does not", () => {
    const onDiscard = renderBar("viewer", true);
    expect(screen.getByText("Draft · unsaved changes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Save and run" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run pipeline" })).toBeNull();
  });

  it("an editor with a draft has Save & run; while pending no pill shows but the row keeps its height", () => {
    renderBar("editor", true);
    expect(screen.getByRole("button", { name: "Save and run" })).toBeVisible();
    document.body.innerHTML = "";
    renderBar("pending", false);
    expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
    // The height mechanism: the pending row carries the modifier that gives it the pill height (CSS asserts the rule below).
    expect(
      document.querySelector('.mobile-actions__pills[data-run-slot="pending"]'),
    ).not.toBeNull();
  });
});

describe("the pending row's height rule", () => {
  it("gives the pending row the pill height, so the published bar height is final from the first paint", () => {
    const css = fs.readFileSync(path.join(__dirname, "PipelineMobile.css"), "utf-8");
    expect(css).toMatch(
      /\.mobile-actions__pills\[data-run-slot="pending"\]\s*\{[^}]*min-height:\s*var\(--control-lg\)/,
    );
    expect(css).toMatch(/\.mobile-pill\s*\{[^}]*height:\s*var\(--control-lg\)/);
  });
});
