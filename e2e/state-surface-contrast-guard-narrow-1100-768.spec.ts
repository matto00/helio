import { test } from "@playwright/test";

import { narrowWidths, registerNarrowCells } from "./support/state-surface-contrast-guard-narrow";

// HEL-1649 -- the narrow-viewport cells at 1100 and 768 px, both themes. One of the
// `state-surface-contrast-guard-*.spec.ts` parts (split by width so CI's file-level sharding can place the two halves
// on different legs); the rationale lives in support/state-surface-contrast-guard-narrow.ts.

test.describe("HEL-866 state-surface contrast guard (narrow viewports)", () => {
  test.describe.configure({ mode: "parallel" });
  test.setTimeout(120_000);
  registerNarrowCells(narrowWidths(1100, 768));
});
