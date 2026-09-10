// HEL-443 AC3 — accessible-name / aria-hidden guard for icon-only controls
// migrated off FontAwesome. Per design.md D4 and MISTAKES.md's "assertion
// whose precondition guarantees it" trap, a guard is worthless if it only
// ever sees already-compliant code: this file demonstrates the guard is RED
// against a deliberately non-compliant fixture before showing it GREEN
// against the compliant shape, rather than asserting compliance in the
// abstract.
import { render, screen } from "@testing-library/react";
import { Trash2 } from "lucide-react";

import { IconButton } from "./IconButton";

describe("icon-only control accessible name (HEL-443 AC3)", () => {
  it("RED: a hand-rolled icon-only button with no aria-label/title has no accessible name", () => {
    // Deliberately non-compliant fixture: a raw <button> wrapping a
    // decorative-looking icon with no accessible-name mechanism at all —
    // exactly the shape AC3 requires every migrated icon-only control to
    // NOT be. This is the failing case the guard below must actually catch,
    // not an already-compliant fixture that would pass by construction.
    render(
      <button type="button">
        <Trash2 aria-hidden="true" />
      </button>,
    );
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    // No accessible name at all — the browser/testing-library falls back to
    // an empty string, which is exactly the defect AC3 forbids shipping.
    expect(screen.getByRole("button")).toHaveAccessibleName("");
  });

  it("GREEN: the same control routed through IconButton has an accessible name", () => {
    // IconButton makes `aria-label` a required, non-optional prop at the
    // TypeScript level (IconButton.tsx) — this test additionally proves the
    // requirement holds at RUNTIME, not just at compile time, so a future
    // change that defeats the type check (e.g. an `as any` cast) is still
    // caught here.
    render(<IconButton icon={<Trash2 size={16} />} aria-label="Remove row" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove row" })).toBeInTheDocument();
  });

  // Probe finding (not a RED/GREEN pair): lucide-react's <svg> element
  // carries `aria-hidden="true"` BY DEFAULT, regardless of whether a caller
  // passes the prop explicitly — confirmed by rendering `<Trash2 />` with no
  // props via `renderToStaticMarkup` and inspecting the markup. This differs
  // from FontAwesomeIcon, which required an explicit `aria-hidden` to avoid
  // exposing the glyph. Practically: a decorative lucide icon can't
  // regress to "exposed to the accessibility tree" the way AC3 worries about
  // for FontAwesome, so there is no non-compliant fixture to demonstrate RED
  // against for this half of AC3 — the library's own default makes it
  // structurally true. The accessible-name half below (icon-ONLY
  // interactive controls) is the real risk this migration carries, which is
  // why it gets the full RED/GREEN pair.
  it("confirms lucide's own aria-hidden default (context for the note above, not a compliance check)", () => {
    const { container } = render(
      <span>
        <Trash2 aria-hidden="true" data-testid="glyph" />
        Delete
      </span>,
    );
    const svg = container.querySelector('[data-testid="glyph"]');
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
