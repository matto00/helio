import { render, screen } from "@testing-library/react";

import { TruncatedRowCountBadge, TRUNCATED_ROW_COUNT_LABEL } from "./TruncatedRowCountBadge";

// skeptic-final-1.md: the original defect was `display: inline-flex` on this badge's own span
// silently discarding a whitespace-only text run at the START of its content (CSS Flexbox spec),
// which swallowed a `{" "}` meant to space the badge from a preceding row count. That collapsing
// behaviour is CSS layout, not DOM content -- `element.textContent` is unaffected by it (verified:
// a probe render showed jsdom's `textContent` already contained the space with the OLD, buggy
// markup), so no jsdom/RTL assertion on textContent can distinguish the collided rendering from
// the fixed one. The skeptic's real-browser check (`hel873-list-light.png`,
// `hel873-history-dark.png`) is the actual evidence the visual gap renders correctly; this test
// instead guards the STRUCTURAL root cause directly: the badge's own span must never carry a
// leading whitespace-only text node again (the exact shape that CSS silently discards), and the
// visible gap must come from the component's own CSS margin instead.
describe("TruncatedRowCountBadge — skeptic-final-1.md CR1 (leading-space collision)", () => {
  it("does not lead its own text content with a whitespace character (the shape the flex-collapse rule discards)", () => {
    render(<TruncatedRowCountBadge />);
    const badge = screen.getByRole("img", { name: TRUNCATED_ROW_COUNT_LABEL });

    // Red-arm check: the pre-fix markup (`{" "}` immediately inside this span) rendered this as
    // " ⚠ Partial" -- a real leading-space character in the DOM, confirmed by a throwaway probe
    // render before this fix (`element.innerHTML` showed `>&nbsp; ⚠ Partial<` i.e. a literal
    // leading space). `.toBe` (not a regex) fails on that string; it passes only once the leading
    // whitespace text node is gone and the gap is expressed as CSS margin instead.
    expect(badge.textContent).toBe("⚠ Partial");
  });
});
