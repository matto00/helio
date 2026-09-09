import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

import { forceFocusVisible } from "./support/forceFocusVisible";
import { readIndicatorSnapshot, measureOneElement } from "./support/focusPresenceProbe";

// HEL-520 §7 (design.md D6) — one-shot, NOT-CI-gated demonstrated-RED
// regression harness for the AC2 focus-presence guard, on the
// hel813-mobile-touch-target-floor.regression.spec.ts pattern: patches
// REAL component source into each known-bad shape, re-measures with the
// SAME shared helper the steady-state guard uses
// (e2e/support/focusPresenceProbe.ts), asserts red for the STATED reason,
// reverts, asserts green. Excluded from a bare `npm run e2e` and CI by the
// same three independent layers that pattern already establishes
// (playwright.config.ts's blanket `**/*.regression.spec.ts` testIgnore,
// this file's own env-var self-gate below, and playwright.regression.
// config.ts being the only config that clears that testIgnore) — see
// e2e/README.md.
//
// Two of the three synthesized shapes design.md D6 names are covered
// here: (a) suppressed-with-no-replacement, (b) clipped. The third,
// (c) occluded, is NOT covered — task 2.4 (occlusion detection) was
// itself not shipped (see focusPresenceProbe.ts's module comment): a
// `document.elementsFromPoint`-based sampler was built and found
// methodologically unsound (outlines/box-shadows never expand an
// element's hit-test box, so the sampler read a correctly-stacked ring as
// "100% occluded"), and was removed rather than shipped broken. A guard
// arm cannot be proven red for a check that was never wired into the
// guard it is proving red against — naming this gap plainly, per this
// ticket's own standard, rather than fabricating a case for a detector
// that does not exist.

test.skip(!process.env.HEL520_REGRESSION, "opt-in only - see e2e/README.md");

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel520reg-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-520 Regression ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

async function writeAndSettle(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  // 3000ms, not hel813's 700ms — confirmed live (a real timing bug this
  // harness itself hit, not a copy of a known-good constant): a mutation
  // to auth.css was still serving the PRE-mutation computed style at
  // 700ms and even at 1500ms; only reliably visible by 3000ms. Vite's
  // dev-server file-watch-to-recompile-to-HMR-push round trip apparently
  // varies by file/route, so this harness uses a wider, directly-measured
  // margin rather than assuming hel813's constant transfers unchanged.
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

async function reloadAndSettle(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState("networkidle");
}

/** Runs the shared measurement pipeline (real `.focus()` + CDP-forced
 *  `:focus-visible`, exactly as the steady-state guard does) against one
 *  locator and returns its `Finding`. */
async function measureLive(
  page: Page,
  client: CDPSession,
  locator: Locator,
  viewName: string,
  desc: string,
) {
  // Explicit blur BEFORE reading `base`, not just after — confirmed live,
  // a real bug this harness hit calling `measureLive` twice on the same
  // element in one test (baseline, then mutated): the transition-timed
  // border-color/box-shadow (inputs.css's `transition: border-color,
  // box-shadow`) from the PRIOR call's blur was still resolving when the
  // next call read its `base` snapshot, corrupting the before/after diff
  // (a real indicator change misread as none, or vice versa). A settle
  // wait alone did not fix it reliably; forcing blur first, then waiting,
  // does.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()).catch(() => {});
  // 400ms, not 200 — evaluation-3.md: 200ms is only 1.25x headroom over
  // theme.css's 160ms --app-transition (inputs.css transitions
  // border-color on it), and the evaluator caught this flaky on their very
  // first run (2 failures in 5, both landing on the same intermediate-
  // frame ratio 1.4407, i.e. a deterministic mid-transition read, not
  // noise). Line ~109 below already used 400ms for exactly this reason;
  // this wait now matches it.
  await page.waitForTimeout(400);
  const base = await readIndicatorSnapshot(locator);
  await locator.focus();
  const clearFocus = await forceFocusVisible(client, locator);
  await page.waitForTimeout(400);
  try {
    return await measureOneElement(locator, base, viewName, "dark", desc);
  } finally {
    await clearFocus();
    await page
      .evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      .catch(() => {});
  }
}

// HEL-520 regression Case A (suppressed-with-no-replacement) — CR4
// (evaluation-1.md). Two file-mutation anchors were tried first (auth.css,
// then inputs.css) and BOTH lost to a Vite dev-server HMR race: a direct
// `fetch()` of the served CSS module confirmed the mutated rule body was
// served correctly, but `#email`'s CDP-forced computed `box-shadow` kept
// reading the pre-mutation value regardless, at wait margins up to 3000ms.
// `page.addStyleTag` sidesteps that race entirely — it injects a real
// `<style>` element into the live document with no file-watch round trip
// and no tracked-source mutation to revert, while still driving the exact
// same `measureOneElement` measurement path (task 7.4's actual
// requirement) against a real, rendered element. The injected rule
// overrides `#email`'s OWN currently-resting border-color/background
// (read live, not hardcoded) with `!important`, alongside `outline: none
// !important` and `box-shadow: none !important` — so under forced
// `:focus-visible`, no channel differs from rest, reproducing "suppressed
// with no replacement" exactly.

// HEL-520 regression Case B anchor — the add-source button fix this same
// cycle just shipped (PipelineDetailHeader.css). Reverting the
// `outline-offset: -2px` rule reproduces the exact clipped-ring shape the
// guard caught before that fix, patched into the SAME real, rendering
// source the fix lives in (not a synthesized fixture).
const ADD_SOURCE_BTN_CSS = path.resolve(
  __dirname,
  "../frontend/src/features/pipelines/ui/PipelineDetailHeader.css",
);
const ADD_SOURCE_BTN_FOCUS_RULE = `.pipeline-detail-header__add-source-btn:focus-visible {
  outline-offset: -2px;
}`;

function assertAddSourceBtnRuleUnique(original: string): void {
  const matches = original.split(ADD_SOURCE_BTN_FOCUS_RULE).length - 1;
  if (matches !== 1) {
    throw new Error(
      `regression harness: expected exactly 1 "${ADD_SOURCE_BTN_FOCUS_RULE}" rule in PipelineDetailHeader.css, found ${matches} — source drifted from the expected (HEL-520-fixed) shape`,
    );
  }
}

test.describe("HEL-520 demonstrated-RED regression harness", () => {
  test("Case A — an indicator suppressed with no replacement goes red, then clean on revert", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");

    await page.goto("/login");
    const emailInput = page.locator("#email");

    // 1. Read #email's OWN currently-resting border-color/background-color
    // BEFORE any focus occurs on this page (never hardcoded — a resting
    // value that drifts with a future theme change must not silently
    // break this override). Deliberately read before the baseline
    // measurement below, not after: reading it after `measureLive`'s own
    // real `.focus()` + blur cycle was tried first and found to
    // intermittently observe the FOCUSED border-color (the shared
    // `--app-focus-ring-color`) instead of the resting one — a real,
    // confirmed timing hazard in the blur-then-read sequence, not a
    // one-off. Reading first, before this page has ever been focused,
    // removes the hazard entirely rather than chasing its cause.
    const resting = await emailInput.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderColor: s.borderColor, backgroundColor: s.backgroundColor };
    });

    // 2. Baseline — current (real, un-injected) source. Skeptic-final-1.md
    // (non-blocking finding): this comment previously claimed `#email`'s
    // real baseline verdict was "fail" at a known residual ratio, left
    // over from before Cycle 5's any-channel-rule fix (CR-A). It is
    // stale: every observed run since that fix — six by the evaluator,
    // one by the skeptic, and this cycle's own re-runs — reports
    // `verdict=pass ratio=4.9596` (the border channel, correctly graded).
    // The assertion below is intentionally left as `["pass","fail"]`
    // rather than narrowed to `"pass"` alone: this harness's job is to
    // prove Case A's red/green sensitivity, not to re-assert AC2's
    // contrast floor for this specific element, so it accepts either a
    // clean pass or a real (non-clipped, non-no-indicator) contrast
    // finding as a valid starting point.
    const baseline = await measureLive(page, client, emailInput, "/login", "input#email");
    console.log(
      `[hel520-regression][Case A][baseline] verdict=${baseline.verdict} detail=${baseline.detail}`,
    );
    expect(["pass", "fail"]).toContain(baseline.verdict);

    // 3. Inject the higher-specificity <style> forcing every indicator
    // channel back to the resting values read in step 1, plus outline/
    // box-shadow: none. No file on disk is touched; nothing to revert
    // there.
    const styleHandle = await page.addStyleTag({
      content: `#email:focus-visible {
        outline: none !important;
        box-shadow: none !important;
        border-color: ${resting.borderColor} !important;
        background-color: ${resting.backgroundColor} !important;
      }`,
    });

    // 4. Confirm RED for the STATED reason: the SAME shared measurement
    // function now reports "no-indicator", not merely "not pass".
    const mutatedResult = await measureLive(
      page,
      client,
      page.locator("#email"),
      "/login",
      "input#email",
    );
    console.log(
      `[hel520-regression][Case A][mutated] verdict=${mutatedResult.verdict} detail=${mutatedResult.detail}`,
    );
    expect(
      mutatedResult.verdict,
      "measureOneElement must report no-indicator against the injected suppressed-with-no-replacement style",
    ).toBe("no-indicator");

    // 5. Remove the injected <style> and confirm clean: the SAME verdict
    // and ratio as the baseline (whatever that is — "pass" or the named
    // residual's specific "fail"), never "no-indicator"/"clipped".
    await styleHandle.evaluate((el: Element) => el.remove());
    const revertedResult = await measureLive(
      page,
      client,
      page.locator("#email"),
      "/login",
      "input#email",
    );
    console.log(
      `[hel520-regression][Case A][reverted] verdict=${revertedResult.verdict} detail=${revertedResult.detail}`,
    );
    expect(revertedResult.verdict).toBe(baseline.verdict);
    expect(revertedResult.detail).toBe(baseline.detail);
  });

  test("Case B — a clipped ring goes red, then clean on revert", async ({ page, request }) => {
    test.setTimeout(60_000);
    const original = await fs.readFile(ADD_SOURCE_BTN_CSS, "utf8");
    let mutated = false;

    try {
      assertAddSourceBtnRuleUnique(original);
      const client = await page.context().newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");

      await registerAndLogin(page, request, "caseB");
      const sourceRes = await page.request.post("/api/data-sources", {
        data: {
          name: "HEL-520 Regression Source",
          type: "static",
          columns: [{ name: "amount", type: "integer" }],
          rows: [[10]],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(sourceRes.status()).toBe(201);
      const source = await sourceRes.json();
      const pipelineRes = await page.request.post("/api/pipelines", {
        data: { name: "HEL-520 Regression Pipeline", roots: [{ sourceId: source.id }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(pipelineRes.status()).toBe(201);
      const pipeline = await pipelineRes.json();

      await page.goto(`/pipelines/${pipeline.id}`);
      await page.waitForTimeout(300);
      const btn = page.locator(".pipeline-detail-header__add-source-btn");

      // 1. Baseline PASS — current (HEL-520-fixed) source.
      const baseline = await measureLive(
        page,
        client,
        btn,
        `/pipelines/${pipeline.id}`,
        "add-source-btn",
      );
      console.log(
        `[hel520-regression][Case B][baseline] verdict=${baseline.verdict} detail=${baseline.detail}`,
      );
      expect(baseline.verdict).toBe("pass");

      // 2. Mutate: remove the -2px inward `outline-offset` fix, restoring
      // the global default (+2px outward) that clips against the 25px-
      // tall `.pipeline-detail-header__group-value` ancestor.
      await writeAndSettle(ADD_SOURCE_BTN_CSS, original.replace(ADD_SOURCE_BTN_FOCUS_RULE, ""));
      mutated = true;
      await reloadAndSettle(page);

      // 3. Confirm RED for the STATED reason: "clipped", not merely "not
      // pass" — against the SAME `.pipeline-detail-header__group-value`
      // ancestor box measured live before the fix (its overflow is
      // hidden on BOTH axes, and the button sits flush against its right
      // edge; which axis `readAncestorClipBoxes` reports first, X or Y,
      // is an iteration-order detail, not the thing under test — the
      // ancestor box bounds identify it either way).
      const mutatedResult = await measureLive(
        page,
        client,
        page.locator(".pipeline-detail-header__add-source-btn"),
        `/pipelines/${pipeline.id}`,
        "add-source-btn",
      );
      console.log(
        `[hel520-regression][Case B][mutated] verdict=${mutatedResult.verdict} detail=${mutatedResult.detail}`,
      );
      expect(
        mutatedResult.verdict,
        "measureOneElement must report clipped against the reintroduced +2px-outward-offset shape",
      ).toBe("clipped");
      expect(mutatedResult.detail).toMatch(/clipped on [XY] by ancestor box/);

      // 4. Revert and confirm clean.
      await writeAndSettle(ADD_SOURCE_BTN_CSS, original);
      mutated = false;
      await reloadAndSettle(page);
      const revertedResult = await measureLive(
        page,
        client,
        page.locator(".pipeline-detail-header__add-source-btn"),
        `/pipelines/${pipeline.id}`,
        "add-source-btn",
      );
      console.log(
        `[hel520-regression][Case B][reverted] verdict=${revertedResult.verdict} detail=${revertedResult.detail}`,
      );
      expect(revertedResult.verdict).toBe("pass");
    } finally {
      if (mutated) {
        await fs.writeFile(ADD_SOURCE_BTN_CSS, original, "utf8");
      }
    }
  });
});
