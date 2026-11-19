import { test } from "@playwright/test";
import { describeGlassNav } from "./support/hel1583-glass-nav";

// Every test registers its own user and seeds its own data, so tests are independently schedulable.
test.describe.configure({ mode: "parallel" });

// HEL-1583 Phase B -- the five-tab glass bottom nav (Home, Dashboards, Data, Pipelines, Me), the expanding labelled
// active tab, the opaque active pill, and the phone "refreshed" line, measured from RENDERED pixels (jsdom evaluates no
// layout, no media queries and no backdrop-filter). Contrast is sampled from screenshots of the nav over each backdrop
// the spec names, after `document.fonts.ready`.
// Part of HEL-1583 split by HEL-1778 (hel1583-glass-nav.spec.ts): the light theme; shared code in support/hel1583-glass-nav.ts.

describeGlassNav("light");
