#!/usr/bin/env node
// Self-test for e2e/support/stateContrast.mjs (HEL-866), on the
// scripts/check-tokens.selftest.mjs pattern: pure-function cases driven
// directly against the exported core, no browser, no disk.
//
// Every "must fail"/"must pass" case asserts on the RATIO NAMED IN THE
// OUTPUT (task 3.7), never on a boolean/exit-code alone -- a guard pointed
// at an unrelated corpus must not be able to pass its own selftest by
// accident.

import {
  CONTRAST_THRESHOLD,
  parseColor,
  compositeOver,
  compositeStack,
  contrastRatio,
  classifyState,
} from "./stateContrast.mjs";

let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function assertClose(actual, expected, epsilon, name) {
  const ok = Math.abs(actual - expected) <= epsilon;
  record(name, ok, `expected ~${expected}, got ${actual}`);
}

// --- 3.2: mutation case A, the light defect: #ffffff on #ffffff ---
{
  const backdrop = parseColor("rgb(255, 255, 255)");
  const stateColor = parseColor("rgb(255, 255, 255)");
  const ratio = contrastRatio(backdrop, stateColor);
  assertClose(ratio, 1.0, 0.001, "3.2 light defect (#ffffff on #ffffff) ratio == 1.000");
  const { verdict } = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop,
    stateColor,
  });
  record("3.2 light defect classifies FAIL", verdict === "fail", `got ${verdict}`);
}

// --- 3.3: mutation case B, the dark defect: #232019 on #262320 (1.040) ---
// THE SINGLE MOST IMPORTANT CASE IN THE FILE: proves the guard tests
// CONTRAST, not inequality -- a guard written as `!==` would pass this pair
// (the two colours are not identical) but this must still go red.
{
  const backdrop = parseColor("rgb(38, 35, 32)"); // #262320
  const stateColor = parseColor("rgb(35, 32, 25)"); // #232019
  const ratio = contrastRatio(backdrop, stateColor);
  assertClose(ratio, 1.04, 0.01, "3.3 dark defect (#232019 on #262320) ratio ~= 1.040");
  record(
    "3.3 dark defect is NOT identical (proves !== would wrongly pass)",
    backdrop.r !== stateColor.r || backdrop.g !== stateColor.g || backdrop.b !== stateColor.b,
  );
  const { verdict } = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop,
    stateColor,
  });
  record(
    "3.3 dark defect classifies FAIL despite being non-identical",
    verdict === "fail",
    `got ${verdict}, ratio ${ratio}`,
  );
}

// --- 3.4: must-pass case: soft on strong (1.179 / 1.167) goes green ---
{
  // light: soft #efece6 on strong #ffffff
  const lightBackdrop = parseColor("rgb(255, 255, 255)");
  const lightState = parseColor("rgb(239, 236, 230)");
  const lightRatio = contrastRatio(lightBackdrop, lightState);
  assertClose(lightRatio, 1.179, 0.01, "3.4 light soft-on-strong ratio ~= 1.179");
  const lightVerdict = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop: lightBackdrop,
    stateColor: lightState,
  });
  record("3.4 light soft-on-strong classifies PASS", lightVerdict.verdict === "pass");

  // dark: soft #161514 on strong #262320
  const darkBackdrop = parseColor("rgb(38, 35, 32)");
  const darkState = parseColor("rgb(22, 21, 20)");
  const darkRatio = contrastRatio(darkBackdrop, darkState);
  assertClose(darkRatio, 1.167, 0.01, "3.4 dark soft-on-strong ratio ~= 1.167");
  const darkVerdict = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop: darkBackdrop,
    stateColor: darkState,
  });
  record("3.4 dark soft-on-strong classifies PASS", darkVerdict.verdict === "pass");
  record(
    "3.4 threshold not merely 'fails everything' (both themes pass here)",
    lightVerdict.verdict === "pass" && darkVerdict.verdict === "pass",
  );
}

// --- 3.5: per-theme case: a pair clearing threshold in one theme, failing
// in the other, goes red and NAMES the failing theme ---
{
  const cases = {
    light: {
      backdrop: parseColor("rgb(255, 255, 255)"),
      stateColor: parseColor("rgb(200, 200, 200)"),
    },
    // dark: contrived pair that fails (ratio ~1.02)
    dark: { backdrop: parseColor("rgb(38, 35, 32)"), stateColor: parseColor("rgb(40, 37, 34)") },
  };
  const results = {};
  for (const [theme, { backdrop, stateColor }] of Object.entries(cases)) {
    results[theme] = classifyState({
      backgroundChanged: true,
      otherChannelChanged: false,
      backdrop,
      stateColor,
    });
  }
  record(
    "3.5 light theme passes",
    results.light.verdict === "pass",
    `got ${results.light.verdict}`,
  );
  record(
    "3.5 dark theme fails and is distinguishable by name from light",
    results.dark.verdict === "fail",
    `got ${results.dark.verdict}, ratio ${results.dark.ratio}`,
  );
}

// --- 3.6: absence case ---
{
  // nothing changed at all -> FAIL
  const nothing = classifyState({
    backgroundChanged: false,
    otherChannelChanged: false,
    backdrop: parseColor("rgb(38, 35, 32)"),
    stateColor: parseColor("rgb(38, 35, 32)"),
  });
  record(
    "3.6 nothing-changed element classifies FAIL",
    nothing.verdict === "fail",
    `got ${nothing.verdict}`,
  );

  // only box-shadow changed -> ADVISORY, not FAIL
  const shadowOnly = classifyState({
    backgroundChanged: false,
    otherChannelChanged: true,
    backdrop: parseColor("rgb(38, 35, 32)"),
    stateColor: parseColor("rgb(38, 35, 32)"),
  });
  record(
    "3.6 shadow-only element classifies ADVISORY, not FAIL",
    shadowOnly.verdict === "advisory",
    `got ${shadowOnly.verdict}`,
  );
}

// --- 3.9: alpha-compositing case (round-2 CR1 defect) ---
// A state at alpha 0.15 over a known backdrop that would PASS if compared
// uncomposited (naive: treat the state colour as though alpha=1) but FAILS
// once correctly composited over the backdrop.
{
  const backdrop = parseColor("rgb(38, 35, 32)"); // dark --app-surface-strong, opaque
  // Same hue/family as --app-accent-dim (color-mix(accent 10%, transparent)
  // in dark theme, i.e. rgba(249, 115, 22, alpha)) at a narrower alpha
  // (0.05) chosen so the flip is unambiguous: measured programmatically,
  // alpha 0.10 already composites above 1.10 for this particular backdrop
  // (a real accent pair that legitimately passes), but 0.05 composites to
  // 1.071 -- below threshold -- while its naive/uncomposited reading is
  // 5.576 -- the exact overstatement D4.3 warns against.
  const stateRaw = parseColor("rgba(249, 115, 22, 0.05)");

  // WRONG (naive/uncomposited): treat the raw rgba as though it were opaque
  // by dropping alpha -- this is exactly the bug D4.3 warns against.
  const naiveOpaque = { ...stateRaw, a: 1 };
  const naiveRatio = contrastRatio(backdrop, naiveOpaque);

  // RIGHT: composite the translucent state colour over the resolved
  // backdrop first, THEN take the ratio between two opaque colours.
  const composited = compositeStack([stateRaw, backdrop]);
  record("3.9 composited result is opaque", composited.a === 1, `got a=${composited.a}`);
  const correctRatio = contrastRatio(backdrop, composited);

  record(
    "3.9 naive (uncomposited) reading overstates the difference vs. composited",
    naiveRatio > correctRatio,
    `naive=${naiveRatio}, composited=${correctRatio}`,
  );

  const naiveVerdict = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop,
    stateColor: naiveOpaque,
  });
  const correctVerdict = classifyState({
    backgroundChanged: true,
    otherChannelChanged: false,
    backdrop,
    stateColor: composited,
  });
  record(
    "3.9 THE decisive case: passes naively but fails once correctly composited",
    naiveVerdict.verdict === "pass" && correctVerdict.verdict === "fail",
    `naive=${naiveVerdict.verdict} (ratio ${naiveVerdict.ratio}), composited=${correctVerdict.verdict} (ratio ${correctVerdict.ratio})`,
  );
}

// --- compositeStack: ancestor-chain accumulation does not stop at the
// first non-transparent layer (design.md D4.2) ---
{
  // Three-layer stack: element bg transparent, immediate parent
  // semi-transparent (alpha 0.5, a mid grey), grandparent opaque white.
  // "First non-transparent ancestor" (WRONG rule) would stop at the parent
  // and report its raw rgba as the backdrop; the correct accumulate-alpha
  // walk must blend the parent OVER the grandparent.
  const elementBg = parseColor("transparent");
  const parentBg = parseColor("rgba(128, 128, 128, 0.5)");
  const grandparentBg = parseColor("rgb(255, 255, 255)"); // opaque floor
  const result = compositeStack([elementBg, parentBg, grandparentBg]);
  record("compositeStack result is opaque (floor reached)", result.a === 1, `got a=${result.a}`);
  // Expected: 0.5*grey(128) + 0.5*white(255) = 191.5
  assertClose(
    result.r,
    191.5,
    0.5,
    "compositeStack blends translucent parent over opaque grandparent",
  );
  record(
    "compositeStack does NOT equal the raw (unblended) parent rgba (first-non-transparent would be wrong)",
    Math.abs(result.r - parentBg.r) > 10,
    `blended=${result.r}, raw parent r=${parentBg.r}`,
  );
}

// --- 3.10: pseudo-element case ---
// A state expressed only via a ::after background (real instance:
// DataGrid.css's .ui-data-grid__resize-handle:hover::after) is detected and
// classified the same as an own-element background change would be -- the
// core has no notion of "pseudo-element" at all, which is the point: the
// Playwright layer is responsible for reading getComputedStyle(el, '::after')
// and feeding it in as `stateColor` exactly like any other background read.
{
  const backdrop = parseColor("rgb(38, 35, 32)");
  // ::after paints a fully opaque highlight -- same shape a real own-element
  // background change would take once it reaches this function.
  const pseudoStateColor = parseColor("rgb(22, 21, 20)");
  const { verdict, ratio } = classifyState({
    backgroundChanged: true, // caller determined this by diffing ::after, not el itself
    otherChannelChanged: false,
    backdrop,
    stateColor: pseudoStateColor,
  });
  record(
    "3.10 pseudo-element-expressed state classified same as any background change",
    verdict === "pass",
    `got ${verdict}, ratio ${ratio}`,
  );
}

// --- threshold sanity: constant matches design.md D3 ---
record(
  "CONTRAST_THRESHOLD == 1.10 (design.md D3)",
  CONTRAST_THRESHOLD === 1.1,
  `got ${CONTRAST_THRESHOLD}`,
);

// --- classifyState throws on un-composited (alpha < 1) input rather than
// silently mis-scoring ---
{
  let threw = false;
  try {
    classifyState({
      backgroundChanged: true,
      otherChannelChanged: false,
      backdrop: parseColor("rgb(38, 35, 32)"),
      stateColor: parseColor("rgba(249, 115, 22, 0.10)"), // NOT composited
    });
  } catch {
    threw = true;
  }
  record("classifyState throws on un-composited stateColor rather than mis-scoring", threw);
}

// --- parseColor / compositeOver sanity ---
{
  const t = parseColor("transparent");
  record("parseColor('transparent') has alpha 0", t.a === 0);
  const opaque = parseColor("rgb(10, 20, 30)");
  record("parseColor opaque rgb() defaults alpha to 1", opaque.a === 1);
  // color(srgb r g b / a) -- the confirmed resting serialization of this
  // app's color-mix(in srgb, ...) tokens (--app-accent-surface/-dim).
  const srgbFn = parseColor("color(srgb 0.981647 0.571765 0.287294)");
  assertClose(srgbFn.r, 250.32, 0.5, "parseColor('color(srgb ...)') scales r to 0-255");
  record("parseColor('color(srgb ...)') defaults alpha to 1 when omitted", srgbFn.a === 1);
  const srgbFnAlpha = parseColor("color(srgb 1 0.647059 0 / 0.15)");
  assertClose(srgbFnAlpha.a, 0.15, 0.001, "parseColor('color(srgb ... / a)') reads explicit alpha");
  {
    let threw = false;
    try {
      parseColor("oklab(0.742064 0.102231 0.126493)");
    } catch {
      threw = true;
    }
    record(
      "parseColor throws on a mid-transition oklab(...) read rather than guessing (design.md D4/2.7)",
      threw,
    );
  }
  const blend = compositeOver(parseColor("rgba(0, 0, 0, 0)"), parseColor("rgb(255, 255, 255)"));
  record(
    "compositeOver fully-transparent top yields the bottom colour unchanged",
    blend.r === 255 && blend.g === 255 && blend.b === 255 && blend.a === 1,
    JSON.stringify(blend),
  );
}

// --- HEL-520 D1c: focus-channel adjudication closes the "advisory"
// deferral. Same shape as 3.6's shadow-only case, but with stateKind:
// "focus" -- this case would have scored "advisory" before this change and
// must now score a definite pass/fail. ---
{
  const backdrop = parseColor("rgb(38, 35, 32)"); // dark --app-surface-strong

  // A conforming ring colour that clears the floor against this backdrop.
  const conformingRing = parseColor("rgb(249, 168, 74)"); // bright, high-contrast accent
  const passResult = classifyState({
    backgroundChanged: false,
    otherChannelChanged: true,
    backdrop,
    stateColor: conformingRing,
    stateKind: "focus",
  });
  record(
    "HEL-520 focus-only outline change is NOT advisory (was advisory pre-change)",
    passResult.verdict !== "advisory",
    `got ${passResult.verdict}`,
  );
  record(
    "HEL-520 conforming focus ring classifies PASS",
    passResult.verdict === "pass",
    `got ${passResult.verdict}, ratio ${passResult.ratio}`,
  );

  // A non-conforming ring colour (near-identical to the backdrop) fails.
  const nonConformingRing = parseColor("rgb(40, 37, 34)");
  const failResult = classifyState({
    backgroundChanged: false,
    otherChannelChanged: true,
    backdrop,
    stateColor: nonConformingRing,
    stateKind: "focus",
  });
  record(
    "HEL-520 non-conforming focus ring classifies FAIL, not advisory",
    failResult.verdict === "fail",
    `got ${failResult.verdict}, ratio ${failResult.ratio}`,
  );

  // The hover path is UNCHANGED by this addition: the same shadow-only
  // input, without stateKind: "focus" (i.e. the default "hover"), still
  // scores advisory exactly as HEL-866 originally specified.
  const hoverResult = classifyState({
    backgroundChanged: false,
    otherChannelChanged: true,
    backdrop,
    stateColor: conformingRing,
  });
  record(
    "HEL-520 default (hover) stateKind is unchanged: still advisory",
    hoverResult.verdict === "advisory",
    `got ${hoverResult.verdict}`,
  );

  // Nothing-changed still fails regardless of stateKind.
  const nothingFocus = classifyState({
    backgroundChanged: false,
    otherChannelChanged: false,
    backdrop,
    stateColor: backdrop,
    stateKind: "focus",
  });
  record(
    "HEL-520 nothing-changed focus probe still classifies FAIL",
    nothingFocus.verdict === "fail",
    `got ${nothingFocus.verdict}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
