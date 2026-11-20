import { ACTIONS, describeMode } from "./support/hel1684-draft-structural";

// HEL-1684: the desktop-light actions (with Discard) and the desktop-dark smoke.
// One of the `hel1684-draft-structural-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared seed, helpers, the action table and `describeMode` live in support/hel1684-draft-structural.ts.

describeMode("desktop", "light", ACTIONS, true);
describeMode(
  "desktop",
  "dark",
  ACTIONS.filter((a) => a.name === "insert step"),
  false,
);
