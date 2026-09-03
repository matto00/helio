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
// not both gated on the same variable).
//
// HEL-951 — `playwright.config.ts`'s `testIgnore` is now a quarantine
// REGISTER, not a single entry: it also holds one `testIgnore` string per
// red/flaky orphan spec (HEL-960/961/962/963 as of this writing), each with
// its own follow-up ticket. This override must clear ONLY the permanent
// `**/*.regression.spec.ts` entry — clearing the whole list (as the
// original `testIgnore: []` did, back when the base register held exactly
// that one entry) would silently un-quarantine every one of those known-red
// specs too, which is precisely the kind of silent exclusion mechanism
// HEL-951 exists to kill. The preserved list is DERIVED from
// `baseConfig.testIgnore` (a filter, not a hand-copied second literal
// list) specifically so a future addition/removal in the base register
// can never drift out of sync with this override — a hand-copied duplicate
// would just be the same class of bug one layer further down. Never
// referenced by `npm run e2e`, CI, or any other script — see e2e/README.md
// for the exact command.
const REGRESSION_ENTRY = "**/*.regression.spec.ts";

export default defineConfig({
  ...baseConfig,
  testIgnore: (baseConfig.testIgnore as string[]).filter((pattern) => pattern !== REGRESSION_ENTRY),
});
