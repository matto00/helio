import { readFileSync } from "node:fs";
import { join } from "node:path";

// HEL-1277 -- DESIGN.md §3: touch floor on the scrubber range; control-height token on the card's
// History button.
const css = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("History view CSS guards", () => {
  it("gives the scrubber range a 44px floor under the touch gate", () => {
    const text = css("OutputHistoryModal.css");
    expect(text).toMatch(
      /@media \(max-width: 768px\), \(pointer: coarse\) \{\s*\.output-history__range \{\s*min-height: 44px;/,
    );
  });

  it("sizes the card History button with a control-height token", () => {
    const text = readFileSync(join(__dirname, "../OutputGalleryCard.css"), "utf8");
    expect(text).toMatch(/\.output-gallery-card__history \{[^}]*height: var\(--control-sm\);/);
  });
});
