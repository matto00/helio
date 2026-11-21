import { test } from "@playwright/test";

import { NARROW_WIDTHS, registerNarrowCells } from "./support/state-surface-contrast-guard-narrow";

// HEL-1649 -- the narrow-viewport cells at 390 px, both themes. One of the
// `state-surface-contrast-guard-*.spec.ts` parts (split by width so CI's file-level sharding can place the two halves
// on different legs); the rationale lives in support/state-surface-contrast-guard-narrow.ts.

test.describe("HEL-866 state-surface contrast guard (narrow viewports)", () => {
  test.describe.configure({ mode: "parallel" });
  test.setTimeout(120_000);
  registerNarrowCells(NARROW_WIDTHS.slice(2));
});
