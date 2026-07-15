import { computeMobilePanelHeight, resolveStackContentWidth } from "./mobilePanelHeights";

// Task 5.4 — per-kind band + h-modulation edges, per W4.3 of
// notes/mobile-pwa-handoff.md.

const PHONE_CONTENT_WIDTH = 350; // ≈ resolveStackContentWidth(390) at a 390px viewport

describe("mobilePanelHeights — metric", () => {
  it("is content-sized within ~104–132px regardless of h", () => {
    for (const h of [0, 1, 5, 12]) {
      const policy = computeMobilePanelHeight("metric", h, PHONE_CONTENT_WIDTH);
      expect(policy.height).not.toBeNull();
      expect(policy.height as number).toBeGreaterThanOrEqual(104);
      expect(policy.height as number).toBeLessThanOrEqual(132);
    }
  });

  it("ignores h entirely — the same height at h=1 and h=12", () => {
    const low = computeMobilePanelHeight("metric", 1, PHONE_CONTENT_WIDTH);
    const high = computeMobilePanelHeight("metric", 12, PHONE_CONTENT_WIDTH);
    expect(low.height).toBe(high.height);
  });

  it("does not scroll internally", () => {
    expect(computeMobilePanelHeight("metric", 5, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(
      false,
    );
  });
});

describe("mobilePanelHeights — chart", () => {
  it("stays within the clamped aspect band [200, 340]", () => {
    for (const h of [1, 4, 6, 8, 12]) {
      const policy = computeMobilePanelHeight("chart", h, PHONE_CONTENT_WIDTH);
      expect(policy.height as number).toBeGreaterThanOrEqual(200);
      expect(policy.height as number).toBeLessThanOrEqual(340);
    }
  });

  it("a chart with h<=4 is shorter than a chart with h>=8 at the same width", () => {
    const compact = computeMobilePanelHeight("chart", 4, PHONE_CONTENT_WIDTH);
    const tall = computeMobilePanelHeight("chart", 8, PHONE_CONTENT_WIDTH);
    expect(compact.height as number).toBeLessThan(tall.height as number);
  });

  it("is monotonic between the compact and tall edges", () => {
    const h4 = computeMobilePanelHeight("chart", 4, PHONE_CONTENT_WIDTH).height as number;
    const h6 = computeMobilePanelHeight("chart", 6, PHONE_CONTENT_WIDTH).height as number;
    const h8 = computeMobilePanelHeight("chart", 8, PHONE_CONTENT_WIDTH).height as number;
    expect(h4).toBeLessThanOrEqual(h6);
    expect(h6).toBeLessThanOrEqual(h8);
  });

  it("grows with width (aspect-driven)", () => {
    const narrow = computeMobilePanelHeight("chart", 6, 300).height as number;
    const wide = computeMobilePanelHeight("chart", 6, 400).height as number;
    expect(wide).toBeGreaterThan(narrow);
  });

  it("does not scroll internally", () => {
    expect(computeMobilePanelHeight("chart", 6, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(false);
  });
});

describe("mobilePanelHeights — table", () => {
  it("has no fixed height (capped via CSS, min(60dvh, intrinsic))", () => {
    expect(computeMobilePanelHeight("table", 5, PHONE_CONTENT_WIDTH).height).toBeNull();
  });

  it("is the only kind that scrolls internally", () => {
    expect(computeMobilePanelHeight("table", 5, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(true);
    for (const kind of ["metric", "chart", "markdown", "text", "image", "divider"] as const) {
      expect(computeMobilePanelHeight(kind, 5, PHONE_CONTENT_WIDTH).scrollsInternally).toBe(false);
    }
  });
});

describe("mobilePanelHeights — markdown, text, image, divider", () => {
  it.each(["markdown", "text", "image", "divider"] as const)(
    "%s is fully intrinsic — no fixed height, no internal scroll",
    (kind) => {
      const policy = computeMobilePanelHeight(kind, 5, PHONE_CONTENT_WIDTH);
      expect(policy.height).toBeNull();
      expect(policy.scrollsInternally).toBe(false);
    },
  );
});

describe("resolveStackContentWidth", () => {
  it("subtracts stack/card chrome from the measured container width", () => {
    const contentWidth = resolveStackContentWidth(390);
    expect(contentWidth).toBeLessThan(390);
    expect(contentWidth).toBeGreaterThan(300);
  });

  it("never goes negative for a pathologically narrow container", () => {
    expect(resolveStackContentWidth(10)).toBe(0);
  });
});
