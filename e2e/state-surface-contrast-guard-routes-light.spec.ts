import { test } from "@playwright/test";

import {
  registerRouteCells,
  ROUTE_KEYS_HEAVIEST_FIRST,
} from "./support/state-surface-contrast-guard";

// HEL-866 -- the light route cells (/home, /dashboards, /chat, /connectors), both themes.
// One of the `state-surface-contrast-guard-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the guard's helpers, cell setup and rationale live in support/state-surface-contrast-guard.ts.

test.describe("HEL-866 state-surface contrast guard", () => {
  test.describe.configure({ mode: "parallel" });
  test.setTimeout(120_000);
  registerRouteCells(ROUTE_KEYS_HEAVIEST_FIRST.slice(4));
});
