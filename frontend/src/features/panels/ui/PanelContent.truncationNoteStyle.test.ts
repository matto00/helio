import { readFileSync } from "fs";
import { join } from "path";

// HEL-1358 skeptic-final-1 CR1 — STRUCTURAL guard only (jsdom does no layout): the truncation note
// must share the annotation's 2-line-clamp rule and never be forced to one line, so the total is not
// ellipsised away at the grid's narrowest width. It does not prove the rendered layout.
const css = readFileSync(join(__dirname, "PanelContent.css"), "utf8");

it("shares the annotation's multi-line clamp rule and has no nowrap", () => {
  const shared = css.match(
    /\.chart-panel__annotation,\s*\.chart-panel__truncation-note\s*\{([^}]*)\}/,
  );
  expect(shared).not.toBeNull();
  expect(shared![1]).toMatch(/-webkit-line-clamp:\s*2/);
  const own = css.match(/(?:^|\})\s*\.chart-panel__truncation-note\s*\{([^}]*)\}/);
  expect(own).toBeNull();
  expect(shared![1]).not.toMatch(/white-space:\s*nowrap/);
});
