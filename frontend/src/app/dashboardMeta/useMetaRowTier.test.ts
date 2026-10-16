import { META_ROW_EDIT_EXTRA_PX, META_ROW_TIER_WIDTHS, tierForWidth } from "./useMetaRowTier";

describe("tierForWidth (HEL-1576 D3)", () => {
  it("treats an unmeasured width as the full tier", () => {
    expect(tierForWidth(0, false)).toBe(0);
  });

  it.each([
    [META_ROW_TIER_WIDTHS.iconOnly, 0],
    [META_ROW_TIER_WIDTHS.iconOnly - 1, 1],
    [META_ROW_TIER_WIDTHS.kebab, 1],
    [META_ROW_TIER_WIDTHS.kebab - 1, 2],
    [META_ROW_TIER_WIDTHS.countOnly, 2],
    [META_ROW_TIER_WIDTHS.countOnly - 1, 3],
  ])("view mode at %ipx is tier %i", (width, tier) => {
    expect(tierForWidth(width, false)).toBe(tier);
  });

  it("edit mode needs more room for the same tier", () => {
    const width = META_ROW_TIER_WIDTHS.iconOnly;
    expect(tierForWidth(width, false)).toBe(0);
    expect(tierForWidth(width, true)).toBe(1);
    expect(tierForWidth(width + META_ROW_EDIT_EXTRA_PX, true)).toBe(0);
  });
});
