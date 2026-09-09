import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test";

import { FOCUSABLE_SELECTOR } from "./support/stateContrastProbe";
import { forceFocusVisible } from "./support/forceFocusVisible";
import {
  readIndicatorSnapshot,
  measureOneElement,
  type Finding,
} from "./support/focusPresenceProbe";

// HEL-520 tasks 2.3-2.6c — AC2's actual measurement: does a focusable
// element's DECLARED focus indicator (accessible-focus-indicator/HEL-1050)
// actually PAINT, unclipped, at a conforming contrast — not merely "does
// the source declare one" (focusRingTokenGuard.css.test.ts already covers
// that, see design.md D1c). Occlusion is explicitly OUT of what this spec
// measures — see focusPresenceProbe.ts's module comment for why (a
// document.elementsFromPoint-based sampler was built, found
// methodologically unsound, and removed rather than shipped broken;
// CR3, evaluation-1.md). Reuses stateContrast.mjs's compositing/
// classification core UNCHANGED (parseColor/compositeStack/classifyState)
// and forceFocusVisible's CDP mechanism (design.md D2a: `.focus()` never
// matches `:focus-visible` in Chromium).
//
// D2b — deliberately UNCAPPED: every visible FOCUSABLE_SELECTOR match in
// each enumerated view is measured, not a sampled subset. The view list and
// measured-per-view count are both printed so the coverage claim is legible
// rather than implied (see console.log calls below and files-modified.md
// for the recorded runtime).
//
// Population note: `FOCUSABLE_SELECTOR` (stateContrastProbe.ts, D1d) is
// DELIBERATELY DIFFERENT from `INTERACTIVE_SELECTOR` used by the sibling
// HEL-866 hover/focus-surface guard — this spec answers "can this element
// take keyboard focus and does its indicator paint", not "does this
// element's SURFACE change colour on hover/focus". Do not merge the two
// populations or the two guards; each is scoped to a different question
// (design.md D1d).
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel520-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-520 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add dashboard" }).or(page.locator("body")),
  ).toBeVisible();
  await page.waitForTimeout(150); // settle theme-transition CSS (theme.css var(--app-transition))
}

// CR5 (evaluation-1.md) — the coverage claim must be SELF-CHECKING, not
// merely `totalMeasured > 0` (a headline total that seven empty views
// could satisfy). On the sibling HEL-866 guard's `stampDocument`/
// `assertPartitioned` pattern (state-surface-contrast-guard.spec.ts),
// adapted for this spec's simpler single-view-per-route shape (no
// chrome/sidebar-rail split to union): stamp every element THIS spec's
// own filter would accept (visible, enabled, `FOCUSABLE_SELECTOR`-matched)
// with a unique id, sweep as before while recording which ids were
// actually measured, then assert the two sets are equal — naming any
// leftover element loudly rather than letting a route that renders zero
// focusable elements pass silently.
const DOC_ID_ATTR = "data-hel520-doc-id";

async function stampFocusableDocument(page: Page): Promise<number> {
  return page.evaluate(
    ({ selector, attr }) => {
      const els = Array.from(document.querySelectorAll(selector)).filter((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const disabled =
          (el instanceof HTMLButtonElement && el.disabled) ||
          (el instanceof HTMLInputElement && el.disabled) ||
          el.getAttribute("aria-disabled") === "true";
        return !disabled;
      });
      els.forEach((el, i) => el.setAttribute(attr, String(i)));
      return els.length;
    },
    { selector: FOCUSABLE_SELECTOR, attr: DOC_ID_ATTR },
  );
}

/** Asserts every element `stampFocusableDocument` stamped was measured
 *  (its doc-id is in `coveredIds`). Throws, naming the leftover elements'
 *  identities, if any were not. */
async function assertRouteFullyCovered(
  page: Page,
  label: string,
  totalStamped: number,
  coveredIds: Set<string>,
): Promise<void> {
  // CR-B (evaluation-2.md) — `0 >= 0` let a view rendering zero focusable
  // elements pass silently (a login regression, an error boundary, a
  // seeding change). A per-view non-emptiness floor makes that its own
  // failure, distinct from and in addition to the partition check below.
  if (totalStamped === 0) {
    throw new Error(
      `HEL-520 focus-presence guard: "${label}" rendered ZERO focusable elements — a route that should ` +
        `have real content measured nothing. This is a coverage failure, not a legitimate empty view.`,
    );
  }
  if (coveredIds.size >= totalStamped) return;
  const leftoverIds = await page.evaluate(
    ({ attr, coveredArr }) => {
      const coveredSet = new Set(coveredArr);
      return Array.from(document.querySelectorAll(`[${attr}]`))
        .filter((el) => !coveredSet.has(el.getAttribute(attr) ?? ""))
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
          const aria = el.getAttribute("aria-label");
          return `${tag}[${cls || "n/a"}]${aria ? ` aria="${aria}"` : ""}`;
        });
    },
    { attr: DOC_ID_ATTR, coveredArr: Array.from(coveredIds) },
  );
  throw new Error(
    `HEL-520 focus-presence guard: coverage-partition assertion failed for "${label}" — ${totalStamped} ` +
      `focusable element(s) exist in the rendered document, but only ${coveredIds.size} were measured. ` +
      `Uncovered:\n` +
      leftoverIds.map((d) => `  ${d}`).join("\n"),
  );
}

test.describe("HEL-520 focus-presence guard (AC2)", () => {
  test.setTimeout(360_000);

  test("every focusable element presents an unclipped, conforming focus indicator, in every theme", async ({
    page,
    request,
  }) => {
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");

    await registerAndLogin(page, request, "focus-presence");

    // Same minimal seed shape as the sibling HEL-866 guard — a real
    // dashboard, source, and pipeline so /sources, /pipelines and the
    // pipeline-detail route render real rows/fields rather than an empty
    // state with a structurally tiny population (evaluation-2.md CR7).
    await page.getByRole("button", { name: "Add dashboard" }).click();
    await page.getByLabel("Dashboard name").fill("HEL-520 Guard Dashboard");
    await page.getByRole("button", { name: "Create dashboard" }).click();
    await expect(
      page.getByRole("button", { name: "HEL-520 Guard Dashboard", exact: true }),
    ).toBeVisible();

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-520 Guard Source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();
    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-520 Guard Pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    const routes = ["/", "/sources", `/pipelines/${pipeline.id}`, "/settings"];
    const viewList: string[] = [];
    const findings: Finding[] = [];
    let totalMeasured = 0;
    const runStart = Date.now();

    for (const theme of ["dark", "light"] as const) {
      await setTheme(page, theme);

      for (const route of routes) {
        await page.goto(route);
        await page.waitForTimeout(200);
        const viewName = `${route}(${theme})`;
        viewList.push(viewName);

        const totalStamped = await stampFocusableDocument(page);
        const coveredIds = new Set<string>();
        const handles = await page.locator(FOCUSABLE_SELECTOR).all();
        let measuredThisView = 0;
        for (const handle of handles) {
          const isVisible = await handle.isVisible().catch(() => false);
          if (!isVisible) continue;
          const disabled = await handle
            .evaluate(
              (el) =>
                (el instanceof HTMLButtonElement && el.disabled) ||
                (el instanceof HTMLInputElement && el.disabled) ||
                el.getAttribute("aria-disabled") === "true",
            )
            .catch(() => false);
          if (disabled) continue;

          const docId = await handle
            .evaluate((el, attr) => el.getAttribute(attr), DOC_ID_ATTR)
            .catch(() => null);
          if (docId) coveredIds.add(docId);

          const desc = await handle
            .evaluate((el) => {
              const tag = el.tagName.toLowerCase();
              const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/)[0];
              const aria = el.getAttribute("aria-label");
              return `${tag}[${cls || "n/a"}]${aria ? ` aria="${aria}"` : ""}`;
            })
            .catch(() => "unknown");

          const base = await readIndicatorSnapshot(handle);

          let clearFocus: (() => Promise<void>) | null = null;
          try {
            // Real `.focus()` FIRST, then layer the CDP `:focus-visible`
            // force on top — confirmed live (a real defect this harness
            // itself hit, not the app): several row-hosted triggers
            // (`.dashboard-list__item-row .popover.actions-menu`, the
            // per-row actions-menu trigger) are deliberately clipped to
            // 1x1/`clip: rect(0,0,0,0)` at REST and only reveal via a
            // `:focus-within` rule on an ANCESTOR (a documented, correct
            // `.sr-only`-style keep-focusable-but-hidden pattern — see that
            // rule's own comment in DashboardList.css). `:focus-within`
            // reflects genuine `document.activeElement` state, which
            // `CSS.forcePseudoState` alone never changes (it only affects
            // style *matching* on the exact forced node, not real focus).
            // A real `.focus()` sets `document.activeElement` correctly,
            // so the ancestor `:focus-within` reveal cascades exactly as
            // it does for an actual keyboard user; the CDP force is still
            // required on top because `:focus-visible` (unlike
            // `:focus-within`) is a heuristic real focus alone does not
            // set (design.md D2a). Without the real `.focus()` call, this
            // measurement mis-reported the reveal-on-ancestor-focus
            // pattern as "clipped" — a harness bug, not a live app defect;
            // confirmed by live DOM inspection (ancestor chain has exactly
            // one `overflow: hidden` box, sized 1x1, that a real focus
            // event un-clips).
            await handle.focus();
            clearFocus = await forceFocusVisible(client, handle);
          } catch {
            continue; // not actionable (e.g. detached mid-sweep)
          }
          // 400ms, not 200 -- matches the sibling HEL-866 guard's own
          // margin exactly (theme.css's --app-transition is 0.16s; 400ms
          // gives >2x headroom). Confirmed live this matters here: the
          // skip link's `:focus-visible` rule transitions `top` from
          // -100% to its revealed position (App.css), and a shorter wait
          // caught it mid-transition, producing a false "clipped" finding
          // (this measurement predates occlusion detection's removal —
          // see focusPresenceProbe.ts's module comment — but the
          // transition-timing hazard is the same for any ring-geometry
          // read taken too early).
          await page.waitForTimeout(400);

          // Everything that depends on the REVEALED (focused) DOM state —
          // the forced snapshot itself, ancestor clip boxes, and the
          // backdrop walk — must run BEFORE focus is cleared below, or an
          // ancestor `:focus-within` reveal (see the comment above)
          // collapses back to its resting/clipped shape and every one of
          // those reads silently measures the WRONG state. `finally`
          // guarantees focus is cleared even if a measurement throws or
          // `continue`s early.
          let finding: Finding;
          try {
            finding = await measureOneElement(handle, base, viewName, theme, desc);
          } finally {
            await clearFocus();
            await page
              .evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
              .catch(() => {});
          }
          findings.push(finding);
          measuredThisView++;
          totalMeasured++;
        }

        console.log(
          `[HEL-520 focus-presence guard] view "${viewName}": ${measuredThisView} focusable element(s) measured (uncapped)`,
        );
        await assertRouteFullyCovered(page, viewName, totalStamped, coveredIds);
      }
    }

    const runtimeMs = Date.now() - runStart;
    console.log(
      `[HEL-520 focus-presence guard] total measured: ${totalMeasured} across ${viewList.length} view(s): ${viewList.join(", ")}`,
    );
    console.log(`[HEL-520 focus-presence guard] runtime: ${runtimeMs}ms`);

    // evaluation-2.md CR-A retraction: a `KNOWN_RESIDUAL_RATIOS` allowance
    // used to live here, naming 10 `.ui-input`-family sites as accepted
    // `--app-accent-dim` halo residuals owned by HEL-1046/1050. That
    // finding was a PROBE DEFECT, not a real one: `measureOneElement`
    // graded exactly one channel by precedence (`outline > box-shadow >
    // border`), and every one of those 10 sites has `outline: none` PLUS a
    // real, contrast-derived `border-color` PLUS a deliberately decorative
    // `box-shadow` halo — precedence fell through to the halo and never
    // measured the border, the channel actually carrying the conforming
    // indicator. Measured with the corrected any-channel rule
    // (`focusPresenceProbe.ts`): the border alone clears 3:1 (4.96 dark /
    // 3.48 light) on every one of those sites. The residual population is
    // now zero and this allowance block is deleted outright, not left
    // empty — see files-modified.md for the full retraction and the
    // corrected HEL-1046/1050 attribution (there is no real gap to hand
    // that lineage).

    const failures = findings.filter((f) => f.verdict !== "pass");
    if (failures.length > 0) {
      const grouped = failures
        .map((f) => `  [${f.verdict}] ${f.view} ${f.desc} — ${f.detail}`)
        .join("\n");
      throw new Error(
        `HEL-520 focus-presence guard: ${failures.length}/${totalMeasured} measured element(s) did not present a conforming, unclipped focus indicator:\n${grouped}`,
      );
    }

    expect(totalMeasured).toBeGreaterThan(0);
  });
});
