import { test } from "@playwright/test";

import { registerMotionModes } from "./support/hel1573-motion-primitives";

// HEL-1573 -- Motion = full and subtle, both themes.
// One of the `hel1573-motion-primitives-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the per-mode driver, the helpers and the rationale live in support/hel1573-motion-primitives.ts. The file-level
// configure and use are repeated here exactly.

test.describe.configure({ mode: "parallel" });
test.use({ video: "on", viewport: { width: 1900, height: 1000 } });

registerMotionModes(["full", "subtle"]);
