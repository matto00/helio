import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

// HEL-813 — dedicated config for MANUALLY re-running the one-shot
// demonstrated-RED regression harness (e2e/hel813-mobile-touch-target-
// floor.regression.spec.ts). `playwright.config.ts`'s `testIgnore` excludes
// `**/*.regression.spec.ts` from discovery UNCONDITIONALLY — including
// explicit file arguments (Playwright 1.55's `testIgnore` filters the whole
// suite, not just glob auto-discovery) — so the harness cannot be run
// through the default config at all, by design (design.md D1/CR3's
// belt-and-suspenders: the config-level exclusion and the file's own
// `HEL813_REGRESSION` env-var skip are meant to be two INDEPENDENT layers,
// not both gated on the same variable). This override config exists solely
// so the harness can still be invoked on demand, without weakening that
// default-run protection. Never referenced by `npm run e2e`, CI, or any
// other script — see e2e/README.md for the exact command.
export default defineConfig({
  ...baseConfig,
  testIgnore: [],
});
