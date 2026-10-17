import { computeMobilePanelHeight, resolveStackContentWidth } from "./mobilePanelHeights";

// HEL-909 — a placement is one of 5 kinds now (output/text/markdown/image/
// divider). `output` gets the capped/internally-scrolling treatment `table`
// had (see `mobilePanelHeights.ts`'s doc comment) until output-kind-aware
// sizing is threaded through.

const PHONE_CONTENT_WIDTH = 350; // ≈ resolveStackContentWidth(390) at a 390px viewport

describe("mobilePanelHeights — output", () => {
  it("has no fixed height (capped via CSS, min(60dvh, intrinsic))", () => {
    expect(computeMobilePanelHeight("output", 5, PHONE_CONTENT_WIDTH).height).toBeNull();
  });

  it("is the only kind that scrolls internally", () => {
    expect(computeMobilePanelHeight("output", 5, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(true);
    for (const kind of ["markdown", "text", "image", "divider", "form"] as const) {
      expect(computeMobilePanelHeight(kind, 5, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(false);
    }
  });
});

describe("mobilePanelHeights — markdown, text, image, divider, form", () => {
  it.each(["markdown", "text", "image", "divider", "form"] as const)(
    "%s is fully intrinsic — no fixed height, no internal scroll",
    (kind) => {
      const policy = computeMobilePanelHeight(kind, 5, PHONE_CONTENT_WIDTH);
      expect(policy.height).toBeNull();
      expect(policy.scrollsInternally).toBe(false);
    },
  );
});

describe("resolveStackContentWidth", () => {
  // HEL-1583 D1: the stack adds no inline padding; each card has a 1px border and 14px padding per side.
  it("subtracts exactly the 30px card chrome (2 x (1px border + 14px padding)) and no stack padding", () => {
    expect(resolveStackContentWidth(351)).toBe(321);
    expect(resolveStackContentWidth(375 - 24)).toBe(375 - 24 - 30);
  });

  it("subtracts stack/card chrome from the measured container width", () => {
    const contentWidth = resolveStackContentWidth(390);
    expect(contentWidth).toBeLessThan(390);
    expect(contentWidth).toBeGreaterThan(300);
  });

  it("never goes negative for a pathologically narrow container", () => {
    expect(resolveStackContentWidth(10)).toBe(0);
  });
});
